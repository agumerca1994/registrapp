"""Cuánto tarda cada request y en qué: total, base de datos y verificar el token.

Sale por dos lados. `Server-Timing` lo muestra en las herramientas del navegador
de quien está mirando la app, y `route_summary()` (`GET /internal/request-timings`)
da el p50/p95 por ruta de lo que pasó en producción desde el último deploy.

Se agrupa por la plantilla de la ruta, nunca por la URL real: la URL lleva ids y
tokens de invitación, y acá no se guarda ningún dato de nadie.
"""
import time
from collections import defaultdict, deque
from contextvars import ContextVar
from dataclasses import dataclass
from statistics import quantiles
from typing import Any, Iterable

from sqlalchemy import event
from sqlalchemy.engine import Engine

# Muestras por ruta. Alcanza para un p95 y el tamaño de la memoria queda acotado,
# porque la cantidad de rutas es fija.
MAX_SAMPLES = 300


@dataclass
class _Timing:
    db_ms: float = 0.0
    queries: int = 0
    auth_ms: float = 0.0


# Un objeto mutable y no valores sueltos: BaseHTTPMiddleware corre el handler en
# otra tarea, que recibe una copia del contexto. Lo que escribe ahí tiene que
# verse desde este middleware.
_current: ContextVar[_Timing | None] = ContextVar("request_timing", default=None)
_samples: dict[str, deque[tuple[float, float, int, float]]] = defaultdict(lambda: deque(maxlen=MAX_SAMPLES))


def add_auth_time(ms: float) -> None:
    timing = _current.get()
    if timing is not None:
        timing.auth_ms += ms


def install_query_timing(engine: Engine) -> None:
    """Cuenta consultas y su tiempo. Fuera de un request (jobs, bot en segundo
    plano) no hace nada, porque no hay a quién atribuírselas."""

    @event.listens_for(engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):
        conn.info["timing_query_start"] = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):
        timing = _current.get()
        started = conn.info.pop("timing_query_start", None)
        if timing is not None and started is not None:
            timing.db_ms += (time.perf_counter() - started) * 1000
            timing.queries += 1


class TimingMiddleware:
    """ASGI puro: agregar el header al arrancar la respuesta no bufferea nada,
    y `/mcp` puede ser un stream. En uno, el total es hasta el primer byte."""

    def __init__(self, app: Any, allowed_origins: Iterable[str]):
        self.app = app
        self.allowed_origins = {o.encode() for o in allowed_origins}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return

        timing = _Timing()
        token = _current.set(timing)
        started = time.perf_counter()
        origin = dict(scope["headers"]).get(b"origin")

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                total_ms = (time.perf_counter() - started) * 1000
                _record(scope, total_ms, timing)
                # La API está en otro dominio: sin Timing-Allow-Origin el navegador
                # esconde estos valores a la página.
                if origin in self.allowed_origins:
                    message.setdefault("headers", []).extend([
                        (b"server-timing", _header(total_ms, timing)),
                        (b"timing-allow-origin", origin),
                    ])
            await send(message)

        try:
            await self.app(scope, receive, send_with_timing)
        finally:
            _current.reset(token)


def _header(total_ms: float, timing: _Timing) -> bytes:
    return (
        f'app;dur={total_ms:.1f}, db;dur={timing.db_ms:.1f};desc="{timing.queries} queries", '
        f"auth;dur={timing.auth_ms:.1f}"
    ).encode()


def _record(scope, total_ms: float, timing: _Timing) -> None:
    route = scope.get("route")
    path = getattr(route, "path", None)
    if path:
        _samples[f"{scope['method']} {path}"].append((total_ms, timing.db_ms, timing.queries, timing.auth_ms))


def _percentiles(values: list[float]) -> tuple[float, float]:
    if len(values) < 2:
        return values[0], values[0]
    cuts = quantiles(values, n=20, method="inclusive")
    return cuts[9], cuts[18]


def route_summary() -> list[dict[str, Any]]:
    """Cada ruta con su p50/p95, de la más lenta a la más rápida."""
    rows = []
    for route, samples in list(_samples.items()):
        if not samples:
            continue
        total_p50, total_p95 = _percentiles([s[0] for s in samples])
        db_p50, db_p95 = _percentiles([s[1] for s in samples])
        queries_p50, queries_p95 = _percentiles([float(s[2]) for s in samples])
        auth_p50, auth_p95 = _percentiles([s[3] for s in samples])
        rows.append({
            "route": route,
            "count": len(samples),
            "total_ms": {"p50": round(total_p50, 1), "p95": round(total_p95, 1)},
            "db_ms": {"p50": round(db_p50, 1), "p95": round(db_p95, 1)},
            "queries": {"p50": round(queries_p50), "p95": round(queries_p95)},
            "auth_ms": {"p50": round(auth_p50, 1), "p95": round(auth_p95, 1)},
        })
    return sorted(rows, key=lambda r: r["total_ms"]["p95"], reverse=True)


def reset_samples() -> None:
    _samples.clear()

"""La medición por request: lo que cuenta, lo que muestra y lo que no guarda."""
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.timing import (
    TimingMiddleware, add_auth_time, install_query_timing, reset_samples, route_summary,
)

ORIGIN = "https://app.example.com"


@pytest_asyncio.fixture
async def client():
    reset_samples()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    install_query_timing(engine.sync_engine)
    app = FastAPI()

    @app.get("/things/{thing_id}")
    async def read_thing(thing_id: str):
        add_auth_time(2.5)
        async with engine.connect() as conn:
            await conn.execute(text("select 1"))
            await conn.execute(text("select 2"))
        return {"ok": True}

    @app.get("/boom")
    async def boom():
        return {"ok": False}

    # El middleware real de main.py: corre el handler en otra tarea.
    async def passthrough(request, call_next):
        return await call_next(request)

    app.add_middleware(BaseHTTPMiddleware, dispatch=passthrough)
    app.add_middleware(TimingMiddleware, allowed_origins=[ORIGIN])
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await engine.dispose()


@pytest.mark.asyncio
async def test_cuenta_consultas_y_auth_a_traves_de_otro_middleware(client):
    response = await client.get("/things/1", headers={"Origin": ORIGIN})

    header = response.headers["server-timing"]
    assert 'desc="2 queries"' in header
    assert "auth;dur=2.5" in header
    assert response.headers["timing-allow-origin"] == ORIGIN


@pytest.mark.asyncio
async def test_sin_origen_permitido_no_hay_header_pero_se_mide(client):
    response = await client.get("/things/1", headers={"Origin": "https://otro.example.com"})

    assert "server-timing" not in response.headers
    assert "timing-allow-origin" not in response.headers
    assert route_summary()[0]["count"] == 1


@pytest.mark.asyncio
async def test_agrupa_por_plantilla_sin_guardar_la_url(client):
    await client.get("/things/token-secreto")
    await client.get("/things/otro-token")

    rows = route_summary()
    assert [r["route"] for r in rows] == ["GET /things/{thing_id}"]
    assert rows[0]["count"] == 2
    assert rows[0]["queries"] == {"p50": 2, "p95": 2}
    assert "token" not in str(rows)


@pytest.mark.asyncio
async def test_una_url_que_no_existe_no_crea_filas(client):
    await client.get("/no-existe/cualquier-cosa")

    assert route_summary() == []

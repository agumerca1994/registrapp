#!/usr/bin/env python3
"""
RegistrApp Logs MCP Server

Exposes backend logs as Claude Code tools so you can ask:
  "¿qué errores hubo en las últimas 24 horas?"
  "buscá logs del módulo credit_cards"
  "dame un resumen del sistema de hoy"

Config (env vars):
  MCP_BACKEND_URL   — backend URL (default: http://localhost:8000)
  MCP_INTERNAL_KEY  — must match INTERNAL_LOG_KEY on the backend
"""
import os
import json
import httpx
from mcp.server.fastmcp import FastMCP

BACKEND_URL = os.environ.get("MCP_BACKEND_URL", "http://localhost:8000").rstrip("/")
INTERNAL_KEY = os.environ.get("MCP_INTERNAL_KEY", "")

mcp = FastMCP("registrapp-logs")


def _headers() -> dict[str, str]:
    return {"x-internal-key": INTERNAL_KEY}


def _fmt_item(item: dict) -> str:
    parts = [
        f"[{item['created_at']}] {item['level']} — {item.get('logger_name', '?')}",
        f"  {item['message']}",
    ]
    if item.get("request_path"):
        parts.append(f"  {item.get('request_method', '')} {item['request_path']} → {item.get('status_code', '')}")
    if item.get("traceback"):
        tb_lines = item["traceback"].strip().splitlines()
        preview = "\n".join(tb_lines[-6:])
        parts.append(f"  Traceback (últimas líneas):\n{preview}")
    return "\n".join(parts)


@mcp.tool()
async def recent_errors(hours: int = 24, limit: int = 20) -> str:
    """Devuelve los errores recientes del backend de RegistrApp.

    Args:
        hours: Cuántas horas hacia atrás buscar (default 24).
        limit: Máximo de resultados (default 20).
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BACKEND_URL}/internal/logs",
            params={"level": "ERROR", "hours": hours, "limit": limit},
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    items = data["items"]
    if not items:
        return f"No hay errores en las últimas {hours} horas."

    lines = [f"=== {data['total']} error(es) en las últimas {hours}h (mostrando {len(items)}) ===\n"]
    for item in items:
        lines.append(_fmt_item(item))
        lines.append("")
    return "\n".join(lines)


@mcp.tool()
async def search_logs(query: str, level: str = "WARNING", hours: int = 48) -> str:
    """Busca en los logs del backend por texto.

    Args:
        query: Texto a buscar en el mensaje del log.
        level: Nivel mínimo: DEBUG, INFO, WARNING, ERROR, CRITICAL (default WARNING).
        hours: Ventana de tiempo en horas (default 48).
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BACKEND_URL}/internal/logs",
            params={"level": level, "hours": hours, "search": query, "limit": 50},
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    items = data["items"]
    if not items:
        return f"No se encontraron logs con '{query}' en las últimas {hours}h."

    lines = [f"=== {data['total']} resultado(s) para '{query}' (últimas {hours}h) ===\n"]
    for item in items:
        lines.append(_fmt_item(item))
        lines.append("")
    return "\n".join(lines)


@mcp.tool()
async def logs_by_module(module: str, hours: int = 24, level: str = "WARNING") -> str:
    """Devuelve logs filtrados por módulo o router del backend.

    Args:
        module: Nombre parcial del módulo (ej: 'credit_cards', 'shared_expenses').
        hours: Ventana de tiempo en horas (default 24).
        level: Nivel mínimo (default WARNING).
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BACKEND_URL}/internal/logs",
            params={"level": level, "hours": hours, "module": module, "limit": 50},
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    items = data["items"]
    if not items:
        return f"No hay logs del módulo '{module}' en las últimas {hours}h."

    lines = [f"=== {data['total']} log(s) de '{module}' (últimas {hours}h) ===\n"]
    for item in items:
        lines.append(_fmt_item(item))
        lines.append("")
    return "\n".join(lines)


@mcp.tool()
async def log_summary(hours: int = 24) -> str:
    """Resumen de conteo de logs por nivel (DEBUG/INFO/WARNING/ERROR/CRITICAL).

    Args:
        hours: Ventana de tiempo en horas (default 24).
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BACKEND_URL}/internal/logs/summary",
            params={"hours": hours},
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    total_problems = data["WARNING"] + data["ERROR"] + data["CRITICAL"]
    status = "OK" if data["ERROR"] == 0 and data["CRITICAL"] == 0 else "HAY ERRORES"

    return (
        f"=== Estado del sistema — últimas {hours}h [{status}] ===\n"
        f"  CRITICAL : {data['CRITICAL']}\n"
        f"  ERROR    : {data['ERROR']}\n"
        f"  WARNING  : {data['WARNING']}\n"
        f"  INFO     : {data['INFO']}\n"
        f"  DEBUG    : {data['DEBUG']}\n"
        f"  Total problemas (WARNING+): {total_problems}"
    )


if __name__ == "__main__":
    if not INTERNAL_KEY:
        print("WARNING: MCP_INTERNAL_KEY no está configurado. Las requests al backend fallarán.")
    mcp.run(transport="stdio")

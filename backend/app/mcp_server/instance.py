"""The `FastMCP` instance itself, kept apart from the transport wiring.

Tool modules import `mcp` from here and `transport.py` imports both, so the
decorators never create an import cycle.
"""
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.core.config import settings

INSTRUCTIONS = """\
RegistrApp es una app de finanzas personales de un hogar argentino. Este conector
es de SOLO LECTURA: ninguna herramienta modifica, crea ni borra datos.

Reglas del dominio que tenés que respetar al interpretar los números:

- Los montos NUNCA se mezclan entre monedas. Los totales en pesos incluyen sólo
  gastos en ARS; los gastos en USD se informan aparte. `balance` (ingresos −
  gastos) es siempre ARS.
- Comprar dólares NO es un gasto: es mover plata de un bolsillo a otro. No entra
  en los gastos ni en el balance, pero sí mueve pesos reales, y eso es lo que
  informa `ars_available` = balance − comprado_en_ars + vendido_en_ars.
- Todos los gastos en USD caen en una única categoría ("Consumo en dólares"), así
  que desagregarlos por categoría no dice nada: agrupalos por descripción.
- Los gastos de tarjeta de crédito ya están incluidos en los gastos (con
  payment_method="tarjeta_credito"); no los sumes de nuevo.
- Las cuotas futuras ya están cargadas en los resúmenes de los meses que vienen:
  son compromisos ciertos, no una proyección.
- Los datos son del hogar completo, no de una sola persona.
- Contexto argentino: la inflación es alta, así que comparar montos nominales de
  meses distintos engaña. Usá las variaciones reales (deflactadas) que devuelven
  las herramientas antes de sacar conclusiones.

Empezá por `get_taxonomy` si necesitás nombres de categorías, fuentes de ingreso
o tarjetas para filtrar.
"""

mcp = FastMCP(
    "registrapp",
    instructions=INSTRUCTIONS,
    website_url=settings.FRONTEND_URL or None,
    stateless_http=True,
    # Plain JSON instead of SSE. Simpler for clients, and it keeps /mcp
    # compatible with the app's BaseHTTPMiddleware error logger, which would
    # otherwise buffer a streaming response.
    json_response=True,
    # Mandatory, not optional: with the default host of 127.0.0.1 FastMCP builds
    # its own anti-DNS-rebinding settings that only allow localhost, and behind
    # Traefik that turns every production request into a bare 421.
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=settings.mcp_allowed_hosts,
        allowed_origins=settings.mcp_allowed_origins,
    ),
)

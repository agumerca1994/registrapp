"""The `FastMCP` instance itself, kept apart from the transport wiring.

Tool modules import `mcp` from here and `transport.py` imports both, so the
decorators never create an import cycle.
"""
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from app.core.config import settings

INSTRUCTIONS = """\
RegistrApp lleva las cuentas de un HOGAR o de un NEGOCIO chico. Llamá primero a
`get_taxonomy`: si `account_kind` es "business", seguí las `rules` que devuelve
y no las reglas de hogar de abajo (divisas, hipoteca, compartidos, recibos).

RegistrApp es una app de finanzas personales de un hogar argentino. Este conector
consulta todo el hogar y además puede CARGAR, EDITAR Y BORRAR:
- INGRESOS, con su detalle por campo (bruto, cargas sociales, ganancias, bonos…),
  por ejemplo a partir de un recibo de sueldo;
- TARJETAS DE CRÉDITO: tarjetas, resúmenes (fechas de cierre y vencimiento) e
  ítems, por ejemplo comparando un resumen del banco con lo cargado;
- GASTOS COMPARTIDOS: crear, editar, aceptar/rechazar los que te mandaron,
  liquidar en pesos uno en dólares y borrar;
- GASTOS SIMPLES (efectivo, débito, transferencia) con `save_expense` /
  `delete_expense`. Con tarjeta van por `save_card_item` y los compartidos por
  `create_shared_expense` — nunca cargues uno de esos como gasto simple.
Divisas e hipoteca son sólo lectura.

Reglas para escribir — no hay excepciones:

- Toda herramienta de escritura arranca en dry_run=true y devuelve una vista
  previa sin guardar nada. Mostrásela al usuario (qué se crea o cambia, el antes
  y el después, y las `warnings`) y repetí con dry_run=false SÓLO si confirma.
- Antes de cargar un recibo, buscá si ese mes ya está cargado (`list_income` con
  group_by="none" trae ids y detalle). Si existe, proponé editarlo con entry_id
  en vez de crear un duplicado; si difiere del recibo, mostrá las diferencias.
- `amount` es el NETO cobrado. Los ítems van en positivo: el tipo del campo
  (add/subtract/info) decide si suma o resta. Usá los nombres de campo de
  `get_taxonomy`; si el recibo trae un concepto que la fuente no tiene, proponé
  agregarlo (new_fields) en vez de meterlo en otro campo.
- Para un resumen de tarjeta: `get_card_statement` trae lo cargado con ids.
  Compará renglón por renglón con el del banco y presentá tres listas (falta,
  sobra, difiere) antes de proponer cambios. Una cuota (n/N) ya puede estar
  cargada desde el resumen donde empezó el plan: no la vuelvas a crear.
- Los ítems compartidos no se borran ni cambian de monto desde acá; las cuotas
  2..N se editan o borran desde la cuota 1 (`root_item_id`).
- Crear un gasto compartido LE AVISA A OTRAS PERSONAS (push, WhatsApp, invitación).
  Es lo único que no se puede deshacer: mostrá la lista `notifications` de la
  vista previa y confirmá con el usuario a quién le llega qué antes de guardar.
- En compartidos, sólo quien lo creó edita, liquida o borra; si ya lo aceptó otro
  participante (`locked`) sólo cambian título y fechas; los que vienen de una
  tarjeta se corrigen desde la tarjeta.
- Si no estás seguro de un monto o de a qué campo va, preguntá antes de escribir.

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

# Las herramientas de consulta lo declaran para que el cliente no pida
# confirmación al leer; las de escritura (tools_income_write) declaran lo contrario.
READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)

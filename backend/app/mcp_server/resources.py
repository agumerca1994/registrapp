"""Resources and prompts.

Resources save a tool call on context that never changes. The web connector's
support for them is patchier than Claude Desktop's, though, so `get_taxonomy`
stays available as a tool too and the domain rules are repeated in the server's
`instructions` — which every client does read.
"""
import json

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp

SCHEMA_DOC = """\
# Modelo de datos de RegistrApp

Un **hogar** (tenant) agrupa a varias personas. Todo lo que devuelve este
conector es del hogar completo, nunca de una sola persona.

## Ingresos
Se registran por mes con neto, bruto y deducciones, asociados a una **fuente**
(sueldo, bonus, aguinaldo, inversiones, otros). Siempre en pesos: la app no
registra ingresos en dólares.

## Gastos
Una sola tabla de gastos concentra todo, tenga el origen que tenga:
- cargas manuales,
- consumos de tarjeta de crédito (con `payment_method="tarjeta_credito"`),
- cuotas de hipoteca,
- gastos compartidos que la otra persona aceptó.
Por eso no hay que sumar tarjetas aparte: ya están adentro.
Cada gasto tiene categoría, fecha, moneda (ARS o USD) y, si vino de una tarjeta,
la entidad.

## Tarjetas
Tarjeta → resumen mensual (con fecha de cierre y de vencimiento) → ítems. Un
ítem puede ser único, en cuotas o recurrente. **Cuando se carga una compra en
cuotas, todas las cuotas se escriben de una vez en los resúmenes futuros**: por
eso los compromisos de los próximos meses son un dato, no una estimación.

## Divisas
Comprar dólares no es un gasto: la plata cambia de bolsillo, el patrimonio no
cambia. Se distingue el *stock* (cuántos dólares hay, se arrastra entre meses)
del *flujo* del mes (compras, ventas, gastos en USD).

## Hipoteca
Créditos UVA o de tasa fija. Cuando un mes todavía no tiene el pago registrado,
la cuota se proyecta con el último valor de UVA conocido.

## Macro
Serie pública argentina: inflación mensual e interanual, UVA, dólares (oficial,
blue, mayorista, MEP, CCL), UVI, ICL, RIPTE, salario mínimo, canasta básica.
Es global: no depende del hogar.

# Reglas que no se negocian

1. Las monedas nunca se mezclan. No existe un total ARS+USD.
2. `balance` = ingresos − gastos, siempre en pesos.
3. `ars_available` = balance − comprado_en_ars + vendido_en_ars.
4. Todos los gastos en USD comparten la categoría "Consumo en dólares", así que
   hay que agruparlos por descripción, no por categoría.
5. Comparar montos nominales de meses distintos, con inflación alta, engaña.
   Usá siempre las variaciones reales.
"""


@mcp.resource("registrapp://schema")
def schema_resource() -> str:
    """Modelo de datos de RegistrApp y las reglas para interpretarlo."""
    return SCHEMA_DOC


@mcp.resource("registrapp://taxonomy")
async def taxonomy_resource() -> str:
    """Categorías, fuentes de ingreso y tarjetas de este hogar (JSON)."""
    from app.mcp_server.tools_meta import get_taxonomy
    return json.dumps(await get_taxonomy(), ensure_ascii=False, indent=1)


@mcp.prompt()
def analisis_mensual(year: int, month: int) -> str:
    """Analiza un mes: resumen, comparación con el mes anterior y contra un año atrás."""
    return (
        f"Analizá cómo le fue al hogar en {year}-{month:02d}.\n\n"
        f"1. Traé el resumen del mes con get_month_summary.\n"
        f"2. Compará ingresos y gastos contra el mes anterior y contra el mismo "
        f"mes del año pasado con compare_periods, mirando la variación REAL "
        f"(descontada la inflación), no la nominal.\n"
        f"3. Mirá en qué categorías se fue la plata con list_expenses.\n"
        f"4. Cerrá con 3 o 4 conclusiones concretas y accionables. Si algo llama "
        f"la atención, decilo directo; no adornes."
    )


@mcp.prompt()
def armar_presupuesto(months: int = 6) -> str:
    """Propone un presupuesto mensual a partir del historial y los compromisos futuros."""
    return (
        f"Armá un presupuesto mensual para el hogar.\n\n"
        f"1. Usá get_budget_baseline con months={months} para ver el gasto "
        f"promedio por categoría, separando fijos de variables.\n"
        f"2. Usá get_upcoming_commitments para ver qué ya está comprometido en "
        f"los próximos meses (cuotas, hipoteca, vencimientos).\n"
        f"3. Proponé un presupuesto por categoría con un monto concreto, "
        f"marcando cuáles son incomprimibles y dónde hay margen real.\n"
        f"4. Decí explícitamente cuánto queda de excedente mensual y qué pasa si "
        f"un mes tiene un gasto extraordinario."
    )


@mcp.prompt()
def evaluar_compra(descripcion: str, monto: float, cuotas: int = 1) -> str:
    """Evalúa si conviene una compra grande y qué impacto tendría."""
    return (
        f"Quiero comprar: {descripcion}, por {monto} en {cuotas} cuota(s).\n\n"
        f"1. Corré simulate_purchase con esos datos.\n"
        f"2. Corré una segunda simulación con una inflación anual supuesta "
        f"razonable para ver cuánto se licuarían las cuotas.\n"
        f"3. Contrastá con get_upcoming_commitments: fijate si cae justo en un "
        f"mes ya cargado de compromisos.\n"
        f"4. Dame una recomendación clara: si conviene, en cuántas cuotas, y qué "
        f"mes sería el más ajustado. Si no conviene, decilo sin vueltas."
    )

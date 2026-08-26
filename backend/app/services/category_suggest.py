"""Sugerir la categoría de un gasto a partir de su descripción.

Es la heurística que `docs/plans/importador-resumenes-tarjeta.md` dejó diseñada
y sin escribir: sobre las últimas ~500 descripciones del hogar, normalizar el
texto y quedarse con la categoría de la descripción histórica más parecida por
solapamiento de tokens (Jaccard). Sin ML, sin llamada externa, en el mismo
request.

**Vive acá y no dentro del importador de resúmenes**, aunque el plan del
importador la haya inventado. Es el mismo razonamiento que ya aplicaron
`services/currency.py` y `services/participants.py`: en el momento en que dos
pantallas necesitan la misma regla, tener dos implementaciones garantiza que una
derive. La consumen `/registrar`, el bot de WhatsApp, el lector de comprobantes
y —cuando exista— el importador, vía `suggest_categories_bulk`.

Qué se puede esperar, para que nadie la sobrevenda en pantalla: acierta con
comercios repetidos (el supermercado de siempre, las suscripciones) y no acierta
con comercios nuevos, donde el usuario elige a mano. Por eso la sugerencia
siempre llega como un chip preseleccionado y visible, nunca como algo que se
guarda solo.
"""
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Sequence

import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.services.search import fold_text

# Medido, no adivinado: `scripts/tune_category_threshold.py` hace validación
# leave-one-out sobre los datos reales y barre umbrales.
#
# El barrido completo no sirve para elegir —da ~100% de precisión en todos los
# umbrales, porque en un hogar real casi toda descripción se repite literalmente
# y matchea con score 1.0—, así que el script mide aparte el único segmento que
# el umbral decide: las descripciones **sin gemelo exacto**. Ahí el resultado es
# nítido y cabe en dos casos:
#
#   "Supermercado mayo" vs "Supermercado junio"  -> 0.333  y es correcto
#   "Parrilla Don Julio" vs "Supermercado julio" -> 0.25   y es un falso positivo
#
# O sea que la frontera útil está entre 0.25 y 1/3. 0.30 admite el solapamiento
# de 1-en-3 (un token de comercio compartido más calificadores distintos, que es
# la forma más común) y rechaza el de 1-en-4, que es donde empiezan los matches
# por casualidad. Un 0.34 cae *apenas* por encima de 0.3333 y por lo tanto no
# sugiere nada en ese segmento — era el valor de la primera versión de este
# archivo y el barrido lo desmintió.
#
# Nota sobre la medición actual: sacar los meses de los tokens (ver _STOPWORDS)
# mandó "Supermercado mayo/junio/julio" al camino de match exacto y borró el
# falso positivo, así que hoy el barrido queda plano en 100% de precisión y
# 97,5% de cobertura para todos los umbrales — el 2,5% restante son
# descripciones con cero solapamiento, donde ningún umbral ayuda. 0.30 sigue
# siendo la elección correcta para cuando el caso 1-en-3 reaparezca con más
# datos, pero la muestra de descripciones nuevas es chica (n≈13): si esto se
# empieza a sentir mal en uso real, correr el script antes de tocar el número.
THRESHOLD = 0.30

# Cuántas descripciones del hogar se miran hacia atrás. 500 es lo que el plan
# del importador fijó; con tokens precomputados el costo real de una sugerencia
# son 500 intersecciones de sets (microsegundos), así que el límite existe por
# la consulta, no por el cómputo.
CORPUS_LIMIT = 500

CACHE_TTL = 300.0
CACHE_MAX_TENANTS = 50

# Ruido de cuotas en las descripciones de tarjeta: "C.03/12", "03/12",
# "CUOTA 3 DE 12". Si no se saca, dos compras distintas del mismo plan de cuotas
# se parecen entre sí por el marcador y no por el comercio.
_CUOTA_RE = re.compile(r"\b(?:c\.?|cuota|cuot)\s*\.?\s*\d{1,2}\s*(?:/|de)\s*\d{1,2}\b")
_BARE_INSTALLMENT_RE = re.compile(r"\b\d{1,2}/\d{1,2}\b")
_NON_WORD_RE = re.compile(r"[^0-9a-zñ]+")

# Deliberadamente corta. Una lista larga de stopwords empieza a borrar el token
# que identificaba al comercio ("El Noble", "La Anónima" son nombres, no ruido),
# así que sólo entran las que jamás distinguen a nadie.
_STOPWORDS = frozenset({
    # Formas societarias y ruido de medio de pago.
    "sa", "srl", "sas", "spa", "ltda", "inc", "llc",
    "pago", "pagos", "compra", "compras", "debito", "credito", "tarjeta",
    "arg", "argentina", "buenos", "aires", "www", "com", "ars", "usd",
    # Palabras función del castellano de 3+ letras. El filtro de longitud deja
    # pasar "los"/"del"/"por", y como token no distinguen a nadie: sin esto,
    # "Los Andes" y "Los Amigos" comparten un token y se parecen. Sacarlas no
    # pierde el nombre — "andes" y "amigos" siguen ahí.
    "los", "las", "del", "por", "con", "para", "una", "uno", "unos", "unas",
    "que", "mas", "sus", "sin", "ser", "este", "esta", "esto",
    # Meses. En una descripción de gasto un mes es casi siempre un marcador de
    # período ("Supermercado julio"), o sea justo lo que NO identifica al
    # comercio — y fue la causa medida del único falso positivo del barrido:
    # "Parrilla Don Julio" matcheaba con "Supermercado julio" por el mes.
    # Sacarlos también colapsa "Supermercado mayo/junio/julio" en un solo
    # concepto, que es lo correcto. El costo es un comercio que se llame sólo
    # como un mes, y ahí degrada a "sin sugerencia", que es inofensivo.
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
})

_MIN_TOKEN_LEN = 3

# tokens, category_id, category_name, descripción original
_CorpusRow = tuple[frozenset[str], int, str, str]

# In-process, igual que `rate_limit.py`, y con el mismo caveat: el contenedor
# corre un solo worker de uvicorn. Si eso cambia, cada worker mantiene su propia
# copia — inofensivo acá, porque lo peor que produce un corpus rancio por cinco
# minutos es una *sugerencia* desactualizada, no un dato mal guardado.
_cache: "OrderedDict[int, tuple[float, list[_CorpusRow]]]" = OrderedDict()


@dataclass(frozen=True)
class CategorySuggestion:
    category_id: int
    category_name: str
    score: float
    matched_description: str


def normalize(description: str) -> frozenset[str]:
    """Descripción → conjunto de tokens comparables.

    `fold_text` es el mismo plegado de acentos y minúsculas que usan las cajas
    de búsqueda (`services/search.py`), a propósito: si esto plegara distinto,
    "Almacén" tokenizado acá no coincidiría con lo que el usuario ve resaltado
    allá.
    """
    if not description:
        return frozenset()
    text = fold_text(description)
    text = _CUOTA_RE.sub(" ", text)
    text = _BARE_INSTALLMENT_RE.sub(" ", text)
    tokens = set()
    for raw in _NON_WORD_RE.split(text):
        if len(raw) < _MIN_TOKEN_LEN or raw in _STOPWORDS:
            continue
        # Números sueltos (nro de cupón, sucursal, importes pegados) no
        # identifican a un comercio y hacen match entre gastos sin relación.
        if raw.isdigit():
            continue
        tokens.add(raw)
    return frozenset(tokens)


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if not inter:
        return 0.0
    return inter / len(a | b)


def invalidate(tenant_id: int) -> None:
    """Tirar el corpus cacheado de un hogar. La llaman los escritores de gastos.

    Es best-effort: si alguien agrega un escritor nuevo y se olvida de llamarla,
    lo que pasa es que el gasto recién creado tarda hasta CACHE_TTL en poder ser
    sugerido. No hay forma de que produzca un dato incorrecto.
    """
    _cache.pop(tenant_id, None)


async def _load_corpus(db: AsyncSession, tenant_id: int) -> list[_CorpusRow]:
    now = time.monotonic()
    hit = _cache.get(tenant_id)
    if hit is not None and now - hit[0] < CACHE_TTL:
        _cache.move_to_end(tenant_id)
        return hit[1]

    # `ExpenseEntry` solo alcanza y es superset de los cargos de tarjeta: cada
    # `CreditCardItem` espeja un `ExpenseEntry`, así que mirar las dos tablas
    # contaría lo mismo dos veces.
    #
    # Se seleccionan columnas y no la entidad ORM: no hace falta una instancia
    # con identity map por fila para calcular un puñado de intersecciones, y
    # así tampoco hay relaciones lazy que puedan explotar bajo async.
    stmt = (
        select(ExpenseEntry.description, ExpenseEntry.category_id, ExpenseCategory.name)
        .join(ExpenseCategory, ExpenseCategory.id == ExpenseEntry.category_id)
        .where(
            ExpenseEntry.tenant_id == tenant_id,
            ExpenseEntry.description.is_not(None),
            ExpenseEntry.description != "",
        )
        .order_by(ExpenseEntry.expense_date.desc(), ExpenseEntry.id.desc())
        .limit(CORPUS_LIMIT)
    )
    rows = (await db.execute(stmt)).all()

    corpus: list[_CorpusRow] = []
    for description, category_id, category_name in rows:
        tokens = normalize(description)
        if tokens:
            corpus.append((tokens, category_id, category_name, description))

    # Dos requests concurrentes con la caché fría consultan las dos y la última
    # pisa a la primera. Es idempotente y cuesta una query de más; serializarlo
    # con un lock costaría más de lo que ahorra.
    _cache[tenant_id] = (now, corpus)
    _cache.move_to_end(tenant_id)
    while len(_cache) > CACHE_MAX_TENANTS:
        _cache.popitem(last=False)
    return corpus


def _best_match(
    corpus: list[_CorpusRow], description: str, threshold: float
) -> CategorySuggestion | None:
    tokens = normalize(description)
    if not tokens:
        return None
    best: CategorySuggestion | None = None
    for cand_tokens, category_id, category_name, cand_desc in corpus:
        score = jaccard(tokens, cand_tokens)
        if score < threshold:
            continue
        if best is None or score > best.score:
            best = CategorySuggestion(
                category_id=category_id,
                category_name=category_name,
                score=score,
                matched_description=cand_desc,
            )
            if score == 1.0:  # descripción idéntica: no hay nada mejor
                break
    return best


async def suggest_category(
    db: AsyncSession,
    tenant_id: int,
    description: str,
    *,
    threshold: float = THRESHOLD,
) -> CategorySuggestion | None:
    """La categoría del gasto histórico más parecido, o None.

    Ojo con dónde se llama desde el frontend: **no va por tecleo.** Dispara
    on-blur del campo descripción y cuando vuelve el lector de comprobantes.
    Colgarla del onChange convierte una consulta por gasto en una por letra, y
    ninguna caché arregla un patrón de llamada equivocado.
    """
    if not description or not description.strip():
        return None
    corpus = await _load_corpus(db, tenant_id)
    return _best_match(corpus, description, threshold)


async def suggest_categories_bulk(
    db: AsyncSession,
    tenant_id: int,
    descriptions: Sequence[str],
    *,
    threshold: float = THRESHOLD,
) -> list[CategorySuggestion | None]:
    """Igual que `suggest_category` pero con una sola carga del corpus.

    Existe para el importador de resúmenes, que resuelve decenas de filas en el
    mismo request de preview: llamar N veces a `suggest_category` funcionaría
    (la caché absorbe las N-1 restantes) pero deja el comportamiento a merced
    del TTL, y una preview no debería depender de eso.
    """
    if not descriptions:
        return []
    corpus = await _load_corpus(db, tenant_id)
    return [
        _best_match(corpus, d, threshold) if d and d.strip() else None
        for d in descriptions
    ]

"""Lo que devuelve leer un comprobante."""
# Alias porque el campo se llama `date` y taparía al tipo dentro del cuerpo
# de la clase. Mismo apaño que `routers/expenses.py`.
from datetime import date as _date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

SourceKind = Literal["text", "pdf", "image", "none"]


class ReceiptDraft(BaseModel):
    """Un borrador de gasto. **Nunca un gasto.**

    Todo campo es opcional porque un comprobante ilegible tiene que poder
    devolver un borrador vacío en vez de un error: el resultado correcto de "no
    pude leer esto" es un formulario en blanco que la persona llena en diez
    segundos, no una pantalla de error.

    `confidence` es global y `fields` la abre por campo, porque no se degradan
    juntas: el monto sale confiable con regex, la fecha bastante, y la
    descripción es texto arbitrario en posición arbitraria. La pantalla puede
    decidir qué preseleccionar y qué dejar en blanco con eso.
    """
    amount: Decimal | None = None
    date: _date | None = None
    description: str | None = None
    currency: Literal["ARS", "USD"] | None = None

    confidence: float = 0.0
    fields: dict[str, float] = {}

    source_kind: SourceKind = "none"
    engine: str = "none"
    # Legible por una persona. Se muestra como aviso, nunca como error.
    error: str | None = None

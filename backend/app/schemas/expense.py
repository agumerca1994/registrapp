from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, field_validator

from app.models.expense import EXPENSE_SOURCE_MANUAL, EXPENSE_SOURCES_USER_ENTRY


class ExpenseCategoryCreate(BaseModel):
    name: str
    color: str | None = None
    is_fixed: bool = False


class ExpenseCategoryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    color: str | None
    is_fixed: bool


class CategorySuggestionOut(BaseModel):
    """Lo que devuelve `GET /expenses/categories/suggest`.

    Lleva `matched_description` a propósito: la pantalla puede explicar *por
    qué* sugiere lo que sugiere ("como «COTO CICSA»"), y una sugerencia que se
    puede auditar de un vistazo es la diferencia entre confiar en ella y
    desactivarla.
    """
    category_id: int
    category_name: str
    score: float
    matched_description: str


class RecentCategoryOut(BaseModel):
    """Una categoría para los chips de /registrar."""
    model_config = {"from_attributes": True}

    id: int
    name: str
    color: str | None = None
    use_count: int = 0


class ExpenseEntryCreate(BaseModel):
    category_id: int | None = None
    amount: Decimal
    description: str | None = None
    expense_date: date
    notes: str | None = None
    currency: str = "ARS"
    # De qué pantalla vino. El cliente puede declarar **cuál de sus propias
    # superficies** es —el formulario de /expenses, /registrar, la hoja de
    # compartir, el Atajo— porque eso es lo único que sabe él y las cuatro
    # afirman lo mismo: lo cargó una persona logueada.
    #
    # Lo que NO puede es reclamar una procedencia de sistema ("credit_card",
    # "import", "shared_split", "mortgage"): esas afirman que un proceso las
    # generó, y las setea únicamente el código que las genera. Por eso el
    # validador acepta sólo EXPENSE_SOURCES_USER_ENTRY y cualquier otra cosa
    # cae a "manual" en lugar de rechazar el alta — un valor raro en un campo
    # de telemetría no es motivo para perderle el gasto a nadie.
    source: str | None = None

    @field_validator("source")
    @classmethod
    def _only_user_entry_sources(cls, v: str | None) -> str:
        if v in EXPENSE_SOURCES_USER_ENTRY:
            return v
        return EXPENSE_SOURCE_MANUAL


class ExpenseEntryUpdate(BaseModel):
    category_id: int | None = None
    amount: Decimal | None = None
    description: str | None = None
    expense_date: date | None = None
    notes: str | None = None
    currency: str | None = None


class ExpenseEntryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    category_id: int
    amount: Decimal
    description: str | None
    expense_date: date
    notes: str | None
    payment_method: str | None
    entity: str | None
    currency: str = "ARS"
    # De dónde vino. NULL en todo lo anterior a la columna; lo setea siempre
    # el servidor. Ver EXPENSE_SOURCES en models/expense.py.
    source: str | None = None
    created_at: datetime
    category: ExpenseCategoryOut

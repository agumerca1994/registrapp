from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

PayeeKind = Literal["proveedor", "empleado", "otro"]


class PayeeCreate(BaseModel):
    name: str
    kind: PayeeKind = "proveedor"
    default_category_id: int | None = None
    notes: str | None = None


class PayeeUpdate(BaseModel):
    """Sólo se aplica lo que viene en el body: un `null` explícito en
    `default_category_id` o `notes` los borra."""
    name: str | None = None
    kind: PayeeKind | None = None
    default_category_id: int | None = None
    notes: str | None = None
    is_active: bool | None = None


class PayeeOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    kind: str
    default_category_id: int | None = None
    notes: str | None = None
    is_active: bool = True


# ── Productos ────────────────────────────────────────────────────────────────

ProductKind = Literal["reventa", "elaborado"]
ProductUnit = Literal["unidad", "porcion", "kg"]


class ProductCreate(BaseModel):
    name: str
    kind: ProductKind = "elaborado"
    unit: ProductUnit = "unidad"
    sale_price: Decimal | None = None
    # Sin decir: los de reventa llevan stock y los elaborados no.
    track_stock: bool | None = None
    min_stock: Decimal | None = None


class ProductUpdate(BaseModel):
    name: str | None = None
    kind: ProductKind | None = None
    unit: ProductUnit | None = None
    sale_price: Decimal | None = None
    track_stock: bool | None = None
    min_stock: Decimal | None = None
    is_active: bool | None = None


class ProductOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    kind: str
    unit: str
    sale_price: Decimal | None = None
    track_stock: bool = False
    min_stock: Decimal | None = None
    is_active: bool = True


# ── Ventas ───────────────────────────────────────────────────────────────────

PaymentMethod = Literal["efectivo", "debito", "credito", "mercadopago", "transferencia", "otro"]


class SaleLineIn(BaseModel):
    """Un producto del catálogo o un texto libre ("2 porciones de tarta")."""
    product_id: int | None = None
    description: str | None = None
    qty: Decimal = Decimal(1)
    unit_price: Decimal | None = None


class SalePaymentIn(BaseModel):
    method: PaymentMethod
    amount: Decimal


class SaleIn(BaseModel):
    sale_date: date
    lines: list[SaleLineIn] = []
    payments: list[SalePaymentIn]
    notes: str | None = None
    # El id que el celular le pone a cada alta: un doble toque o un reintento
    # con mala señal devuelve la misma venta en vez de cobrar dos veces.
    client_ref: str | None = Field(default=None, max_length=36)


class CloseIn(BaseModel):
    """Lo CONTADO al cerrar el día, por medio de pago. Un medio que no viene es
    un medio en el que no se contó nada. `units`: lo que salió de cada
    producto con stock (sólo `product_id` y `qty`)."""
    counted: list[SalePaymentIn]
    units: list[SaleLineIn] = []
    notes: str | None = None


class SaleLineOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    product_id: int | None = None
    description: str | None = None
    qty: Decimal
    unit_price: Decimal | None = None


class SalePaymentOut(BaseModel):
    model_config = {"from_attributes": True}

    method: str
    amount: Decimal


class SaleOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sale_date: date
    kind: str
    total: Decimal
    source: str
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    lines: list[SaleLineOut] = []
    payments: list[SalePaymentOut] = []


class MethodLine(BaseModel):
    method: str
    ticketed: Decimal
    # Sólo con cierre: lo contado, y contado − ventas (negativo = falta plata).
    counted: Decimal | None = None
    diff: Decimal | None = None


class DaySummary(BaseModel):
    sale_date: date
    tickets: list[SaleOut]
    close: SaleOut | None = None
    by_method: list[MethodLine]
    ticketed_total: Decimal
    counted_total: Decimal | None = None
    # Lo que entra al libro: lo contado si hay cierre, si no la suma de las ventas.
    total: Decimal
    warnings: list[str] = []


class DayBrief(BaseModel):
    sale_date: date
    total: Decimal
    tickets: int
    closed: bool



# ── Stock ────────────────────────────────────────────────────────────────────

class StockLineIn(BaseModel):
    """Lo que entra al stock con una compra."""
    product_id: int
    qty: Decimal
    unit_cost: Decimal | None = None


class StockMovementIn(BaseModel):
    product_id: int
    kind: Literal["produccion", "merma", "compra"]
    # En positivo: el tipo decide si suma o resta.
    qty: Decimal
    movement_date: date
    unit_cost: Decimal | None = None
    notes: str | None = None


class StockCountIn(BaseModel):
    product_id: int
    counted_qty: Decimal


class StockCountsIn(BaseModel):
    movement_date: date
    counts: list[StockCountIn]


class StockMovementOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    product_id: int
    kind: str
    qty: Decimal
    movement_date: date
    unit_cost: Decimal | None = None
    counted_qty: Decimal | None = None
    expense_entry_id: int | None = None
    sale_id: int | None = None
    notes: str | None = None


class StockLevelOut(BaseModel):
    product_id: int
    name: str
    unit: str
    on_hand: Decimal
    min_stock: Decimal | None = None
    alert: str | None = None  # "negativo" | "bajo"

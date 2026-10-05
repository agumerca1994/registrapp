"""Sesiones de conciliación y el embudo de captura.

`ReconciliationSession` es una lectura de un resumen del banco comparada
contra un resumen de la app: guarda lo parseado (NUNCA el PDF — se procesa en
memoria y se descarta; tampoco números de cuenta ni domicilio) y el veredicto.
`ReconciliationAction` es cada corrección propuesta, con el `before` que hace
posible deshacer el último grupo aplicado.

`CaptureRule` son las reglas por hogar que el matching aplica antes de
preguntar (resumen→tarjeta, comercio→categoría, exclusiones). `CaptureEvent`
es el embudo: un evento por intento de captura, con el motivo cuando el código
no pudo resolver — la medición que decide si la IA de respaldo se construye.

Los JSON usan `with_variant(JSONB)` para ser JSONB en Postgres y seguir
creables en el SQLite de los tests (JSONB pelado no compila ahí).
"""
from datetime import datetime, date

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

JSONVariant = JSON().with_variant(JSONB(), "postgresql")

# status de una sesión
SESSION_READY = "ready"              # diferencias clasificadas, cierre al centavo
SESSION_UNEXPLAINED = "unexplained"  # los números no cierran: no se proponen cambios
SESSION_NEEDS_AI = "needs_ai"        # el código no pudo leer (sin parser, totales, imagen…)
SESSION_NEEDS_CHOICE = "needs_choice"  # falta elegir tarjeta o período
SESSION_APPLIED = "applied"          # al menos un grupo aplicado
SESSION_CLOSED = "closed"            # conciliada: diferencia 0 o explicada y aceptada

# status de una acción
ACTION_PROPOSED = "proposed"
ACTION_APPLIED = "applied"
ACTION_DISCARDED = "discarded"
ACTION_UNDONE = "undone"
ACTION_NEEDS_APP = "needs_app"  # compartidos / cuotas que la API no toca


class ReconciliationSession(Base):
    __tablename__ = "reconciliation_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    channel: Mapped[str] = mapped_column(String(10), default="app", server_default="app")
    card_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_cards.id", ondelete="SET NULL"), nullable=True
    )
    statement_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_card_statements.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), index=True)
    # Por qué quedó needs_ai / needs_choice (no_parser, totals_mismatch,
    # encrypted, card_ambiguous, period_ambiguous…).
    reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    bank_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cardholder: Mapped[str | None] = mapped_column(String(120), nullable=True)
    period_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    period_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    closing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Ítems del banco ya parseados + totales de control; nunca el PDF.
    parsed: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    # {"ARS": {"bank_total": "...", "app_total": "...", "difference": "...",
    #   "explained": "...", "unexplained": "..."}, "USD": {...}}
    totals: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    # Opciones pendientes cuando status=needs_choice.
    choices: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    actions: Mapped[list["ReconciliationAction"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ReconciliationAction.id"
    )


class ReconciliationAction(Base):
    __tablename__ = "reconciliation_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("reconciliation_sessions.id", ondelete="CASCADE"), index=True
    )
    # Clase de diferencia: missing | surplus | rounding | amount_diff |
    # double_count | usd_fix | dates.
    klass: Mapped[str] = mapped_column(String(16))
    # Operación: create_item | update_item | delete_item | update_statement.
    op: Mapped[str] = mapped_column(String(20))
    # Ítem de la app involucrado, si hay.
    item_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_card_items.id", ondelete="SET NULL"), nullable=True
    )
    # Qué se propone escribir (montos como str).
    payload: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    # Snapshot previo para deshacer; en create, el id creado se guarda acá
    # después de aplicar.
    before: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="proposed", server_default="proposed")
    applied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    session: Mapped["ReconciliationSession"] = relationship(back_populates="actions")


class CaptureRule(Base):
    __tablename__ = "capture_rules"
    __table_args__ = (UniqueConstraint("tenant_id", "kind", "match", name="uq_capture_rule"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    # statement_card (banco|titular → card_id) | merchant_category
    # (comercio → categoría/descripción) | exclude (comercio que no se carga).
    kind: Mapped[str] = mapped_column(String(20))
    # Clave normalizada con fold() — minúsculas y sin tildes.
    match: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class CaptureEvent(Base):
    __tablename__ = "capture_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, index=True)  # sin FK, como app_logs
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel: Mapped[str] = mapped_column(String(10))  # app | whatsapp | mcp
    input_kind: Mapped[str] = mapped_column(String(10))  # pdf | image | text | audio
    # parsed_code | needs_ai | interest | ai_ok | ai_failed
    outcome: Mapped[str] = mapped_column(String(12), index=True)
    # no_parser | totals_mismatch | encrypted | no_text | image |
    # unparseable_text | audio
    reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    bank_detected: Mapped[str | None] = mapped_column(String(30), nullable=True)
    pages_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pages_with_movements: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Estimación de lo que la IA habría leído (páginas útiles como texto) —
    # es lo que convierte el embudo en un costo proyectado en dólares.
    est_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)

"""La fecha de la Argentina, no la del servidor (que corre en UTC)."""
from datetime import date, datetime

from app.services import clock, quick_capture


def _at(monkeypatch, *args):
    monkeypatch.setattr(clock, "ar_now", lambda: datetime(*args, tzinfo=clock.AR_TZ))


def test_business_day_cuts_at_five(monkeypatch):
    _at(monkeypatch, 2026, 10, 10, 0, 30)   # sábado 00:30: todavía es el viernes
    assert clock.business_today() == date(2026, 10, 9)
    _at(monkeypatch, 2026, 10, 10, 5, 0)
    assert clock.business_today() == date(2026, 10, 10)


def test_quick_capture_defaults_to_argentina_today(monkeypatch):
    # 23:00 en Buenos Aires ya es el día siguiente en UTC; el gasto es de hoy.
    _at(monkeypatch, 2026, 10, 9, 23, 0)
    draft = quick_capture.parse_quick_text("12 lucas verdu")
    assert draft.expense_date == date(2026, 10, 9)
    draft = quick_capture.parse_quick_text("12 lucas verdu ayer")
    assert draft.expense_date == date(2026, 10, 8)

"""El motor de matching contra el escenario del caso de referencia.

Reproduce, con números a escala, cada clase del doc de conciliación: los
faltantes, los dos cargos iguales de Aerolíneas, el taxi que sumó dos cargos,
el redondeo de una cuota 2/6, el USD mal identificado (PlayStation cargado
como Google One) y el sobrante. El criterio de éxito es el del doc: la
diferencia entre el banco y la app queda explicada al centavo.
"""
from datetime import date
from decimal import Decimal

from app.services.reconcile import matching
from app.services.reconcile.matching import AppItem, BankItem

D = Decimal


def _bank(idx, day, desc, amount, currency="ARS", cupon=None, cuota=None):
    return BankItem(
        idx=idx, item_date=date(2026, 9, day), description=desc,
        amount=D(amount), currency=currency, cupon=cupon, cuota=cuota,
    )


def _app(id, day, desc, amount, currency="ARS", cuota=None, **kw):
    return AppItem(
        id=id, item_date=date(2026, 9, day), description=desc,
        amount=D(amount), currency=currency, cuota=cuota, **kw,
    )


def _reference_case():
    bank = [
        _bank(0, 21, "CEBRA ARCOS", "13330.00", cupon="123456"),
        _bank(1, 10, "VERDULERIA DON PEPE", "16500.00"),          # faltante
        _bank(2, 21, "AEROLINEAS ARGENTINAS", "54450.00"),
        _bank(3, 25, "AEROLINEAS ARGENTINAS", "54450.00"),        # 2º cargo → faltante
        _bank(4, 4, "MERPAGO*EBANXSA", "5353.00"),
        _bank(5, 4, "MERPAGO*EBANXSA", "84.00"),
        _bank(6, 5, "MAQUINA DE PINTAR", "10000.00", cuota=(2, 6)),
        _bank(7, 28, "PLAYSTATION 787094463USD 7,99", "7.99", currency="USD"),
        _bank(8, 20, "ANTHROPIC", "5.00", currency="USD"),
    ]
    app = [
        _app(1, 21, "Librería Cebra", "13330.00"),
        _app(2, 22, "Vuelo a Bs As", "54450.00"),
        _app(3, 4, "Taxi", "5437.00"),                            # 5353 + 84 sumados
        _app(4, 4, "Taxi propina", "84.00"),
        _app(5, 5, "Máquina de pintar", "10003.05", cuota=(2, 6), is_root=False),
        _app(6, 30, "Google One", "9.99", currency="USD"),        # era PlayStation
        _app(7, 20, "Claude", "5.00", currency="USD"),
        _app(8, 1, "Gasto viejo de prueba", "9999.00"),           # sobrante
    ]
    return bank, app


def test_reference_case_classes():
    bank, app = _reference_case()
    report = matching.match_statement(bank, app)

    # Faltantes: la verdulería y el segundo cargo de Aerolíneas (dos cargos
    # iguales en el banco, uno solo en la app — cada ítem se usa una vez).
    assert sorted(str(b.amount) for b in report.missing) == ["16500.00", "54450.00"]
    missing_descs = {b.description for b in report.missing}
    assert "VERDULERIA DON PEPE" in missing_descs
    assert "AEROLINEAS ARGENTINAS" in missing_descs

    # El taxi que sumó dos cargos: corregir 5437 → 5353 (el 84 matchea solo).
    dc = report.pairs_of(matching.DOUBLE_COUNT)
    assert len(dc) == 1
    assert dc[0].app.description == "Taxi"
    assert dc[0].bank.amount == D("5353.00")

    # Redondeo de la cuota 2/6: 10003,05 → 10000,00 (±$5).
    rounding = report.pairs_of(matching.ROUNDING)
    assert len(rounding) == 1
    assert rounding[0].app.cuota == (2, 6)

    # USD mal identificado: PlayStation 7,99 estaba cargado como Google One
    # 9,99; Claude 5,00 matchea con ANTHROPIC aunque no compartan tokens
    # (candidato único).
    usd_fix = report.pairs_of(matching.USD_FIX)
    assert len(usd_fix) == 1
    assert usd_fix[0].bank.description.startswith("PLAYSTATION")
    assert usd_fix[0].app.description == "Google One"
    matched = report.pairs_of(matching.MATCHED)
    assert any(p.bank.description == "ANTHROPIC" for p in matched)

    # Sobrante.
    assert [a.description for a in report.surplus] == ["Gasto viejo de prueba"]


def test_reference_case_closes_to_the_cent():
    bank, app = _reference_case()
    report = matching.match_statement(bank, app)

    ars = report.totals["ARS"]
    assert ars["difference"] == ars["explained"]
    assert ars["unexplained"] == 0
    usd = report.totals["USD"]
    assert usd["unexplained"] == 0
    assert report.closes


def test_unexplained_difference_does_not_close():
    # Un faltante cuyo monto no explica la diferencia (totales manipulados):
    # acá se simula con un ítem de la app que no está en el banco y un
    # banco cuya suma difiere — la clase sobrante lo explica, así que para
    # forzar un no-cierre se usa un reporte con totales editados.
    bank = [_bank(0, 10, "SUPER", "1000.00")]
    app = [_app(1, 10, "Super", "1000.00")]
    report = matching.match_statement(bank, app)
    assert report.closes
    report.totals["ARS"]["unexplained"] = D("0.05")
    assert not report.closes


def test_coupon_match_beats_amount_and_date():
    """Un cupón guardado matchea aunque monto y fecha difieran (corrección)."""
    bank = [_bank(0, 2, "MERPAGO*LUCIANOGABRIELCAM", "15000.00", cupon="777888")]
    app = [_app(1, 28, "Ferreteria - Mercadopago", "14000.00", bank_coupon="777888")]
    report = matching.match_statement(bank, app)
    diff = report.pairs_of(matching.AMOUNT_DIFF)
    assert len(diff) == 1
    assert diff[0].app.id == 1
    assert report.closes


def test_cuotas_ignore_dates():
    """El banco imprime la fecha de compra original; la app fecha la cuota n
    meses después — las cuotas matchean por (n/N, monto), nunca por fecha."""
    bank = [BankItem(idx=0, item_date=date(2025, 10, 26), description="GMRA",
                     amount=D("86262.03"), currency="ARS", cuota=(11, 12))]
    app = [AppItem(id=1, item_date=date(2026, 8, 26), description="GMRA",
                   amount=D("86262.03"), currency="ARS", cuota=(11, 12), is_root=False)]
    report = matching.match_statement(bank, app)
    assert len(report.pairs_of(matching.MATCHED)) == 1
    assert not report.missing and not report.surplus


def test_usd_disambiguates_by_merchant():
    """Dos cargos USD del mismo monto: el comercio decide cuál es cuál."""
    bank = [
        _bank(0, 10, "SPOTIFY USD 9,99", "9.99", currency="USD"),
        _bank(1, 12, "NETFLIX.COM USD 9,99", "9.99", currency="USD"),
    ]
    app = [
        _app(1, 12, "Netflix", "9.99", currency="USD"),
        _app(2, 10, "Spotify", "9.99", currency="USD"),
    ]
    report = matching.match_statement(bank, app)
    matched = {p.bank.description.split()[0]: p.app.description for p in report.pairs_of(matching.MATCHED)}
    assert matched == {"SPOTIFY": "Spotify", "NETFLIX.COM": "Netflix"}

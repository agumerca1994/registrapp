"""Tests sobre resúmenes reales, si están.

`tests/fixtures/private/` está gitignored (el repo es público y estos archivos
traen nombre, dirección y números de cuenta). Cada `<banco>_<período>_lines.txt`
es el texto del PDF en el layout de líneas de pdfplumber; sin los archivos,
estos tests se saltean y la suite sintética cubre la estructura.
"""
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.statement_parsers import bbva

PRIVATE = Path(__file__).parent / "fixtures" / "private"

BBVA_AGO = PRIVATE / "bbva_2026-08_lines.txt"


def _load(path: Path) -> list[str]:
    return [ln.strip() for ln in path.read_text(encoding="utf-8").split("\n") if ln.strip()]


@pytest.mark.skipif(not BBVA_AGO.exists(), reason="fixture privado ausente")
def test_bbva_agosto_2026_real():
    """El resumen real de agosto 2026 (cierre 27-Ago, vto 07-Sep).

    Trae el caso que el fixture sintético no tenía: DOS bloques "Consumos"
    con el mismo titular — los totales por bloque tienen que acumularse.
    """
    lines = _load(BBVA_AGO)
    assert bbva.detect(lines)
    data = bbva.parse_lines(lines)

    assert data["closing_date"] == "2026-08-27"
    assert data["due_date"] == "2026-09-07"
    assert (data["year"], data["month"]) == (2026, 8)
    assert data["saldo_actual_ars"] == "1434363.23"
    assert data["saldo_actual_usd"] == "27.47"
    assert data["next_closing_date"] == "2026-10-01"

    # Un solo statement (mismo titular en los dos bloques), 31 ítems (2 + 29).
    assert len(data["statements"]) == 1
    stmt = data["statements"][0]
    assert len(stmt["items"]) == 31

    # Los totales de ambos bloques, acumulados.
    assert stmt["block_total"] == {"ars": "1413096.85", "usd": "27.47"}

    # El control de totales con datos reales: lo extraído suma exactamente lo
    # que imprimió el banco, por moneda.
    ars = sum(Decimal(i["amount"]) for i in stmt["items"] if i["currency"] == "ARS")
    usd = sum(Decimal(i["amount"]) for i in stmt["items"] if i["currency"] == "USD")
    assert ars == Decimal(stmt["block_total"]["ars"])
    assert usd == Decimal(stmt["block_total"]["usd"])

    # Y el cierre completo: consumos + impuestos == saldo actual del banco.
    taxes = sum(Decimal(t["amount"]) for t in data["excluded"]["taxes_and_fees"])
    assert ars + taxes == Decimal(data["saldo_actual_ars"])
    assert usd == Decimal(data["saldo_actual_usd"])

    # Pagos excluidos (4) e impuestos (4) — y la carátula, que repite estos
    # renglones, no los duplica.
    assert len(data["excluded"]["payments"]) == 4
    assert len(data["excluded"]["taxes_and_fees"]) == 4

    # Cuotas: 14 ítems en cuotas, con las puntas bien leídas.
    cuotas = [i for i in stmt["items"] if i["item_type"] == "installment"]
    assert len(cuotas) == 14
    by_desc = {i["description"]: i for i in stmt["items"]}
    assert (by_desc["GMRA"]["installment_number"], by_desc["GMRA"]["installment_count"]) == (11, 12)
    assert by_desc["HIPER CHANGOMAS CBA OE"]["installment_number"] == 7
    assert by_desc["CABA INNOVACIONES"]["installment_number"] == 1

    # USD con el monto repetido en la descripción, cupón bien separado.
    assert by_desc["APPLE.COM BILL MQVS5H1YJUSD 9,49"]["currency"] == "USD"
    assert by_desc["APPLE.COM BILL MQVS5H1YJUSD 9,49"]["cupon"] == "131655"
    assert by_desc["PLAYSTATION 787094463USD 7,99"]["amount"] == "7.99"

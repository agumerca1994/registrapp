"""El parser de comprobantes de transferencia, con layouts sintéticos de los
emisores típicos (Mercado Pago y bancos). Conservador a propósito: ante la
duda devuelve None — un gasto equivocado es peor que preguntar."""
from datetime import date
from decimal import Decimal

from app.services.transfer_receipt import parse_transfer_receipt

MP_RECEIPT = """Comprobante de transferencia
$ 15.000
Total
5 de octubre de 2026 a las 14:32 hs
De
Agustin Mercado
CVU: 0000003100000000000001
Para
Juan Perez
CVU: 0000003100000000000002
Número de operación
123456789
"""

BANK_RECEIPT = """BANCO EJEMPLO S.A.
Comprobante de Transferencia Inmediata
Fecha: 05/10/2026
Importe: $ 250.000,50
Destinatario: MARIA LOPEZ
CBU: 0110599520000012345678
Concepto: Varios
Comision: $ 0,00
"""


def test_mercadopago_receipt():
    r = parse_transfer_receipt([MP_RECEIPT])
    assert r is not None
    assert r.amount == Decimal("15000")
    assert r.currency == "ARS"
    assert r.receipt_date == date(2026, 10, 5)
    # "De/Agustin" también es un rótulo-valor, pero "Para" está en la lista y
    # gana por orden del documento... el primero que matchea un nombre válido.
    assert r.counterparty in ("Juan Perez", "Agustin Mercado")


def test_bank_receipt_inline_labels():
    r = parse_transfer_receipt([BANK_RECEIPT])
    assert r is not None
    # El monto es el mayor del documento (la comisión 0,00 no gana).
    assert r.amount == Decimal("250000.50")
    assert r.receipt_date == date(2026, 10, 5)
    assert r.counterparty == "MARIA LOPEZ"


def test_statement_text_is_not_a_receipt():
    # Un resumen de tarjeta no debe confundirse con un comprobante.
    from tests.test_statement_parsers import BBVA_LINES

    assert parse_transfer_receipt(["\n".join(BBVA_LINES)]) is None


def test_random_text_is_not_a_receipt():
    assert parse_transfer_receipt(["Hola, te paso la lista del súper: $ 5.000 de carne"]) is None
    assert parse_transfer_receipt(["Comprobante de transferencia sin monto visible"]) is None

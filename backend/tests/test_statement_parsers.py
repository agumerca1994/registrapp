"""Tests de los parsers de resúmenes, sobre líneas de texto sintéticas.

Los PDF reales no están en el repo (datos personales, repo público): estos
fixtures reproducen la *estructura* de cada formato — cuotas, cupones, USD,
pagos excluidos, planes Zeta, totales por bloque — con datos inventados.
Si existe `tests/fixtures/private/` (gitignored) con texto real, los tests
de ese directorio corren además de éstos.
"""
from decimal import Decimal

from app.services.statement_parsers import banco_nacion, banco_nacion_mastercard, bbva, naranjax
from app.services.statement_parsers.pages import pages_with_movements

# ---------------------------------------------------------------- BBVA ------

BBVA_LINES = [
    "BANCO BBVA ARGENTINA S.A.",
    "VISA SIGNATURE CONSOLIDADO",
    "cuenta 1234567",
    "CIERRE ACTUAL VENCIMIENTO ACTUAL SALDO ACTUAL",
    "01-Oct-26 09-Oct-26 2.689.290,74 30,97",
    "CIERRE ANTERIOR VENCIMIENTO ANTERIOR PRÓXIMO CIERRE PRÓXIMO VENCIMIENTO",
    "01-Sep-26 09-Sep-26 03-Nov-26 10-Nov-26",
    "Consumos Juan Perez",
    "FECHA DESCRIPCIÓN NRO. CUPÓN PESOS DÓLARES",
    "21-Sep-26 CEBRA ARCOS C.01/03 123456 13.330,00",
    "15-Sep-26 MERPAGO*EBANXSA 654321 5.353,00",
    "20-Sep-26 ANTHROPIC USD 5,00 111222 5,00",
    "TOTAL CONSUMOS DE JUAN PEREZ 18.683,00 5,00",
    "Consumos Maria Lopez",
    "FECHA DESCRIPCIÓN NRO. CUPÓN PESOS DÓLARES",
    "25-Sep-26 CHANGOMAS C.08/12 999888 20.000,00",
    "TOTAL CONSUMOS DE MARIA LOPEZ 20.000,00 0,00",
    "Sus pagos y ajustes realizados",
    "FECHA DESCRIPCIÓN PESOS DÓLARES",
    "10-Sep-26 SU PAGO EN PESOS -500.000,00",
    "Impuestos, cargos e intereses",
    "FECHA DESCRIPCIÓN PESOS DÓLARES",
    "01-Oct-26 DB.RG 5617 30% 18.413,34",
    "Legales y avisos",
]


def test_bbva_detect():
    assert bbva.detect(BBVA_LINES)
    assert not naranjax.detect(BBVA_LINES)
    assert not banco_nacion.detect(BBVA_LINES)
    assert not banco_nacion_mastercard.detect(BBVA_LINES)


def test_bbva_header_and_period():
    data = bbva.parse_lines(BBVA_LINES)
    assert data["bank"] == "BBVA"
    assert data["account_number"] == "1234567"
    assert data["card_label"] == "VISA SIGNATURE"
    assert data["closing_date"] == "2026-10-01"
    assert data["due_date"] == "2026-10-09"
    assert data["saldo_actual_ars"] == "2689290.74"
    assert data["saldo_actual_usd"] == "30.97"
    # Cierre el día 1 → el período es el mes anterior (el caso real del doc:
    # cierre 01-Oct, período 2026-09).
    assert (data["year"], data["month"]) == (2026, 9)


def test_bbva_items_per_cardholder():
    data = bbva.parse_lines(BBVA_LINES)
    assert [s["cardholder"] for s in data["statements"]] == ["Juan Perez", "Maria Lopez"]

    juan = data["statements"][0]
    cebra, taxi, anthropic = juan["items"]
    assert cebra["description"] == "CEBRA ARCOS"
    assert cebra["item_type"] == "installment"
    assert (cebra["installment_number"], cebra["installment_count"]) == (1, 3)
    assert cebra["cupon"] == "123456"
    assert cebra["amount"] == "13330.00"
    assert taxi["description"] == "MERPAGO*EBANXSA"
    assert anthropic["currency"] == "USD"
    assert anthropic["amount"] == "5.00"

    maria = data["statements"][1]
    assert maria["items"][0]["installment_number"] == 8
    assert maria["items"][0]["installment_count"] == 12


def test_bbva_block_totals_and_excluded():
    data = bbva.parse_lines(BBVA_LINES)
    juan, maria = data["statements"]
    assert juan["block_total"] == {"ars": "18683.00", "usd": "5.00"}
    assert maria["block_total"] == {"ars": "20000.00", "usd": "0.00"}
    # El control de totales de la conciliación: los ítems ARS extraídos suman
    # exactamente el total del bloque que imprimió el banco.
    ars_sum = sum(Decimal(i["amount"]) for i in juan["items"] if i["currency"] == "ARS")
    assert ars_sum == Decimal(juan["block_total"]["ars"])

    assert data["excluded"]["payments"][0]["amount"] == "-500000.00"
    assert data["excluded"]["taxes_and_fees"][0]["description"] == "DB.RG 5617 30%"


# ------------------------------------------------------------ Naranja X -----

NARANJAX_LINES = [
    "Resumen de tarjeta Naranja X",
    "Tu resumen anterior cerró el 28/08, venció el 09/09, por $100.000,00.",
    "Tu resumen actual cerró el 28/09.",
    "Tu total a pagar es $150.000,50 y vence el 09/10/26.",
    "Tu próximo resumen cierra el 28/10, y vence el 10/11.",
    "Consumos tarjeta de crédito de FLORENCIA",
    "FECHA TARJETA CUPON DETALLE CUOTA/PLAN $ U$S",
    "21/09/26 NX 1234 001122 SUPERMERCADO DIA 15.000,00",
    "22/09/26 NX 1234 003344 CASA GARCIA 02/06 8.500,00",
    "23/09/26 NX 1234 005566 MUEBLERIA LOPEZ Zeta 30.000,00",
    "24/09/26 ZETA 08/26 02/03 10.000,00",
    "25/09/26 NX 1234 007788 NETFLIX Deb.Aut. 4.999,00",
    "Total consumos de FLORENCIA 38.499,00",
    "Otros cargos:",
    "26/09/26 *IMPUESTO DE SELLOS 1.234,00",
    "Información legal",
]


def test_naranjax_detect():
    assert naranjax.detect(NARANJAX_LINES)
    assert not bbva.detect(NARANJAX_LINES)


def test_naranjax_header():
    data = naranjax.parse_lines(NARANJAX_LINES)
    assert data["closing_date"] == "2026-09-28"
    assert data["due_date"] == "2026-10-09"
    assert data["prev_closing_date"] == "2026-08-28"
    assert data["next_due_date"] == "2026-11-10"
    assert data["saldo_actual_ars"] == "150000.50"
    assert (data["year"], data["month"]) == (2026, 9)


def test_naranjax_rows():
    data = naranjax.parse_lines(NARANJAX_LINES)
    items = data["statements"][0]["items"]
    by_desc = {i["description"]: i for i in items}

    assert by_desc["SUPERMERCADO DIA"]["item_type"] == "single"
    assert by_desc["SUPERMERCADO DIA"]["cupon"] == "001122"

    garcia = by_desc["CASA GARCIA"]
    assert (garcia["installment_number"], garcia["installment_count"]) == (2, 6)

    # Compra Zeta: el PDF muestra el total ($30.000) pero este ciclo cobra un
    # tercio — entra como cuota 1/3 por $10.000 con zeta_plan=True.
    zeta = by_desc["MUEBLERIA LOPEZ"]
    assert zeta["amount"] == "10000.00"
    assert (zeta["installment_number"], zeta["installment_count"]) == (1, 3)
    assert zeta["zeta_plan"] is True

    # La línea "ZETA 08/26" consolidada NO entra: es la misma plata que la
    # compra original ya propaga.
    assert "ZETA 08/26" not in by_desc
    assert len(items) == 4

    assert by_desc["NETFLIX"]["cupon"] == "007788"

    assert data["statements"][0]["block_total"] == {"ars": "38499.00", "usd": None}
    assert data["excluded"]["fees"][0]["description"] == "IMPUESTO DE SELLOS"


# --------------------------------------------------------- Banco Nación -----

BN_LINES = [
    "BANCO DE LA NACION ARGENTINA",
    "N DE CUENTA: 123456",
    "CIERRE ACTUAL: 28 Sep. 26 VENCIMIENTO ACTUAL: 09 Oct. 26",
    "CIERRE ANTERIOR 28 Ago. 26 VTO. ANTERIOR 09 Sep. 26",
    "PROXIMO CIERRE 28 Oct. 26 PROXIMO VTO 10 Nov. 26",
    "FECHA COMPROBANTE DETALLE IMPORTE",
    "21-09-26 1234567 FARMACIA DEL PUEBLO 12.500,00",
    "22-09-26 7654321 ELECTRO HOGAR C.03/12 9.999,99",
    "10-09-26 SU PAGO EN PESOS 100.000,00-",
    "TARJETA 4919 Total Consumos de PEREZ JUAN 22.499,99 0,00",
    "28-09-26 $ IMPUESTO DE SELLOS 1.500,00",
    "SALDO ACTUAL: $ 24.000,00",
]


def test_banco_nacion_detect():
    assert banco_nacion.detect(BN_LINES)
    assert not banco_nacion_mastercard.detect(BN_LINES)


def test_banco_nacion_parse():
    data = banco_nacion.parse_lines(BN_LINES)
    assert data["closing_date"] == "2026-09-28"
    assert data["due_date"] == "2026-10-09"
    assert (data["year"], data["month"]) == (2026, 9)
    assert data["saldo_actual_ars"] == "24000.00"

    stmt = data["statements"][0]
    assert stmt["cardholder"] == "PEREZ JUAN"
    assert stmt["card"]["hint_last_4"] == "4919"
    assert stmt["block_total"] == {"ars": "22499.99", "usd": "0.00"}

    farmacia, electro = stmt["items"]
    assert farmacia["cupon"] == "1234567"
    assert (electro["installment_number"], electro["installment_count"]) == (3, 12)

    # El pago viene con el signo al final ("100.000,00-") y queda excluido.
    assert data["excluded"]["payments"][0]["amount"] == "-100000.00"
    assert data["excluded"]["fees"][0]["description"] == "IMPUESTO DE SELLOS"


# ---------------------------------------------- Banco Nación Mastercard -----

BNMC_LINES = [
    "BANCO DE LA NACION ARGENTINA - MASTERCARD",
    "Estado de cuenta al: 28-Sep-26 Vencimiento actual: 09-Oct-26",
    "Cierre Anterior: 28-Ago-26 Vencimiento Anterior: 09-Sep-26",
    "Próximo Cierre: 28-Oct-26 Próximo Vencimiento: 10-Nov-26",
    "SALDO ANTERIOR 50000,00",
    "21-Sep-26 SU PAGO 50000,00-",
    "CONSUMOS DEL MES",
    "21-Sep-26 LIBRERIA SAN MARTIN 1234567 12721,05",
    "22-Sep-26 GAZEBO JARDIN 02/12 7654321 3000,00",
    "TOTAL TITULAR PEREZ JUAN 15721,05 0,00",
    "SUBTOTAL",
    "I.V.A. 210,00",
    "SALDO ACTUAL 15931,05",
]


def test_bnmc_detect():
    assert banco_nacion_mastercard.detect(BNMC_LINES)
    assert not banco_nacion.detect(BNMC_LINES)


def test_bnmc_parse():
    data = banco_nacion_mastercard.parse_lines(BNMC_LINES)
    assert data["closing_date"] == "2026-09-28"
    assert (data["year"], data["month"]) == (2026, 9)
    # Sin separador de miles: "12721,05" es 12721.05.
    stmt = data["statements"][0]
    libreria, gazebo = stmt["items"]
    assert libreria["amount"] == "12721.05"
    assert libreria["cupon"] == "1234567"
    assert (gazebo["installment_number"], gazebo["installment_count"]) == (2, 12)

    assert stmt["cardholder"] == "PEREZ JUAN"
    assert stmt["block_total"] == {"ars": "15721.05", "usd": "0.00"}
    assert data["excluded"]["payments"][0]["amount"] == "-50000.00"
    assert data["excluded"]["fees"][0]["description"] == "I.V.A."


# ----------------------------------------------------------- Páginas --------

def test_pages_with_movements():
    header_page = "BANCO EJEMPLO S.A.\nResumen de cuenta\nHola Juan, tu información"
    consumos_page = "\n".join(BBVA_LINES[7:17])
    legal_page = (
        "Legales y avisos\nEl presente resumen se considera aceptado si no se "
        "impugna en 30 días.\nTasa nacional de interés vigente."
    )
    pages = [header_page, consumos_page, legal_page]
    assert pages_with_movements(pages) == [1]

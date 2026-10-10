"""La fecha de la Argentina, no la del servidor.

El contenedor corre en UTC, así que `date.today()` a las 22:00 de Buenos Aires
ya es mañana: un gasto cargado por WhatsApp a la noche quedaba con la fecha del
día siguiente, y "ayer" apuntaba a hoy. Toda fecha que el backend elige por su
cuenta (un gasto del bot sin fecha, el "hoy" de un comprobante) sale de acá.

`business_today()` es el día de un negocio: una rotisería que cierra a la 1
sigue vendiendo "el viernes" a las 00:30. Con el corte a las 05:00, lo que pasa
entre la medianoche y esa hora cuenta para el día anterior.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
BUSINESS_DAY_CUTOFF_HOUR = 5


def ar_now() -> datetime:
    return datetime.now(AR_TZ)


def ar_today() -> date:
    return ar_now().date()


def business_today(cutoff_hour: int = BUSINESS_DAY_CUTOFF_HOUR) -> date:
    return (ar_now() - timedelta(hours=cutoff_hour)).date()

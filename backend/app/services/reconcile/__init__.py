"""Conciliación de resúmenes de tarjeta contra la app.

El motor del doc de referencia, en código y sin IA: `matching` (el algoritmo
puro), `period` (elegir tarjeta y resumen), `rules` (lo aprendido por hogar),
`engine` (PDF → sesión con acciones propuestas) y `apply` (aplicar grupos
confirmados y deshacer). Sin auth, como `analytics.py`: lo usan el router,
el bot de WhatsApp y el conector MCP sin poder divergir.
"""
from app.services.reconcile.apply import apply_group, undo_last_group  # noqa: F401
from app.services.reconcile.engine import (  # noqa: F401
    GROUP_ORDER,
    record_event,
    resolve_session,
    start_session,
)

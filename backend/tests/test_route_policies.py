"""Toda ruta que identifica a un usuario decidió qué hace con un empleado.

La guardia de empleados va a nivel de router en `main.py` y por endpoint en los
routers mixtos (core/access.py). Este test es lo que la hace "denegado por
defecto" en la práctica: un router nuevo incluido sin guardia, o una ruta nueva
en un router mixto, lo rompe acá y no en la privacidad de un negocio.

También fija la lista de rutas SIN usuario: agregar una ruta pública es una
decisión, y tiene que quedar escrita en PUBLIC_ROUTES.
"""
from fastapi.routing import APIRoute

import app.main as main
from app.core import access
from app.core.firebase import get_current_user
from app.routers.internal_logs import _require_internal_key

POLICIES = {
    access.deny_employee, access.employee_allowed,
    access.get_staff_user, access.get_owner_user,
}

# Sin usuario de Firebase, a propósito.
PUBLIC_ROUTES = {
    ("GET", "/health"),
    ("POST", "/webhook/whatsapp"),               # secreto compartido de Evolution
    ("POST", "/auth/wa-link"),                   # canjea el token de un solo uso del bot
    ("GET", "/shared-expenses/invite/{token}"),  # la abre quien todavía no tiene cuenta
    # El OAuth del conector MCP: ahí el protocolo es la autenticación.
    ("GET", "/.well-known/oauth-protected-resource"),
    ("GET", "/.well-known/oauth-protected-resource/mcp"),
    ("GET", "/.well-known/oauth-authorization-server"),
    ("GET", "/.well-known/oauth-authorization-server/mcp"),
    ("GET", "/.well-known/openid-configuration"),
    ("POST", "/oauth/register"),
    ("GET", "/oauth/authorize"),
    ("POST", "/oauth/authorize"),
    ("POST", "/oauth/token"),
    ("POST", "/oauth/revoke"),
    ("GET", "/oauth/authorize/txn/{txn_id}"),
    ("POST", "/oauth/authorize/deny"),
}

# Rutas de Starlette sin las dependencias de FastAPI: el conector (auth propia
# por bearer token, que rechaza empleados en el verificador) y la documentación.
NON_API_ROUTES = {"/mcp", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}


def _calls(dependant, acc=None) -> set:
    acc = set() if acc is None else acc
    if dependant.call is not None:
        acc.add(dependant.call)
    for sub in dependant.dependencies:
        _calls(sub, acc)
    return acc


def _api_routes():
    for route in main.app.routes:
        if isinstance(route, APIRoute):
            calls = _calls(route.dependant)
            for method in route.methods:
                yield method, route.path, calls


def test_every_user_route_has_an_employee_policy():
    missing = sorted(
        (method, path) for method, path, calls in _api_routes()
        if get_current_user in calls and not (calls & POLICIES)
    )
    assert missing == [], f"Rutas con usuario y sin guardia de empleados: {missing}"


def test_routes_without_a_user_are_exactly_the_known_public_ones():
    public = {
        (method, path) for method, path, calls in _api_routes()
        if get_current_user not in calls and _require_internal_key not in calls
    }
    assert public - PUBLIC_ROUTES == set(), f"Rutas públicas nuevas: {public - PUBLIC_ROUTES}"


def test_no_unexpected_non_api_routes():
    others = {r.path for r in main.app.routes if not isinstance(r, APIRoute)}
    assert others <= NON_API_ROUTES, others - NON_API_ROUTES


def test_public_invite_stays_public():
    # La guardia a nivel router del resto de /shared-expenses pide token: si la
    # invitación volviera a ese router, quien todavía no tiene cuenta no la podría abrir.
    invite = [calls for method, path, calls in _api_routes()
              if (method, path) == ("GET", "/shared-expenses/invite/{token}")]
    assert invite and get_current_user not in invite[0]

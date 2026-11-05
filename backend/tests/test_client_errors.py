"""Lo que manda el navegador cuando una pantalla falla."""
from app.routers.client_errors import ClientErrorIn, build_log


def test_the_query_never_reaches_the_logs():
    body = ClientErrorIn(message="boom", path="/expenses?wat=secreto#x", host="beta.tood.com.ar")
    log = build_log(body, 7, 3)
    assert log.request_path == "/expenses"
    assert (log.level, log.logger_name, log.user_id, log.tenant_id) == ("ERROR", "frontend", 7, 3)
    assert log.extra == {"host": "beta.tood.com.ar"}


def test_without_a_path():
    assert build_log(ClientErrorIn(message="boom"), None, None).request_path is None

# Arma la página de mocks inyectando los trazos finales (logo y t) desde el proyecto.
import pathlib, re, json, sys
root = pathlib.Path(sys.argv[1])
ts = (root / "frontend/lib/brand/tood-marca.ts").read_text()
def const(name):
    m = re.search(rf"export const {name} = (.*?);\n", ts, re.S)
    v = m.group(1).strip()
    return json.loads(v) if v.startswith('"') else v
data = {
    "T_PATH": const("T_PATH"), "T_TRANSFORM": const("T_TRANSFORM"), "CREST_PATH": const("CREST_PATH"),
    "LOGO_VIEWBOX": const("LOGO_VIEWBOX"), "LOGO_CLIP": const("LOGO_CLIP"), "LOGO_PATHS": const("LOGO_PATHS"),
}
here = pathlib.Path(__file__).parent
tpl = (here / "mocks.tpl.html").read_text()
import base64
vid = here / "tero-mock.mp4"
src = "data:video/mp4;base64," + base64.b64encode(vid.read_bytes()).decode() if vid.exists() else ""
(here / "tero-mocks.html").write_text(tpl.replace("/*BRAND*/", "const BRAND = " + json.dumps(data) + ";").replace("/*VIDEO*/", src))
print("ok")

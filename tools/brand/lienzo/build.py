# Arma el lienzo de la marca tood: el logo, cada animación por separado y el avatar con sus selectores de ojos y
# boca. Toma los trazos de frontend/lib/brand/tood-marca.ts y el CSS de ToodAvatar.tsx, así muestra lo mismo que la app.
# Uso (desde la raíz del repo): python3 tools/brand/lienzo/build.py  → tools/brand/lienzo/tood-lienzo.html (no se commitea)
import json, pathlib, re

root = pathlib.Path(__file__).resolve().parents[3]
here = pathlib.Path(__file__).parent
tpl = (here / "lienzo.tpl.html").read_text()
ts = (root / "frontend/lib/brand/tood-marca.ts").read_text()
data = {}
for m in re.finditer(r"export const (\w+) = (.*?)(?: as const)?;\n", ts):
    k, v = m.group(1), m.group(2)
    if v.startswith("{") and '"' not in v:
        v = re.sub(r"(\w+):", r'"\1":', v)
    data[k] = json.loads(v)
av = (root / "frontend/components/brand/ToodAvatar.tsx").read_text()
css = av[av.index("const CSS = `") + 13:av.rindex("`;")]
out = here / "tood-lienzo.html"
out.write_text(tpl.replace("/*DATA*/", json.dumps(data)).replace("/*AVCSS*/", json.dumps(css)))
print(out)

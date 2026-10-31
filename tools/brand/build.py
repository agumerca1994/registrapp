# Genera las piezas finales de la marca "tood" (logo, ícono y datos del avatar) con las letras pasadas a trazos.
# Uso: python tools/brand/build.py <Fredoka[wdth,wght].ttf> <carpeta de salida>  (necesita fonttools)
# La fuente es Fredoka (OFL), de github.com/google/fonts/tree/main/ofl/fredoka. Después copiar las salidas a
# frontend/public/brand/tood/ (SVG) y frontend/lib/brand/tood-marca.ts.
import json, sys, pathlib
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

FONT, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

VIOLETA = "#5B4FE9"

font = instantiateVariableFont(TTFont(FONT), {"wght": 600, "wdth": 100})
gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
hmtx = font["hmtx"]

def glyph(ch):
    name = cmap[ord(ch)]
    pen = SVGPathPen(gs); gs[name].draw(pen)
    b = BoundsPen(gs); gs[name].draw(b)
    return {"d": pen.getCommands(), "adv": hmtx[name][0], "bounds": b.bounds}

# Medidas de la t tomadas a 200 px en el navegador (ver página de exploración).
PX = upm / 200            # unidades de fuente por píxel a 200 px
t = glyph("t")
xmin, ymin, xmax, ymax = t["bounds"]
stem_l, stem_r = xmin + 17.4 * PX, xmin + 47.4 * PX
stem_cx, stem_top = (stem_l + stem_r) / 2, 131.5 * PX      # alto del palito sobre la línea de base
E, DROP = 15 * PX, 12 * PX

def feather(l, r, tip, cur=.6):
    (lx, ly), (rx, ry), (tx, ty) = l, r, tip
    c1 = (lx, ly + (ty - ly) * cur); c2 = (tx + (lx - tx) * cur * .6, ty + (ly - ty) * .12)
    c3 = (tx + (rx - tx) * cur * .55, ty - 6); c4 = (rx, ry + (ty - ry) * cur)
    f = lambda p: f"{p[0]:.2f} {p[1]:.2f}"
    return f"M{f(l)} C{f(c1)} {f(c2)} {f(tip)} C{f(c3)} {f(c4)} {f(r)} Z"

# Copete en coordenadas "de pantalla" de la t a 200 px (origen = centro de la punta del palito, y hacia abajo).
crest_local = (f"M-15 24 L-15 0 L15 0 L15 24 Z "
               + feather((-15, 6), (6, 0), (-54, -30)) + " " + feather((-4, 2), (15, 6), (-38, -46)))

def crest_transform():
    # De píxeles de pantalla (y hacia abajo) a unidades de fuente (y hacia arriba), ya bajado DROP.
    return f"matrix({PX:.4f} 0 0 {-PX:.4f} {stem_cx:.2f} {stem_top - DROP:.2f})"

cut_y = stem_top - DROP          # todo lo del palito por encima de esto se recorta
def t_clip(cid):
    big = f"M{xmin - 50:.0f} {ymin - 50:.0f} H{xmax + 50:.0f} V{ymax + 400:.0f} H{xmin - 50:.0f} Z"
    hole = f"M{stem_l - 6:.1f} {cut_y:.1f} H{stem_r + 6:.1f} V{ymax + 10:.1f} H{stem_l - 6:.1f} Z"
    return f'<clipPath id="{cid}"><path clip-rule="evenodd" d="{big} {hole}"/></clipPath>'

def t_with_crest(cid, x_off=0):
    return (f'<g transform="translate({x_off:.2f} 0)"><g clip-path="url(#{cid})"><path d="{t["d"]}"/></g>'
            f'<path transform="{crest_transform()}" d="{crest_local}"/></g>')

# Del sistema del avatar (la t a 200 px, centrada en x=100, base en y=168) a unidades de fuente.
AV_X0 = 62.1
def from_avatar(ax, ay):
    return ((ax - AV_X0) * PX + xmin, (168 - ay) * PX)

# ---------- Logo "tood" ----------
letters = "tood"
x, parts, defs, layout = 0, [], [t_clip("tcut")], []
for ch in letters:
    g = glyph(ch)
    parts.append(t_with_crest("tcut", x) if ch == "t" else f'<path transform="translate({x:.2f} 0)" d="{g["d"]}"/>')
    bx0, by0, bx1, by1 = g["bounds"]
    layout.append({"ch": ch, "x": round(x, 2), "adv": g["adv"], "d": g["d"], "cx": round(x + (bx0 + bx1) / 2, 2), "cy": round((by0 + by1) / 2, 2)})
    x += g["adv"]
crest_top = stem_top - DROP + 46 * PX + 4 * PX
pad = 40
vb_x, vb_w = -60 * PX + xmin - pad, x - (-60 * PX + xmin) + 2 * pad
vb_top, vb_bot = crest_top + pad, -pad - 10
def logo(fill):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb_x:.0f} {-vb_top:.0f} {vb_w:.0f} {vb_top - vb_bot:.0f}">'
            f'<defs>{defs[0]}</defs><g fill="{fill}" transform="scale(1 -1)">{"".join(parts)}</g></svg>')
(OUT / "tood-logo.svg").write_text(logo("currentColor"))
(OUT / "tood-logo-violeta.svg").write_text(logo(VIOLETA))
(OUT / "tood-logo-blanco.svg").write_text(logo("#ffffff"))

# ---------- Ícono: la t sola, blanca sobre el violeta, centrada en un cuadrado ----------
def icon(bg, fg, size=1024, radius=True):
    w = xmax - (-58 * PX + stem_cx - 0)        # ancho total con el copete
    left = stem_cx - 58 * PX
    top, bottom = crest_top, ymin
    box = max(w, top - bottom) * 1.62
    cx, cy = (left + xmax) / 2, (top + bottom) / 2
    rx = f' rx="{box * .2237:.0f}"' if radius else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{cx - box / 2:.0f} {-cy - box / 2:.0f} {box:.0f} {box:.0f}">'
            f'<rect x="{cx - box / 2:.0f}" y="{-cy - box / 2:.0f}" width="{box:.0f}" height="{box:.0f}"{rx} fill="{bg}"/>'
            f'<defs>{t_clip("tcut")}</defs><g fill="{fg}" transform="scale(1 -1)">{t_with_crest("tcut")}</g></svg>')
(OUT / "tood-icono.svg").write_text(icon(VIOLETA, "#ffffff"))
(OUT / "tood-icono-cuadrado.svg").write_text(icon(VIOLETA, "#ffffff", radius=False))  # para el manifest (el sistema redondea)

# ---------- Módulo TS para los componentes de React ----------
# El avatar trabaja en el sistema de la página de exploración: la t a 200 px, centrada en x=100, base en y=168.
glyph_tf = f"translate({AV_X0 - xmin / PX:.3f} 168) scale({1 / PX:.5f} {-1 / PX:.5f})"
logo_inner = "".join(parts)
# Ojos y boca del avatar llevados al logo (unidades de fuente, y hacia arriba), para la animación de las oo.
eyes = [dict(zip(("x", "y"), map(lambda v: round(v, 1), from_avatar(ax, 86)))) for ax in (83, 105)]
eye_r = {"rx": round(4.4 * PX, 1), "ry": round(6.6 * PX, 1)}
mouth = dict(zip(("x", "y"), map(lambda v: round(v, 1), from_avatar(94, 106))))
ts = f'''// Generado por tools/brand/build.py a partir de Fredoka 600 (OFL). No editar a mano: regenerar.
// Coordenadas del avatar: la t a 200 px, centrada en x=100 y con la base en y=168 (las mismas de la exploración).

/** Trazo de la t, en unidades de la fuente (UPM {upm}, y hacia arriba). */
export const T_PATH = {json.dumps(t["d"])};
/** Lleva T_PATH al sistema del avatar. */
export const T_TRANSFORM = "{glyph_tf}";
/** Copete en el sistema del avatar, con origen en el centro de la punta del palito. */
export const CREST_PATH = {json.dumps(crest_local)};
/** Dónde va el origen del copete en el avatar (el palito por encima de CUT_Y se recorta). */
export const CREST_ORIGIN = {{ x: 94.5, y: 48.5 }};
export const CUT_Y = 48.5;

/** Logo "tood" completo: viewBox y contenido (los trazos ya traen el recorte; pintar con fill). */
export const LOGO_VIEWBOX = "{vb_x:.0f} {-vb_top:.0f} {vb_w:.0f} {vb_top - vb_bot:.0f}";
export const LOGO_CLIP = {json.dumps(t_clip("TOOD_CLIP"))};
export const LOGO_PATHS = {json.dumps(logo_inner.replace("tcut", "TOOD_CLIP"))};

/** Lo mismo letra por letra, para animar el logo: la t con su copete y cada o y la d con su x y su centro. */
export const LOGO_T = {json.dumps(t_with_crest("TOOD_CLIP"))};
export const LOGO_LETTERS = {json.dumps(layout[1:])} as const;
/** Ojos y boca de la cara de la t en el sistema del logo (unidades de fuente, y hacia arriba). */
export const LOGO_EYES = {json.dumps(eyes)} as const;
export const LOGO_EYE_R = {json.dumps(eye_r)} as const;
export const LOGO_MOUTH = {json.dumps(mouth)} as const;
export const LOGO_PX = {PX};
'''
(OUT / "tood-marca.ts").write_text(ts)
print("ok", upm, round(stem_l), round(stem_r), round(stem_top), OUT)

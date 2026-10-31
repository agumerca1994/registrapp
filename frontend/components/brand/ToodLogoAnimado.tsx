"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LOGO_CLIP, LOGO_EYES, LOGO_LETTERS, LOGO_O_COUNTER, LOGO_PX, LOGO_T, LOGO_VIEWBOX, T_PATH } from "@/lib/brand/tood-marca";
import { EYES, EYE_RX, EYE_RY } from "@/lib/brand/tood-cara";

// El logo que se mueve. Dos usos, elegidos en el lienzo de la marca (tools/brand/lienzo/):
//   variant="todo"  la portada: "od" pasa a "do" y queda "todo" (todo en una sola app), y vuelve. Rota entre
//                   tres maneras (arco, pivote, voltereta): una por vez, con pausa, y cada carga arranca en la
//                   siguiente.
//   variant="ojos"  el header: al bajar, las oo vuelan a la cara de la t y su hueco se vuelve el ojo; la d se
//                   desvanece y la t queda como el avatar despierto, sin boca, siguiendo al puntero. Se queda así
//                   mientras la página está bajada; al volver arriba de todo hace el camino inverso y es "tood".
// Va por requestAnimationFrame sobre el atributo transform: el logo está dentro de un scale(1 -1) y el origen de
// una transformación CSS ahí no es confiable. Todo en unidades de la fuente, con y hacia arriba. Los ojos y los
// huecos se pintan del color del fondo (`hole`). Con movimiento reducido queda quieto en "tood".

const [O1, O2, D] = LOGO_LETTERS;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const seg = (t: number, a: number, b: number) => ease(clamp((t - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const pulse = (t: number, a: number, len: number) => (t > a && t < a + len ? Math.sin(((t - a) / len) * Math.PI) : 0);

// Del sistema del avatar al del logo, tomando como referencia el ojo izquierdo de la t (LOGO_EYES[0] = x 83, y 86).
const toLogo = (ax: number, ay: number) => [LOGO_EYES[0].x + (ax - 83) * LOGO_PX, LOGO_EYES[0].y - (ay - 86) * LOGO_PX];

type Letter = { x: number; cx: number; cy: number };
type Frame = { tx: number; ty: number; s?: number; sx?: number; sy?: number; r?: number };
type Pose = {
  o1?: Frame; o2?: Frame; d?: Frame;
  ink?: number; hole?: number; holeK?: number; dop?: number;
  face?: { op: number; look: number; lookY: number; blink: number };
  cap?: boolean;
};

// Cada letra se mueve por su centro (tx, ty) y se escala o gira alrededor de él. Los trazos son locales a la
// letra, así que el centro que se resta es el suyo (cx − x).
const at = (l: Letter, f: Frame) => {
  const s = f.s ?? 1;
  return `translate(${f.tx.toFixed(1)} ${f.ty.toFixed(1)}) rotate(${(f.r ?? 0).toFixed(1)}) ` +
    `scale(${(s * (f.sx ?? 1)).toFixed(4)} ${(s * (f.sy ?? 1)).toFixed(4)}) translate(${(l.x - l.cx).toFixed(1)} ${-l.cy})`;
};

/* ---------- "todo": tres maneras de pasar de "od" a "do" ---------- */

const arco = (t: number): Pose => {
  const k = seg(t, 500, 1200) - seg(t, 2900, 3600), arc = Math.sin(Math.PI * k) * 260;
  return { cap: t > 900 && t < 3200,
    o2: { tx: O2.cx + D.adv * k, ty: O2.cy - arc }, d: { tx: D.cx - O2.adv * k, ty: D.cy + arc } };
};

// La d salta por encima de la o dando una vuelta en el aire y se aplasta al caer.
const voltereta = (t: number): Pose => {
  const k = seg(t, 500, 1250) - seg(t, 2900, 3650), hop = Math.sin(Math.PI * k) * 560;
  const going = t < 2000, land = pulse(t, 1250, 220) + pulse(t, 3650, 220);
  return { cap: t > 900 && t < 3200,
    o2: { tx: O2.cx + D.adv * k, ty: O2.cy, sy: 1 - pulse(t, 650, 300) * 0.12 },
    d: { tx: D.cx - O2.adv * k, ty: D.cy + hop - land * 20, sy: 1 - land * 0.14,
      r: (going ? 1 : -1) * 360 * (going ? seg(t, 500, 1250) : seg(t, 2900, 3650)) } };
};

// "od" pintada en un cartel que gira sobre un eje vertical en el medio; atrás dice "do". Seis vueltas y media que
// arrancan rápido y frenan, y la vuelta igual en sentido contrario.
const spinOut = (t: number, a: number, len: number) => 1 - Math.pow(1 - clamp((t - a) / len), 4);
const pivote = (t: number): Pose => ({ ...pivotAt(2340 * spinOut(t, 0, 3400) - 2340 * spinOut(t, 5800, 3400)), cap: t > 2600 && t < 5800 });
// Sólo la ida: gira, frena y se queda en "todo" (la usa variant="queda-todo").
const pivoteIda = (t: number): Pose => pivotAt(2340 * spinOut(t, 0, 3400));
function pivotAt(deg: number): Pose {
  const c = Math.cos((deg * Math.PI) / 180), k = Math.abs(c), back = c < 0;
  const axis = (O2.x + O2.x + O2.adv + D.adv) / 2;
  const oCx = back ? O2.x + D.adv + (O2.cx - O2.x) : O2.cx;
  const dCx = back ? O2.x + (D.cx - D.x) : D.cx;
  const sx = Math.max(k, 0.02);
  return { o2: { tx: axis + (oCx - axis) * k, ty: O2.cy, sx }, d: { tx: axis + (dCx - axis) * k, ty: D.cy, sx } };
}

const TODO = [
  { frame: arco, dur: 4000 },
  { frame: pivote, dur: 9800 },
  { frame: voltereta, dur: 4100 },
];
/** Pausa en "tood" entre una animación y la siguiente. */
const TODO_GAP = 6000;

/* ---------- "ojos": la t se vuelve el avatar que te sigue ---------- */

// La entrada dura OJOS_IN; la salida es la misma entrada recorrida hacia atrás. `t` va de 0 ("tood") a OJOS_IN
// (la t es el avatar), y avanza o retrocede según el scroll.
const OJOS_IN = 2500;
/** Cuánto hay que bajar para que la t se vuelva el avatar. */
const SCROLL_FROM = 24;

const ojos = (t: number, look: { x: number; y: number }, blink: number): Pose => {
  const fly = seg(t, 400, 1500);
  const gone = seg(t, 300, 1100);
  const rise = Math.sin(Math.PI * fly) * 200;
  // La o se achica hasta que su hueco mide lo que un ojo; el hueco pasa de círculo a óvalo.
  const s = lerp(1, (EYE_RY * LOGO_PX) / LOGO_O_COUNTER, fly);
  const mk = (l: Letter, i: number): Frame => {
    const [ex, ey] = toLogo(EYES[i][0], EYES[i][1]);
    return { tx: lerp(l.cx, ex, fly), ty: lerp(l.cy, ey, fly) + rise, s };
  };
  const landed = fly > 0.999;
  const w = seg(t, 2000, 2500);
  return {
    // El anillo se apaga antes de tocar la t (si no, asoma por el borde del travesaño); el hueco sigue y es el ojo.
    ink: 1 - clamp((fly - 0.55) / 0.3), hole: landed ? 0 : 1, holeK: fly, dop: 1 - gone,
    o1: mk(O1, 0), o2: mk(O2, 1), d: { tx: D.cx, ty: D.cy, s: 1 - 0.6 * gone },
    face: { op: landed ? 1 : 0, blink: 1 - 0.88 * blink, look: 16 * w * look.x, lookY: 12 * w * look.y },
  };
};

/* ---------- El componente ---------- */

const ROTATION_KEY = "tood:logo-anim";

// Se decide una vez por carga (en desarrollo React corre los efectos dos veces y avanzaría dos lugares).
let loadStart: number | null = null;
function nextStart() {
  if (loadStart !== null) return loadStart;
  try {
    loadStart = (Number(localStorage.getItem(ROTATION_KEY)) || 0) % TODO.length;
    localStorage.setItem(ROTATION_KEY, String((loadStart + 1) % TODO.length));
  } catch {
    loadStart = 0;
  }
  return loadStart;
}

export function ToodLogoAnimado({
  className, variant = "todo", hole = "hsl(var(--background))", title = "tood", onCaption,
}: {
  className?: string;
  variant?: "todo" | "ojos" | "queda-todo";
  /** Color de los ojos y los huecos: el del fondo donde está apoyado el logo. */
  hole?: string;
  title?: string;
  /** Avisa cuándo mostrar la frase ("todo en una sola app."). */
  onCaption?: (show: boolean) => void;
}) {
  const clip = `tood-anim-${useId().replace(/:/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [pose, setPose] = useState<Pose>({});

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // "queda-todo": cuando aparece en pantalla gira una vez y se queda en "todo". Sin movimiento, ya dice "todo".
    if (variant === "queda-todo") {
      if (reduce) { setPose(pivoteIda(1e9)); return; }
      let raf = 0, started = 0;
      const tick = (now: number) => {
        const t = now - started;
        setPose(pivoteIda(t));
        if (t < 3500) raf = requestAnimationFrame(tick);
      };
      const io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !started) { started = performance.now(); raf = requestAnimationFrame(tick); io.disconnect(); }
      }, { threshold: 1 });
      if (svgRef.current) io.observe(svgRef.current);
      return () => { io.disconnect(); cancelAnimationFrame(raf); };
    }
    if (reduce) return;
    let raf = 0;
    const t0 = performance.now();
    const pointer = { x: 0, y: 0, moved: -1e9 };
    const look = { x: 0, y: 0 };
    let last = t0, ojosT = 0;
    const onMove = (e: PointerEvent) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = performance.now(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    // Cuánto ocupa cada animación de la rotación, con su pausa.
    const start = variant === "todo" ? nextStart() : 0;
    const slots = TODO.map((a) => a.dur + TODO_GAP), total = slots.reduce((a, b) => a + b, 0);
    // El punto de la pantalla desde donde mira: entre los ojos de la t.
    const [vbx, , vbw] = LOGO_VIEWBOX.split(" ").map(Number);
    const anchorX = (toLogo((EYES[0][0] + EYES[1][0]) / 2, 0)[0] - vbx) / vbw;

    const tick = (now: number) => {
      const el = now - t0;
      if (variant === "todo") {
        let t = el % total, i = start;
        for (let n = 0; n < TODO.length; n++) {
          const slot = slots[(start + n) % TODO.length];
          if (t < slot) { i = (start + n) % TODO.length; break; }
          t -= slot;
        }
        setPose(t < TODO[i].dur ? TODO[i].frame(t) : {});
      } else {
        const r = svgRef.current?.getBoundingClientRect();
        let tx = 0, ty = 0;
        if (r && now - pointer.moved < 2500) {
          tx = (pointer.x - (r.left + r.width * anchorX)) / (window.innerWidth * 0.35);
          ty = -(pointer.y - (r.top + r.height * 0.6)) / (window.innerHeight * 0.35);
        } else {
          // Sin puntero (un celular), mira alrededor despacio.
          tx = Math.sin(now / 1300) * 0.8; ty = Math.sin(now / 1900) * 0.4;
        }
        const m = Math.hypot(tx, ty);
        if (m > 1) { tx /= m; ty /= m; }
        look.x += (tx - look.x) * 0.15; look.y += (ty - look.y) * 0.15;
        // Bajando, la t se vuelve el avatar y se queda así; arriba de todo vuelve a ser "tood".
        const dt = Math.min(now - last, 100);
        ojosT = clamp((ojosT + (window.scrollY > SCROLL_FROM ? dt : -dt)) / OJOS_IN) * OJOS_IN;
        // Ya convertida, parpadea cada 2,7 s.
        const blink = ojosT >= OJOS_IN ? pulse(el % 2700, 2400, 200) : 0;
        setPose(ojosT > 0 ? ojos(ojosT, look, blink) : {});
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, [variant]);

  const cap = !!pose.cap;
  useEffect(() => { onCaption?.(cap); }, [cap, onCaption]);

  const rest = (l: Letter): Frame => ({ tx: l.cx, ty: l.cy });
  const f1 = pose.o1 ?? rest(O1), f2 = pose.o2 ?? rest(O2), fd = pose.d ?? rest(D);
  const fc = pose.face;
  const k = pose.holeK ?? 0;
  return (
    <svg ref={svgRef} viewBox={LOGO_VIEWBOX} className={className} role="img" aria-label={title} fill="currentColor">
      <defs dangerouslySetInnerHTML={{ __html: LOGO_CLIP.replace("TOOD_CLIP", clip) }} />
      {/* El hueco sólo tiene que verse sobre la t: fuera de ella, sobre un fondo translúcido, se notaría. */}
      <clipPath id={`${clip}-t`}><path d={T_PATH} /></clipPath>
      <g transform="scale(1 -1)">
        <g dangerouslySetInnerHTML={{ __html: LOGO_T.replaceAll("TOOD_CLIP", clip) }} />
        <path transform={at(D, fd)} d={D.d} opacity={pose.dop ?? 1} />
        <g opacity={pose.ink ?? 1}>
          <path transform={at(O1, f1)} d={O1.d} />
          <path transform={at(O2, f2)} d={O2.d} />
        </g>
        {/* El hueco de cada o mientras vuela: sobre el fondo no se ve; sobre la t es el ojo que llega. */}
        {pose.hole ? (
          <g clipPath={`url(#${clip}-t)`}>
            {[f1, f2].map((f, i) => (
              <ellipse key={i} cx={f.tx} cy={f.ty} fill={hole}
                rx={lerp(LOGO_O_COUNTER, EYE_RX * LOGO_PX, k)} ry={lerp(LOGO_O_COUNTER, EYE_RY * LOGO_PX, k)} />
            ))}
          </g>
        ) : null}
        {fc && fc.op > 0 && (
          <g fill={hole}>
            {EYES.map(([ax, ay]) => {
              const [x, y] = toLogo(ax, ay);
              return <ellipse key={ax} cx={x + fc.look} cy={y + fc.lookY} rx={EYE_RX * LOGO_PX} ry={EYE_RY * LOGO_PX * fc.blink} />;
            })}
          </g>
        )}
      </g>
    </svg>
  );
}

/** El logo de la portada con su frase debajo, que aparece cuando queda "todo". La frase se centra con lo que se
 *  ve del logo: su caja deja lugar a la izquierda para el copete, así que el logo se corre 3 % para compensar. */
export function ToodConLema({ className, logoClassName = "h-24 md:h-32 w-auto text-primary" }: { className?: string; logoClassName?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`inline-flex flex-col items-center ${className ?? ""}`}>
      <ToodLogoAnimado className={logoClassName} onCaption={setShow} />
      <p className="mt-3 font-display font-semibold text-xl md:text-2xl text-primary transition-opacity duration-500"
        style={{ opacity: show ? 1 : 0, transform: "translateX(3%)" }} aria-hidden="true">
        todo en una sola app
      </p>
    </div>
  );
}

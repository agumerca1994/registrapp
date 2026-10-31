"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CREST_ORIGIN, CREST_PATH, CUT_Y, T_PATH, T_TRANSFORM } from "@/lib/brand/tood-marca";

// La t del logo como avatar. En reposo es sólo la letra con su copete; durante una reacción le
// aparecen ojitos huecos (del color del fondo, como recortados) y una boquita, también hueca. Va en el violeta de
// la marca; al cargar un gasto la letra se llena de verde de abajo hacia arriba, y en una alerta, de rojo.
// Todo se dibuja en el sistema de la exploración: la t a 200 px, centrada en x=100, base en y=168.

export type ToodReaction = "gasto" | "alerta" | "meta" | "pasado" | "duda" | "toque";

const DURATION: Record<ToodReaction, number> = { gasto: 1900, alerta: 1900, meta: 2600, pasado: 1900, duda: 1900, toque: 700 };
const EYES: [number, number][] = [[83, 86], [105, 86]];
// Dónde aparecen los tildes, los signos de exclamación y los de pregunta, como las estrellitas de la meta.
const SPOTS: [number, number][] = [[42, 50], [160, 66], [36, 138], [166, 132]];

type Props = {
  /** Reacción a mostrar. Cambiar `reactionKey` la vuelve a disparar aunque sea la misma. */
  reaction?: ToodReaction | null;
  reactionKey?: number | string;
  /** Milisegundos que dura; 0 la deja fija (útil para un mock estático). */
  duration?: number;
  size?: number | string;
  ink?: string;
  /** Fondo del cuadrado. `null` lo deja transparente; entonces los ojos huecos usan `holeColor`. */
  background?: string | null;
  /** Color de los ojos huecos cuando no hay fondo: el de la superficie donde está apoyado. */
  holeColor?: string;
  /** Colores a los que pasa la letra al cargar un gasto y en una alerta. */
  okColor?: string;
  alertColor?: string;
  /** Sigue al puntero con la mirada y se inclina. */
  track?: boolean;
  /** Reacciona al tocarlo. */
  pokeable?: boolean;
  className?: string;
  title?: string;
  onReactionEnd?: (r: ToodReaction) => void;
};

export function ToodAvatar({
  reaction = null, reactionKey, duration, size = 160, ink = "#5b4fe9", background = null,
  holeColor = "#ffffff", okColor = "#22b55a", alertColor = "#e5383b",
  track = false, pokeable = false, className, title = "tood", onReactionEnd,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const [active, setActive] = useState<ToodReaction | null>(null);
  const leanRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const fillRef = useRef<SVGRectElement>(null);
  const level = useRef(0);
  const [fillColor, setFillColor] = useState(okColor);
  const hole = background ?? holeColor;

  // Para repetir una reacción se saca la clase y se vuelve a poner dos cuadros después: así las animaciones
  // arrancan de nuevo sin desmontar el SVG (desmontarlo cortaría el llenado de color).
  const play = (r: ToodReaction | null, ms?: number) => {
    window.clearTimeout(timer.current);
    setActive(null);
    if (!r) return;
    requestAnimationFrame(() => requestAnimationFrame(() => setActive(r)));
    const t = ms ?? duration ?? DURATION[r];
    if (t === 0) return;
    timer.current = window.setTimeout(() => { setActive(null); onReactionEnd?.(r); }, t + 32);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { play(reaction); return () => window.clearTimeout(timer.current); }, [reaction, reactionKey]);

  // Llenado de color: una copia de la letra en verde o rojo, recortada por un rectángulo que sube desde abajo.
  // Letra y copete son la misma capa, así cambian juntos y sin mezclar colores.
  useEffect(() => {
    const filling = active === "gasto" || active === "alerta";
    if (filling) setFillColor(active === "gasto" ? okColor : alertColor);
    const rect = fillRef.current;
    if (!rect) return;
    const to = filling ? 1 : 0, from = level.current;
    if (to === from) return;
    const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : filling ? 750 : 650;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      level.current = from + (to - from) * e;
      const top = 182 - level.current * 205;
      rect.setAttribute("y", String(top));
      rect.setAttribute("height", String(Math.max(0, 184 - top)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, okColor, alertColor]);

  // Seguimiento del puntero: la cara se mueve un poco más que la letra, y eso da profundidad.
  useEffect(() => {
    if (!track || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = leanRef.current?.ownerSVGElement?.getBoundingClientRect();
      if (!r) return;
      target.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.45)));
      target.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.35)) / (window.innerHeight * 0.45)));
    };
    const tick = () => {
      cur.x += (target.x - cur.x) * 0.1;
      cur.y += (target.y - cur.y) * 0.1;
      leanRef.current?.setAttribute("transform", `rotate(${cur.x * 5} 100 168)`);
      faceRef.current?.setAttribute("transform", `translate(${cur.x * 1.6} ${cur.y * 1.2})`);
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, [track]);

  const eye = ([x, y]: [number, number]) => <ellipse key={x} cx={x} cy={y} rx={4.4} ry={6.6} fill={hole} />;
  const arc = ([x, y]: [number, number], up: boolean) => (
    <path key={x} d={up ? `M${x - 5.5} ${y + 2.5} Q${x} ${y - 5.5} ${x + 5.5} ${y + 2.5}` : `M${x - 5.5} ${y} Q${x} ${y + 5} ${x + 5.5} ${y}`}
      fill="none" stroke={hole} strokeWidth={3.8} strokeLinecap="round" />
  );
  // La t y el copete; se dibujan dos veces (violeta debajo, color de la reacción encima).
  const letter = (fill: string) => (
    <>
      <g clipPath={`url(#${uid}-cut)`}><path transform={T_TRANSFORM} d={T_PATH} fill={fill} /></g>
      <g className="tav-crest" style={{ transformOrigin: `${CREST_ORIGIN.x}px ${CREST_ORIGIN.y + 24}px` }}>
        <path transform={`translate(${CREST_ORIGIN.x} ${CREST_ORIGIN.y})`} d={CREST_PATH} fill={fill} />
      </g>
    </>
  );
  const check = ([x, y]: [number, number]) => (
    <g key={x}><path d={`M${x - 7} ${y} L${x - 2} ${y + 5} L${x + 7} ${y - 6}`} fill="none" stroke={okColor} strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" /></g>
  );
  const bang = ([x, y]: [number, number]) => (
    <g key={x}><rect x={x - 2.4} y={y - 10} width={4.8} height={12} rx={2.4} fill={alertColor} /><circle cx={x} cy={y + 7} r={2.7} fill={alertColor} /></g>
  );
  const star = (x: number, y: number) => (
    <path key={`${x}${y}`} d={`M${x} ${y - 9} L${x + 3} ${y - 3} L${x + 9} ${y} L${x + 3} ${y + 3} L${x} ${y + 9} L${x - 3} ${y + 3} L${x - 9} ${y} L${x - 3} ${y - 3} Z`} fill={ink} />
  );

  return (
    <svg
      viewBox={background ? "-24 -36 248 248" : "20 -6 160 200"}
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={["tav", active ? `tav--${active}` : "", pokeable ? "tav--pokeable" : "", className ?? ""].join(" ")}
      onClick={pokeable ? () => play("toque") : undefined}
    >
      <style>{CSS}</style>
      <defs>
        {/* El palito de la t por encima del copete se recorta de verdad: funciona sobre cualquier fondo. */}
        <clipPath id={`${uid}-cut`}>
          <path clipRule="evenodd" d={`M-60 -80 H280 V280 H-60 Z M77 -80 H112 V${CUT_Y} H77 Z`} />
        </clipPath>
        <clipPath id={`${uid}-fill`}><rect ref={fillRef} x={-30} y={190} width={260} height={0} /></clipPath>
      </defs>
      {background && <rect x={-24} y={-36} width={248} height={248} rx={54} fill={background} />}
      <g ref={leanRef}>
        <g className="tav-anim">
          {letter(ink)}
          <g clipPath={`url(#${uid}-fill)`}>{letter(fillColor)}</g>
          <g className="tav-face"><g ref={faceRef}>
            <g className="tav-eyes">{EYES.map(eye)}</g>
            <g className="tav-happy">{EYES.map((p) => arc(p, true))}</g>
            <g className="tav-squint">{EYES.map(([x, y]) => <ellipse key={x} cx={x} cy={y + 1.5} rx={4.6} ry={2.4} fill={hole} />)}</g>
            <g className="tav-doubt"><ellipse cx={83} cy={86} rx={4.4} ry={6.6} fill={hole} /><path d="M100 86 H110" stroke={hole} strokeWidth={3.8} strokeLinecap="round" /></g>
            {/* La boca: sonrisa, sorpresa (abierta), tristeza o duda (una raya). */}
            <path className="tav-smile" d="M88 103 Q94 110 100 103" fill="none" stroke={hole} strokeWidth={3.6} strokeLinecap="round" />
            <ellipse className="tav-open" cx={94} cy={107} rx={4.2} ry={5.4} fill={hole} />
            <path className="tav-frown" d="M88.5 108 Q94 102.5 99.5 108" fill="none" stroke={hole} strokeWidth={3.6} strokeLinecap="round" />
            <path className="tav-flat" d="M89.5 106 H98.5" fill="none" stroke={hole} strokeWidth={3.6} strokeLinecap="round" />
          </g></g>
          <g className="tav-badge tav-pop tav-b-gasto">{SPOTS.map(check)}</g>
          <g className="tav-badge tav-pop tav-b-alerta">{SPOTS.map(bang)}</g>
          <g className="tav-badge tav-pop tav-b-duda">{SPOTS.map(([x, y]) => (
            <g key={x}><text x={x} y={y + 9} textAnchor="middle" fontFamily="Fredoka, Nunito Sans, sans-serif" fontWeight={600} fontSize={26} fill={ink}>?</text></g>
          ))}</g>
          <g className="tav-badge tav-b-pasado"><path d="M128 48 C133 56 134 61 131 64 C128 67 123 65 124 60 C125 56 126 53 128 48 Z" fill={ink} opacity={0.55} /></g>
          <g className="tav-badge tav-b-meta">{star(40, 52)}{star(160, 76)}{star(44, 150)}</g>
        </g>
      </g>
    </svg>
  );
}

const CSS = `
.tav--pokeable { cursor: pointer; }
.tav .tav-pop > g { opacity: 0; animation: tav-spark 1.1s ease-out infinite; transform-box: fill-box; transform-origin: center; }
.tav .tav-pop > g:nth-child(2) { animation-delay: .28s } .tav .tav-pop > g:nth-child(3) { animation-delay: .56s } .tav .tav-pop > g:nth-child(4) { animation-delay: .84s }
.tav .tav-anim { transform-box: view-box; transform-origin: 100px 172px; animation: tav-breathe 3.4s ease-in-out infinite; }
.tav .tav-crest { transform-box: view-box; }
.tav .tav-face { transform-box: view-box; transform-origin: 94px 96px; transform: scale(.2); opacity: 0; transition: transform .3s cubic-bezier(.3,1.7,.5,1), opacity .18s; }
.tav--gasto .tav-face, .tav--alerta .tav-face, .tav--meta .tav-face, .tav--pasado .tav-face, .tav--duda .tav-face, .tav--toque .tav-face { transform: scale(1); opacity: 1; }
.tav .tav-happy, .tav .tav-squint, .tav .tav-doubt, .tav .tav-open, .tav .tav-frown, .tav .tav-flat, .tav .tav-badge { display: none; }
.tav--gasto .tav-happy, .tav--meta .tav-happy, .tav--toque .tav-happy { display: inline; }
.tav--gasto .tav-eyes, .tav--meta .tav-eyes, .tav--toque .tav-eyes, .tav--pasado .tav-eyes, .tav--duda .tav-eyes { display: none; }
.tav--pasado .tav-squint, .tav--duda .tav-doubt { display: inline; }
.tav--alerta .tav-open, .tav--meta .tav-open, .tav--pasado .tav-frown, .tav--duda .tav-flat { display: inline; }
.tav--alerta .tav-smile, .tav--meta .tav-smile, .tav--pasado .tav-smile, .tav--duda .tav-smile { display: none; }
.tav--gasto .tav-b-gasto, .tav--alerta .tav-b-alerta, .tav--meta .tav-b-meta, .tav--duda .tav-b-duda, .tav--pasado .tav-b-pasado { display: inline; }
.tav .tav-eyes { transform-box: fill-box; transform-origin: center; animation: tav-blink 4.6s infinite; }
.tav--gasto .tav-anim { animation: tav-hop .32s cubic-bezier(.3,.7,.4,1) 4 alternate; }
.tav--alerta .tav-anim { animation: tav-shake .26s ease-in-out 6; }
.tav--alerta .tav-crest { animation: tav-crest-up .5s ease-out forwards; }
.tav--meta .tav-anim { animation: tav-jump .36s cubic-bezier(.3,.7,.4,1) infinite alternate; }
.tav--pasado .tav-anim { animation: tav-droop .5s ease-out forwards; }
.tav--pasado .tav-crest { animation: tav-crest-down .5s ease-out forwards; }
.tav--duda .tav-anim { animation: tav-tilt .4s ease-out forwards; }
.tav--toque .tav-anim { animation: tav-squash .45s ease-out; }
.tav .tav-b-meta path { animation: tav-spark 1s ease-out infinite; transform-box: fill-box; transform-origin: center; }
.tav .tav-b-meta path:nth-child(2) { animation-delay: .3s } .tav .tav-b-meta path:nth-child(3) { animation-delay: .6s }
@keyframes tav-breathe { 0%,100% { transform: scale(1, 1) } 50% { transform: scale(1.012, .988) } }
@keyframes tav-blink { 0%,92%,100% { transform: scaleY(1) } 95% { transform: scaleY(.12) } }
@keyframes tav-hop { from { transform: translateY(0) scale(1, 1) } to { transform: translateY(-16px) scale(.97, 1.03) } }
@keyframes tav-shake { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-5deg) } 75% { transform: rotate(5deg) } }
@keyframes tav-crest-up { 0% { transform: scaleY(1) } 60% { transform: scaleY(1.24) } 100% { transform: scaleY(1.18) } }
@keyframes tav-crest-down { to { transform: scaleY(.8) } }
@keyframes tav-jump { from { transform: translateY(0) } to { transform: translateY(-24px) } }
@keyframes tav-droop { to { transform: translateY(8px) rotate(-4deg) scale(1.02, .96) } }
@keyframes tav-tilt { to { transform: rotate(10deg) } }
@keyframes tav-squash { 0% { transform: scale(1, 1) } 30% { transform: scale(1.08, .9) } 60% { transform: scale(.96, 1.05) } 100% { transform: scale(1, 1) } }
@keyframes tav-spark { 0% { opacity: 0; transform: scale(.2) } 30% { opacity: 1 } 100% { opacity: 0; transform: scale(1.3) } }
@media (prefers-reduced-motion: reduce) { .tav, .tav * { animation: none !important; transition: none !important; } }
`;

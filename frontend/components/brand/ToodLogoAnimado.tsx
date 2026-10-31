"use client";

import { useEffect, useId, useState } from "react";
import { LOGO_CLIP, LOGO_EYES, LOGO_EYE_R, LOGO_LETTERS, LOGO_MOUTH, LOGO_PX, LOGO_T, LOGO_VIEWBOX } from "@/lib/brand/tood-marca";

// El logo que se mueve. Repite dos escenas, cada una con su frase:
//   1. "od" se da vuelta y queda "todo" (todo en una sola app), y vuelve.
//   2. Las oo vuelan a la t y se vuelven sus ojos (para que no pierdas nada de vista), mira, parpadea y vuelven.
// La t no tiene cara en reposo: los ojos aparecen sólo cuando pasa algo, como en ToodAvatar.
// Los ojos son huecos: se pintan del color del fondo (`hole`). Todo en unidades de la fuente, con y hacia arriba.
// Con movimiento reducido queda quieto en "tood".

const CYCLE = 10000;
export const TAGLINES = ["todo en una sola app.", "para que no pierdas nada de vista."] as const;

const [O1, O2, D] = LOGO_LETTERS;
const EYE_SCALE = (LOGO_EYE_R.ry * 2) / ((O1.cy + 10) * 2);   // el alto de la o llevado al alto de un ojo

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const seg = (t: number, a: number, b: number) => ease(clamp((t - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// Cada letra se mueve por su centro (tx, ty) y se escala alrededor de él. Los trazos son locales a la letra,
// así que el centro que se resta es el suyo (cx − x); en reposo, tx = cx y queda en su lugar.
type Frame = { tx: number; ty: number; s: number };
const at = (l: { x: number; cx: number; cy: number }, f: Frame) =>
  `translate(${f.tx.toFixed(1)} ${f.ty.toFixed(1)}) scale(${f.s.toFixed(4)}) translate(${(l.x - l.cx).toFixed(1)} ${-l.cy})`;

function frame(t: number) {
  // Escena 1: la o del medio pasa por abajo y la d por arriba.
  const swap = seg(t, 700, 1400) - seg(t, 3300, 4000);
  const arc = Math.sin(Math.PI * swap) * 260;
  // Escena 2: las oo suben a la cara de la t.
  const fly = seg(t, 4800, 5800) - seg(t, 8200, 9100);
  const rise = Math.sin(Math.PI * fly) * 240;
  const s = lerp(1, EYE_SCALE, fly);
  const o1: Frame = { tx: lerp(O1.cx, LOGO_EYES[0].x, fly), ty: lerp(O1.cy, LOGO_EYES[0].y, fly) + rise, s };
  const o2: Frame = {
    tx: lerp(O2.cx + D.adv * swap, LOGO_EYES[1].x, fly),
    ty: lerp(O2.cy - arc, LOGO_EYES[1].y, fly) + rise, s,
  };
  const d: Frame = { tx: D.cx - O2.adv * swap, ty: D.cy + arc, s: 1 };
  // Al llegar, la o en tinta se apaga, una copia hueca la reemplaza y ésa pasa a ser el ojo.
  const ink = 1 - clamp((fly - 0.5) / 0.35);
  const ghost = clamp((fly - 0.5) / 0.35) * (1 - clamp((fly - 0.9) / 0.1));
  const eyes = clamp((fly - 0.9) / 0.1);
  const blink = t > 6500 && t < 6700 ? 1 - Math.sin(((t - 6500) / 200) * Math.PI) * 0.88 : 1;
  const look = (seg(t, 7000, 7300) - seg(t, 7800, 8100)) * 12;
  const tagline = t > 1100 && t < 3700 ? 0 : t > 5400 && t < 8500 ? 1 : -1;
  return { o1, o2, d, ink, ghost, eyes, blink, look, tagline };
}

export function ToodLogoAnimado({
  className, hole = "hsl(var(--background))", title = "tood", onTagline,
}: {
  className?: string;
  /** Color de los ojos huecos: el del fondo donde está apoyado el logo. */
  hole?: string;
  title?: string;
  /** Avisa qué frase va con lo que está pasando (índice de TAGLINES, o -1 entre escenas). */
  onTagline?: (i: number) => void;
}) {
  const clip = `tood-anim-${useId().replace(/:/g, "")}`;
  const [t, setT] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => { setT((now - t0) % CYCLE); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const f = frame(t);
  useEffect(() => { onTagline?.(f.tagline); }, [f.tagline, onTagline]);

  const eyeW = 3.8 * LOGO_PX;
  const { x: mx, y: my } = LOGO_MOUTH;
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} role="img" aria-label={title} fill="currentColor">
      <defs dangerouslySetInnerHTML={{ __html: LOGO_CLIP.replace("TOOD_CLIP", clip) }} />
      <g transform="scale(1 -1)">
        <g dangerouslySetInnerHTML={{ __html: LOGO_T.replaceAll("TOOD_CLIP", clip) }} />
        <path transform={at(D, f.d)} d={D.d} />
        <g opacity={f.ink}>
          <path transform={at(O1, f.o1)} d={O1.d} />
          <path transform={at(O2, f.o2)} d={O2.d} />
        </g>
        {f.ghost > 0 && (
          <g opacity={f.ghost} fill={hole}>
            <path transform={at(O1, f.o1)} d={O1.d} />
            <path transform={at(O2, f.o2)} d={O2.d} />
          </g>
        )}
        {f.eyes > 0 && (
          <g opacity={f.eyes} fill={hole}>
            {LOGO_EYES.map((e) => (
              <ellipse key={e.x} cx={e.x + f.look} cy={e.y} rx={LOGO_EYE_R.rx} ry={LOGO_EYE_R.ry * f.blink} />
            ))}
            <path d={`M${mx - 30} ${my + 8} Q${mx} ${my - 24} ${mx + 30} ${my + 8}`} fill="none" stroke={hole}
              strokeWidth={eyeW} strokeLinecap="round" />
          </g>
        )}
      </g>
    </svg>
  );
}

/** El logo animado con su frase debajo, que cambia con la escena y se apaga entre una y otra. */
export function ToodConLema({ className, logoClassName = "h-16 md:h-20 w-auto text-primary" }: { className?: string; logoClassName?: string }) {
  const [i, setI] = useState(-1);
  const [last, setLast] = useState(0);
  useEffect(() => { if (i >= 0) setLast(i); }, [i]);
  return (
    <div className={className}>
      <ToodLogoAnimado className={logoClassName} onTagline={setI} />
      <p className="mt-2 h-7 text-lg font-medium text-muted-foreground transition-opacity duration-500" style={{ opacity: i >= 0 ? 1 : 0 }}
        aria-hidden="true">
        {TAGLINES[last]}
      </p>
    </div>
  );
}

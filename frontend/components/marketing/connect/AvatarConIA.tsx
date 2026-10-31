"use client";

import { useEffect, useRef, useState } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { ToodAvatar, type ToodReaction } from "@/components/brand/ToodAvatar";

// La portada de /conectar: la t de tood y un orbe de puntos que hace de "una IA", sin la marca de ningún
// asistente (el orbe es thinking-orbs, MIT). Se repite cada 11 s:
//   la t sola → aparece el orbe conectándose (la t duda) → el orbe le habla (puntos que viajan hacia la t) →
//   la t contesta (puntos que salen de la t; el orbe escucha) → el orbe piensa → le devuelve la respuesta (la t
//   festeja) → el orbe se apaga.
// El orbe es monocromático (puntos oscuros) y va fijo en tema claro: con `auto`, a quien tiene el sistema en
// oscuro le pintaría puntos claros sobre el fondo claro de la página. Sólo viene en 64 px: se escala con CSS para
// que ocupe 2·ORB.r de la escena, sea cual sea su ancho.
// Se pausa fuera de pantalla; con movimiento reducido queda quieta, con el orbe a la vista.

const CYCLE = 11000;
const W = 440, H = 200;
// El avatar va en un cuadrado de 132 en (35, 34); su cara cae en (101, 95). El orbe, a la derecha.
const AVATAR = { x: 35, y: 34, size: 132 };
const FACE = { x: 101, y: 95 };
const ORB = { x: 330, y: 96, r: 52 };
const N_STREAM = 14;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const seg = (t: number, a: number, b: number) => ease(clamp((t - a) / (b - a)));

// Qué hace el orbe en cada tramo del ciclo.
const ORB_STATES: [number, OrbState][] = [
  [0, "connecting"], [2600, "composing"], [4300, "listening"], [6100, "solving"], [7700, "composing"], [9300, "breathing"],
];
// Y qué hace la t. La duda (1,9 s) no termina seco: como en el login, sale con el gesto contento y la boca en D.
const BEATS: [number, ToodReaction, ("arco" | "d")?][] = [[1500, "duda"], [3400, "toque", "d"], [4500, "toque"], [8000, "meta"]];
// Los viajes de puntos: el orbe le habla, la t contesta, el orbe responde.
const TRIPS: [number, boolean][] = [[2700, true], [4600, false], [7700, true]];

// Un punto del viaje entre el orbe y la cara de la t, en arco por arriba.
function streamPoint(p: number, fromOrb: boolean) {
  const a = fromOrb ? { x: ORB.x - ORB.r * 0.75, y: ORB.y } : { x: FACE.x + 14, y: FACE.y - 4 };
  const b = fromOrb ? { x: FACE.x + 16, y: FACE.y - 4 } : { x: ORB.x - ORB.r * 0.75, y: ORB.y };
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 70 };
  const q = 1 - p;
  return { x: q * q * a.x + 2 * q * p * c.x + p * p * b.x, y: q * q * a.y + 2 * q * p * c.y + p * p * b.y };
}

const stateAt = (list: readonly (readonly [number, ...unknown[]])[], t: number) => {
  let i = -1;
  list.forEach(([at], j) => { if (t >= at) i = j; });
  return i;
};

export default function AvatarConIA({ className }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const streamRefs = useRef<(SVGCircleElement | null)[]>([]);
  const [orbState, setOrbState] = useState<OrbState>("breathing");
  const [mood, setMood] = useState<{ reaction: ToodReaction | null; key: number; smile?: "arco" | "d" }>({ reaction: null, key: 0 });
  const [look, setLook] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const orb = orbRef.current;
    const showOrb = (k: number) => {
      if (!orb) return;
      orb.style.opacity = String(k);
      const fit = ((2 * ORB.r * (boxRef.current?.clientWidth ?? W)) / W) / 64;
      orb.style.transform = `translate(-50%, -50%) scale(${(fit * (0.6 + 0.4 * k)).toFixed(3)})`;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      showOrb(1); setLook({ x: 1, y: 0 });
      return;
    }

    let raf = 0, t0 = performance.now(), running = false, lastBeat = -1, lastOrb = -1, lastLook = "";
    const tick = (now: number) => {
      const t = (now - t0) % CYCLE;
      // El orbe aparece (1000–2200) y se apaga (9600–10600).
      showOrb(seg(t, 1000, 2200) * (1 - seg(t, 9600, 10600)));
      const o = stateAt(ORB_STATES, t);
      if (o !== lastOrb) { lastOrb = o; setOrbState(ORB_STATES[o][1]); }
      streamRefs.current.forEach((el, i) => {
        if (!el) return;
        const trip = TRIPS.find(([start]) => { const p = (t - start - i * 70) / 800; return p > 0 && p < 1; });
        if (!trip) { el.setAttribute("opacity", "0"); return; }
        const p = (t - trip[0] - i * 70) / 800, pt = streamPoint(p, trip[1]);
        el.setAttribute("cx", pt.x.toFixed(1));
        el.setAttribute("cy", pt.y.toFixed(1));
        el.setAttribute("opacity", Math.sin(p * Math.PI).toFixed(2));
      });
      // La t mira al orbe mientras está; antes y después, mira alrededor.
      const next = t > 1100 && t < 9800 ? { x: 1, y: 0.05 } : { x: Math.sin(now / 900) * 0.5, y: 0.1 };
      const key = `${next.x.toFixed(2)},${next.y.toFixed(2)}`;
      if (key !== lastLook) { lastLook = key; setLook(next); }
      const beat = stateAt(BEATS, t);
      if (beat !== lastBeat) {
        lastBeat = beat;
        if (beat >= 0) setMood((m) => ({ reaction: BEATS[beat][1], key: m.key + 1, smile: BEATS[beat][2] }));
      }
      if (running) raf = requestAnimationFrame(tick);
    };
    // Sólo se anima mientras está en pantalla, y arranca desde el principio al entrar.
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running) { running = true; t0 = performance.now(); lastBeat = -1; raf = requestAnimationFrame(tick); }
      if (!e.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
    });
    if (boxRef.current) io.observe(boxRef.current);
    showOrb(0);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div ref={boxRef} className={`relative aspect-[440/200] ${className ?? ""}`} role="img"
      aria-label="La t de tood conversa con un orbe de puntos que representa a un asistente de IA">
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" aria-hidden="true">
        <g transform={`translate(${AVATAR.x} ${AVATAR.y})`}>
          <ToodAvatar size={AVATAR.size} awake track lookAt={look} reaction={mood.reaction} reactionKey={mood.key} smile={mood.smile} />
        </g>
        {Array.from({ length: N_STREAM }, (_, i) => (
          <circle key={i} ref={(el) => { streamRefs.current[i] = el; }} r={[2.6, 2.2, 1.8][i % 3]} opacity={0} fill="#5B4FE9" />
        ))}
      </svg>
      <div ref={orbRef} className="absolute" aria-hidden="true"
        style={{ left: `${(ORB.x / W) * 100}%`, top: `${(ORB.y / H) * 100}%`, transform: "translate(-50%, -50%)", opacity: 0 }}>
        <ThinkingOrb state={orbState} size={64} theme="light" aria-hidden="true" />
      </div>
    </div>
  );
}

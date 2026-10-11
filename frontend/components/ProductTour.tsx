"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { EventData, Step } from "react-joyride";

const Joyride = dynamic(() => import("react-joyride").then((mod) => mod.Joyride), { ssr: false });

export function tourSeenKey(tourId: string): string {
  return `tour_seen_${tourId}`;
}

export function resetTour(tourId: string): void {
  localStorage.removeItem(tourSeenKey(tourId));
}

export function resetAllTours(tourIds: string[]): void {
  tourIds.forEach(resetTour);
}

// ── Quién más está ocupando la pantalla ──────────────────────────────────────
// Otros overlays (hoy el aviso de gastos compartidos) tienen que apartarse
// mientras corre una guía: dos cosas encimadas no se pueden usar.
//
// Es un contador vivo y no la clave `tour_seen_*` de localStorage, porque esa
// clave miente en mobile: un tour con `requireDesktop` sale sin marcarse como
// visto, así que en un teléfono queda "sin ver" para siempre. Preguntarle a
// localStorage si va a correr un tour daba "sí" eternamente y el otro overlay
// no aparecía nunca — que es exactamente el bug que esto arregla.
let runningTours = 0;
const tourListeners = new Set<() => void>();

function publishTourCount(delta: number) {
  runningTours += delta;
  tourListeners.forEach((notify) => notify());
}

/** `true` mientras haya una guía efectivamente en pantalla. */
export function useTourRunning(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      tourListeners.add(onChange);
      return () => { tourListeners.delete(onChange); };
    },
    () => runningTours > 0,
    () => false,  // en el server no corre ninguna
  );
}

// ── La forma del recorte ─────────────────────────────────────────────────────
// El recorte que ilumina un paso copia la forma del elemento: una píldora queda
// píldora, el botón + queda círculo, una tarjeta conserva sus esquinas. Joyride
// usa un solo radio para todos los pasos si no se le dice otra cosa, así que se
// lee el border-radius real de cada destino al arrancar el recorrido.
const SPOTLIGHT_PADDING = 6;

function radiusOf(el: Element): number {
  const rect = el.getBoundingClientRect();
  const raw = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  // `rounded-full` declara 9999px: el radio real es la mitad del lado corto.
  return Math.min(raw, Math.min(rect.width, rect.height) / 2);
}

function shapeFor(step: Step): Step {
  if (typeof step.target !== "string") return step;
  const el = document.querySelector(step.target);
  if (!el) return step;
  let radius = radiusOf(el);
  // Un envoltorio sin bordes propios (un div alrededor de una tarjeta) toma la
  // forma de su único hijo, que es lo que se ve.
  if (radius === 0 && el.children.length === 1) radius = radiusOf(el.children[0]);
  // El recorte va SPOTLIGHT_PADDING por fuera del borde: para que sea
  // concéntrico, su radio crece lo mismo (salvo en un rectángulo recto).
  return {
    ...step,
    spotlightPadding: SPOTLIGHT_PADDING,
    spotlightRadius: radius > 0 ? radius + SPOTLIGHT_PADDING : 0,
  };
}

export default function ProductTour({ tourId, steps, requireDesktop }: {
  tourId: string;
  steps: Step[];
  /** Skip entirely (without marking as seen) on viewports narrower than md — use
   * when steps target elements only rendered in the desktop Sidebar. */
  requireDesktop?: boolean;
}) {
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(tourSeenKey(tourId))) return;
    if (requireDesktop && !window.matchMedia("(min-width: 768px)").matches) return;
    // Una guía a la vez: si otra ya está en pantalla (la de la página mientras
    // se abre su formulario), ésta no arranca encima. Queda sin ver, así que
    // aparece la próxima vez que se abra.
    if (runningTours > 0) return;
    setRun(true);
  }, [tourId, requireDesktop]);

  // Se mide cuando arranca: recién ahí los destinos están en pantalla.
  const shapedSteps = useMemo(() => (run ? steps.map(shapeFor) : steps), [run, steps]);

  // Publicar el estado real, no la intención: `run` ya incorpora la clave de
  // localStorage y el chequeo de viewport.
  useEffect(() => {
    if (!run) return;
    publishTourCount(1);
    return () => publishTourCount(-1);
  }, [run]);

  const handleEvent = (data: EventData) => {
    if (data.status === "finished" || data.status === "skipped") {
      localStorage.setItem(tourSeenKey(tourId), "1");
      setRun(false);
    }
  };

  if (!run) return null;

  return (
    <Joyride
      steps={shapedSteps}
      run={run}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      locale={{
        back: "Atrás", close: "Cerrar", last: "Finalizar", next: "Siguiente",
        nextWithProgress: "Siguiente ({current} de {total})", skip: "Saltar",
      }}
      options={{
        buttons: ["back", "close", "primary", "skip"],
        showProgress: true,
        primaryColor: "hsl(var(--primary))",
        textColor: "hsl(var(--foreground))",
        backgroundColor: "hsl(var(--card))",
        arrowColor: "hsl(var(--card))",
        overlayColor: "rgba(30, 26, 46, 0.5)",
        zIndex: 10000,
      }}
      styles={{
        tooltip: { borderRadius: 16, fontSize: 14 },
        tooltipContent: { padding: "8px 0", textAlign: "left" },
        buttonPrimary: {
          borderRadius: 9999,
          border: "2px solid #1E1A2E",
          boxShadow: "3px 3px 0 0 #1E1A2E",
          padding: "8px 16px",
        },
        buttonBack: {
          borderRadius: 9999,
          border: "2px solid transparent",
          color: "hsl(var(--muted-foreground))",
        },
        buttonSkip: {
          color: "hsl(var(--muted-foreground))",
        },
      }}
    />
  );
}

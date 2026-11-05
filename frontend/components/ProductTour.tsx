"use client";

import { Component, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { EventData, Step, TooltipRenderProps } from "react-joyride";

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

const isVisible = (el: Element) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

// El destino real de un paso. Un mismo `data-tour` puede estar dos veces (la barra
// lateral y la de abajo) y sólo una se ve según la pantalla. Devuelve null si el
// elemento existe pero en esta pantalla no se ve, y ese paso se saltea: ilumina
// nada, si no. Si todavía no existe, se deja el selector para que Joyride lo espere.
function shapeFor(step: Step): Step | null {
  if (typeof step.target !== "string") return step;
  const selector = step.target;
  const all = Array.from(document.querySelectorAll(selector));
  if (all.length === 0) return step;
  const el = all.find(isVisible);
  if (!el) return null;
  let radius = radiusOf(el);
  // Un envoltorio sin bordes propios (un div alrededor de una tarjeta) toma la
  // forma de su único hijo, que es lo que se ve.
  if (radius === 0 && el.children.length === 1) radius = radiusOf(el.children[0]);
  // El recorte va SPOTLIGHT_PADDING por fuera del borde: para que sea
  // concéntrico, su radio crece lo mismo (salvo en un rectángulo recto).
  return {
    ...step,
    // Se busca cada vez, no se guarda el elemento: una lista se vuelve a crear al
    // llegar sus datos, y un elemento que ya no está en la página rompe a Joyride.
    target: () => Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisible) ?? null,
    // Lo que flota (las barras, el +) no se alcanza desplazando la página.
    isFixed: !!el.closest(".fixed"),
    spotlightPadding: SPOTLIGHT_PADDING,
    // Un bloque sin borde redondeado igual se ilumina redondeado: un recorte de
    // esquinas rectas es lo único recto en toda la pantalla.
    spotlightRadius: radius > 0 ? radius + SPOTLIGHT_PADDING : 20,
  };
}

/**
 * El globo de la guía. Propio y no el de la librería: el título dice de qué se
 * trata el paso, y los botones son los mismos del resto de la app.
 */
function TourTooltip({ step, index, size, isLastStep, tooltipProps, primaryProps, backProps, skipProps }: TooltipRenderProps) {
  return (
    <div {...tooltipProps}
      className="w-[min(340px,calc(100vw-1.5rem))] rounded-[26px] border border-white/70 bg-card shadow-flota p-4 text-left animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        {step.title
          ? <h2 className="text-[19px] font-medium leading-tight tracking-[-0.025em] text-foreground">{step.title}</h2>
          : <span />}
        <span className="font-marca text-xs text-muted-foreground shrink-0">{index + 1} de {size}</span>
      </div>
      <div className="mt-1.5 text-[15px] leading-snug text-[#3F3B4B]">{step.content}</div>
      {/* El avance se ve de un vistazo: la barra se llena con cada paso. */}
      <div aria-hidden="true" className="mt-3 h-1 rounded-full bg-ink/[0.08] overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${((index + 1) / size) * 100}%` }} />
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {!isLastStep && (
          <button {...skipProps} className="h-11 pr-3 text-sm font-semibold text-muted-foreground">Saltar</button>
        )}
        <span className="flex-1" />
        {index > 0 && (
          <button {...backProps} className="h-11 px-4 rounded-full bg-ink/[0.06] text-sm font-semibold text-foreground active:scale-[0.97] transition-transform duration-100">Atrás</button>
        )}
        <button {...primaryProps} className="h-11 px-5 rounded-full bg-ink text-background text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] transition-transform duration-100">
          {isLastStep ? "Listo" : "Siguiente"}
        </button>
      </div>
    </div>
  );
}

/** La guía es un extra: si falla, se apaga ella sola y la pantalla sigue andando. */
class TourBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("[ProductTour]", error); }
  render() { return this.state.failed ? null : this.props.children; }
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
  const shapedSteps = useMemo(
    () => (run ? steps.map(shapeFor).filter((s): s is Step => s !== null) : steps),
    [run, steps],
  );

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

  // Ningún paso se ve en esta pantalla: no arranca, y queda sin marcar como vista.
  if (!run || shapedSteps.length === 0) return null;

  return (
    <TourBoundary>
    <Joyride
      steps={shapedSteps}
      run={run}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      tooltipComponent={TourTooltip}
      locale={{
        back: "Atrás", close: "Cerrar", last: "Listo", next: "Siguiente",
        nextWithProgress: "Siguiente ({current} de {total})", skip: "Saltar",
      }}
      options={{
        buttons: ["back", "primary", "skip"],
        skipBeacon: true,
        primaryColor: "hsl(var(--primary))",
        textColor: "hsl(var(--foreground))",
        backgroundColor: "hsl(var(--card))",
        arrowColor: "hsl(var(--card))",
        arrowBase: 18,
        arrowSize: 9,
        overlayColor: "rgba(28, 27, 37, 0.5)",
        // Lo que se ilumina no puede quedar debajo de la barra de abajo o de la de arriba.
        scrollOffset: 110,
        zIndex: 10000,
      }}
    />
    </TourBoundary>
  );
}

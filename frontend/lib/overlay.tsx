"use client";

import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Las hojas abiertas (un formulario, la ficha de un movimiento, el +), apiladas.
 *
 * Sirve para dos cosas que se rompían por separado en cada hoja:
 * - **Lo de atrás no se mueve.** Con una hoja abierta, deslizar sobre el fondo o
 *   llegar al final del formulario desplazaba la página de abajo. En el celular
 *   la que se desplaza es la página entera y en la compu `#main-content`, así que
 *   se frenan las dos. La página se fija en su lugar (`position: fixed` con el
 *   desplazamiento como `top`), porque en Safari de iOS `overflow: hidden` en el
 *   body no alcanza.
 * - **Una guía corre sólo en la capa de arriba.** La de la página quedaba encima
 *   del formulario, iluminando algo que estaba detrás. Ver `useOverlayLayer`.
 */
let stack = 0;
const listeners = new Set<() => void>();
let saved: { y: number; body: string; html: string; main: string } | null = null;

function lock() {
  const body = document.body;
  const main = document.getElementById("main-content");
  const y = window.scrollY;
  saved = { y, body: body.style.cssText, html: document.documentElement.style.overflow, main: main?.style.overflow ?? "" };
  body.style.position = "fixed";
  body.style.top = `-${y}px`;
  body.style.left = "0";
  body.style.right = "0";
  document.documentElement.style.overflow = "hidden";
  if (main) main.style.overflow = "hidden";
}

function unlock() {
  if (!saved) return;
  const main = document.getElementById("main-content");
  document.body.style.cssText = saved.body;
  document.documentElement.style.overflow = saved.html;
  if (main) main.style.overflow = saved.main;
  window.scrollTo({ top: saved.y, behavior: "instant" });
  saved = null;
}

function change(delta: number) {
  const before = stack;
  stack = Math.max(0, stack + delta);
  if (before === 0 && stack > 0) lock();
  if (before > 0 && stack === 0) unlock();
  listeners.forEach(notify => notify());
}

/** La capa en la que está un componente: 0 es la página, 1 la primera hoja… */
export const OverlayLayer = createContext(0);

/**
 * Registra una hoja mientras `open` sea true y devuelve su capa, que se pasa con
 * `<OverlayLayer.Provider>` a lo que va adentro (una guía del formulario, por ejemplo).
 *
 * La capa sale del árbol y no del orden en que se abrieron, así se conoce desde
 * el primer render: la guía de adentro no llega a arrancar en la capa equivocada.
 * `stacked` es una hoja que va como hermana de otra hoja abierta, no adentro.
 */
export function useOverlay(open = true, stacked = false): number {
  const parent = useContext(OverlayLayer);
  useLayoutEffect(() => {
    if (!open) return;
    change(1);
    return () => change(-1);
  }, [open]);
  return parent + (stacked ? 2 : 1);
}

/** Cuántas hojas hay abiertas: la capa de arriba de todo. */
export function useTopOverlay(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => { listeners.delete(onChange); };
    },
    () => stack,
    () => 0,
  );
}

/** `true` si nada tapa la capa de este componente. */
export function useIsTopLayer(): boolean {
  const layer = useContext(OverlayLayer);
  return useTopOverlay() === layer;
}

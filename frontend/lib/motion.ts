"use client";

import { useLayoutEffect, useRef } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";

export const SHEET_OUT_MS = 180;

/**
 * Una lista o un bloque cuyo contenido cambia: lo que entra aparece, lo que sale
 * se cierra y lo demás se corre hasta su lugar, sin saltos. Va en el contenedor
 * directo de las filas. Con movimiento reducido no anima nada.
 */
export function useListMotion<T extends Element>() {
  const [ref] = useAutoAnimate<T>({ duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  return ref;
}

/**
 * Que una hoja baje al cerrarse en vez de desaparecer, también cuando la cierra
 * quien la abrió (al guardar, por ejemplo), que la saca del árbol de golpe. React
 * no espera a nadie, así que lo que se va es una copia inerte de la hoja.
 *
 * La copia se arma recién si el nodo ya no está en la página: en desarrollo,
 * StrictMode corre esta limpieza al montar, con la hoja todavía ahí.
 */
export function useExitGhost<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const ghost = node.cloneNode(true) as HTMLElement;
      queueMicrotask(() => {
        if (node.isConnected) return;
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        ghost.style.pointerEvents = "none";
        ghost.classList.remove("animate-fade-in");
        ghost.classList.add("animate-fade-out");
        ghost.querySelectorAll(".animate-sheet-in").forEach(el => {
          el.classList.remove("animate-sheet-in");
          el.classList.add("animate-sheet-out");
        });
        document.body.appendChild(ghost);
        setTimeout(() => ghost.remove(), SHEET_OUT_MS);
      });
    };
  }, []);
  return ref;
}

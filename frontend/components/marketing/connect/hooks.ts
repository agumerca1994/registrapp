"use client";

import { useEffect, useState, type RefObject } from "react";

/** Línea a partir de la cual un número de paso cuenta como "alcanzado". */
const REACH_AT = 0.62;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Marca `data-reached` en cada paso cuyo número ya pasó el 62 % del alto de la
 * ventana, y prende `data-anim` en el contenedor (sin JS no se apaga nada).
 * Escribe atributos en el DOM en vez de estado: el scroll no re-renderiza.
 *
 * Recalcula con el scroll (pasivo), con el resize y cuando cambia el tamaño del
 * contenedor: una pestaña que estaba oculta mide 0 hasta que se muestra, y una
 * captura que termina de cargar mueve los pasos de abajo.
 */
export function useReachedSteps(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduced = prefersReducedMotion();
    root.setAttribute("data-anim", "");
    const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
    let frame = 0;
    const update = () => {
      frame = 0;
      const limit = window.innerHeight * REACH_AT;
      for (const step of steps) {
        const num = step.querySelector<HTMLElement>("[data-step-num]") ?? step;
        const reached = reduced || num.getBoundingClientRect().top < limit;
        step.toggleAttribute("data-reached", reached);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [ref]);
}

/*
 * Un único IntersectionObserver para todo lo que aparece al entrar en pantalla.
 * Cada elemento se observa una vez y se suelta en cuanto aparece: no parpadea
 * al volver a pasar.
 */
let shared: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, () => void>();

function observer(): IntersectionObserver {
  if (!shared) {
    shared = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        shared!.unobserve(e.target);
        callbacks.get(e.target)?.();
        callbacks.delete(e.target);
      }
    }, { threshold: 0.15 });
  }
  return shared;
}

/**
 * Llama a `onShow` la primera vez que el elemento entra en pantalla. Devuelve
 * `false` si el elemento ya estaba a la vista al montar (o hay reducción de
 * movimiento): en ese caso no hay nada que esconder ni animar.
 */
export function watchOnce(el: Element, onShow: () => void): boolean {
  if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") return false;
  if (el.getBoundingClientRect().top < window.innerHeight) return false;
  callbacks.set(el, onShow);
  observer().observe(el);
  return true;
}

export function unwatch(el: Element) {
  callbacks.delete(el);
  shared?.unobserve(el);
}

/** Aparición única al entrar en pantalla, con `data-pending` mientras espera. */
export function useReveal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const waiting = watchOnce(el, () => el.removeAttribute("data-pending"));
    if (waiting) el.setAttribute("data-pending", "");
    return () => unwatch(el);
  }, [ref]);
}

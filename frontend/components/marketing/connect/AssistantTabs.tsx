"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./connect.module.css";

export interface AssistantTab {
  /** Va en la URL: /conectar#<id> abre esta pestaña. */
  id: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Una pestaña por asistente. Sumar uno es sumar un elemento a `tabs`.
 *
 * - role tablist/tab/tabpanel, ← → Inicio y Fin entre pestañas, y sólo la
 *   activa entra en el orden de Tab (roving tabindex).
 * - La pestaña vive en el hash: /conectar#claude-code abre esa y baja hasta el
 *   paso a paso, así se puede mandar el link a la parte de un asistente.
 * - Todos los paneles se renderizan (los inactivos con `hidden`): sin JS se ve
 *   el primero, y el contenido está en el HTML.
 */
export function AssistantTabs({ tabs, label }: { tabs: AssistantTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0].id);
  const [animate, setAnimate] = useState(false);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!tabs.some(t => t.id === id)) return false;
      setActive(id);
      return true;
    };
    if (fromHash()) requestAnimationFrame(() => list.current?.scrollIntoView({ block: "start" }));
    const onHash = () => { if (fromHash()) list.current?.scrollIntoView({ block: "start", behavior: "smooth" }); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [tabs]);

  const select = (id: string, focus = false) => {
    setAnimate(true);
    setActive(id);
    history.replaceState(null, "", `#${id}`);
    if (focus) refs.current[id]?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(t => t.id === active);
    const to = e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(tabs[to].id, true);
  };

  return (
    <div>
      {/* El scroll horizontal es de la tira, no de la página. */}
      <div ref={list} role="tablist" aria-label={label} onKeyDown={onKey}
        className="scroll-mt-24 -mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {tabs.map(t => {
          const on = t.id === active;
          return (
            <button key={t.id} ref={el => { refs.current[t.id] = el; }}
              id={`tab-${t.id}`} role="tab" type="button"
              aria-selected={on} aria-controls={`panel-${t.id}`} tabIndex={on ? 0 : -1}
              onClick={() => select(t.id)}
              className={`shrink-0 whitespace-nowrap rounded-full border-2 px-4 py-2 text-sm md:text-base font-semibold transition-colors ${
                on ? "border-ink bg-primary text-primary-foreground shadow-chip"
                  : "border-ink/15 bg-card text-muted-foreground hover:text-foreground hover:border-ink/40"}`}>
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map(t => (
        <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== active} tabIndex={0}
          className={`mt-8 focus:outline-none ${animate && t.id === active ? styles.panelIn : ""}`}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

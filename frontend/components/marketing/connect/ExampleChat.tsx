"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./connect.module.css";
import { unwatch, watchOnce } from "./hooks";

export interface ChatMessage { from: "user" | "assistant"; text: string }

/**
 * El ejemplo del último paso, con el estilo de la sección de IA de la home.
 * No es una captura del asistente: son burbujas de tero con las
 * respuestas armadas a partir de lo que devolvieron las tools reales contra
 * una cuenta de demo, y lo dice arriba.
 *
 * Si entra en pantalla desde abajo, se escribe sola: cada respuesta aparece
 * después de unos puntitos. Todas las burbujas ocupan su lugar desde el
 * principio (sólo cambia la opacidad), así la página no salta. Sin JS, ya
 * a la vista al cargar o con reducción de movimiento, aparece completa.
 */
export function ExampleChat({ messages, label }: { messages: ChatMessage[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(messages.length);   // cuántas burbujas se ven
  const [typing, setTyping] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const play = () => {
      let t = 250;
      messages.forEach((m, i) => {
        if (m.from === "assistant") {
          timers.current.push(window.setTimeout(() => { setStep(i); setTyping(true); }, t));
          t += 1100;
        }
        timers.current.push(window.setTimeout(() => { setTyping(false); setStep(i + 1); }, t));
        t += m.from === "user" ? 500 : 900;
      });
    };
    if (watchOnce(el, play)) setStep(0);
    const pending = timers.current;
    return () => { unwatch(el); pending.forEach(clearTimeout); };
  }, [messages]);

  return (
    <div ref={ref} aria-label={label}
      className="rounded-2xl bg-background border-2 border-ink p-3 md:p-5 space-y-3 text-[15px] md:text-base shadow-chip">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {messages.map((m, i) => {
        const isTyping = typing && i === step && m.from === "assistant";
        const hidden = i >= step && !isTyping;
        const user = m.from === "user";
        return (
          <p key={i} data-hidden={hidden ? "" : undefined}
            className={`${styles.bubble} relative w-fit rounded-2xl px-4 py-2.5 ${user
              ? "ml-auto max-w-[85%] rounded-br-md bg-primary text-primary-foreground"
              : "max-w-[92%] rounded-bl-md bg-card border border-border text-foreground"}`}>
            <span className={isTyping ? "invisible" : undefined}>{m.text}</span>
            {isTyping && (
              <span className="absolute left-4 top-1/2 -translate-y-1/2 flex gap-1" aria-hidden="true">
                <span className={`${styles.dot} w-2 h-2 rounded-full bg-muted-foreground`} />
                <span className={`${styles.dot} w-2 h-2 rounded-full bg-muted-foreground`} />
                <span className={`${styles.dot} w-2 h-2 rounded-full bg-muted-foreground`} />
              </span>
            )}
          </p>
        );
      })}
    </div>
  );
}

"use client";

import { useRef } from "react";
import styles from "./connect.module.css";
import { useReachedSteps } from "./hooks";

/**
 * La línea de tiempo vertical numerada del paso a paso. Cada `Step` pinta su
 * número y el tramo de riel hasta el siguiente; `useReachedSteps` los va
 * encendiendo a medida que se baja.
 */
export function StepTimeline({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLOListElement>(null);
  useReachedSteps(ref);
  return <ol ref={ref} aria-label={label} className={`${styles.timeline} max-w-[720px]`}>{children}</ol>;
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li data-step className={styles.step}>
      <span data-step-num aria-hidden="true" className={styles.num}>{n}</span>
      <div className="min-w-0 pt-[calc((var(--num)_-_1.75rem)/2)]">
        <h3 className="font-display font-bold text-xl md:text-2xl tracking-tight leading-7">
          <span className="sr-only">Paso {n}: </span>{title}
        </h3>
        <div className="mt-2 space-y-4 text-muted-foreground md:text-lg">{children}</div>
      </div>
    </li>
  );
}

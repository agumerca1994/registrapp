"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Preguntas largas, de las que haría una persona, en una tira con scroll-snap.
 * Las flechas avanzan una tarjeta y se apagan en los extremos. En un celular
 * cada tarjeta ocupa ~82 % del ancho, así se ve que hay otra al lado.
 */
export function PromptCarousel({ prompts, label }: { prompts: string[]; label: string }) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.scrollLeft = 0;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => { el.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [measure, prompts]);

  const go = (dir: 1 | -1) => {
    const el = track.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + 16), behavior: smooth ? "smooth" : "auto" });
  };

  const arrow = "w-11 h-11 rounded-full border-2 border-ink bg-card flex items-center justify-center shadow-chip disabled:opacity-35 disabled:shadow-none active:translate-x-[1px] active:translate-y-[1px] active:shadow-none";
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-display font-bold text-xl md:text-2xl tracking-tight">{label}</h3>
        <div className="flex gap-2 shrink-0">
          <button type="button" className={arrow} onClick={() => go(-1)} disabled={edges.start} aria-label="Pregunta anterior">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button type="button" className={arrow} onClick={() => go(1)} disabled={edges.end} aria-label="Pregunta siguiente">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      <ul ref={track} aria-label={label}
        className="mt-5 -mx-4 px-4 md:mx-0 md:px-0 flex gap-4 overflow-x-auto snap-x snap-mandatory no-scrollbar scroll-px-4 md:scroll-px-0 pb-3">
        {prompts.map(p => (
          <li key={p} className="snap-start shrink-0 w-[82%] sm:w-[46%] lg:w-[31.5%] rounded-2xl border-2 border-ink bg-card p-5 md:p-6 shadow-chip flex flex-col">
            <span aria-hidden="true" className="font-display font-bold text-5xl leading-none text-primary/80">“</span>
            <p className="mt-1 text-foreground md:text-lg">{p}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

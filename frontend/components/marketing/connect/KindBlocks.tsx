"use client";

import { useMemo } from "react";
import { ArrowRight, LineChart, PencilLine, Search } from "lucide-react";
import styles from "./connect.module.css";
import { ExampleChat } from "./ExampleChat";
import { useKind } from "./kind";
import { PromptCarousel } from "./PromptCarousel";
import { CHATS, LONG_PROMPTS, VERBS } from "./questions";

/** "$ 1.500" sin que el monto se parta al final de una línea. */
export const nb = (s: string) => s.replace(/\$ /g, "$ ").replace(/ %/g, " %");

const ICONS = { "Consultá": Search, "Analizá": LineChart, "Cargá": PencilLine };

/** Las tres tarjetas por verbo y el carrusel de preguntas largas, según hogar o negocio. */
export function QuestionBlocks() {
  const { kind } = useKind();
  return (
    <div key={kind} className={styles.panelIn}>
      <div className="grid md:grid-cols-3 gap-4 md:gap-6">
        {VERBS[kind].map(({ verb, text, questions }) => {
          const Icon = ICONS[verb];
          return (
            <article key={verb} className="rounded-2xl border-2 border-ink bg-card p-5 md:p-6 shadow-chip transition-transform duration-300 hover:-translate-y-1 motion-reduce:hover:translate-y-0">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full border-2 border-ink bg-accent flex items-center justify-center">
                  <Icon className="w-4 h-4 text-primary" aria-hidden="true" />
                </span>
                <h3 className="font-display font-bold text-2xl">{verb}</h3>
              </div>
              <p className="mt-2 text-muted-foreground">{text}</p>
              <ul className="mt-4 space-y-2.5">
                {questions.map(q => (
                  <li key={q} className="flex gap-2">
                    <ArrowRight className="w-4 h-4 mt-1 text-primary shrink-0" aria-hidden="true" />
                    <span>{nb(q)}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <div className="mt-12">
        <PromptCarousel label="Preguntas más largas, también" prompts={LONG_PROMPTS[kind].map(nb)} />
      </div>
    </div>
  );
}

/** El último paso: qué preguntarle, y un ejemplo con números de una cuenta de demo. */
export function FirstQuestion() {
  const { kind } = useKind();
  const messages = useMemo(() => CHATS[kind].map(m => ({ ...m, text: nb(m.text) })), [kind]);
  const examples = VERBS[kind].flatMap(v => v.questions.slice(0, v.verb === "Cargá" ? 1 : 2)).slice(0, 4);
  return (
    <>
      <p>Escribile como le escribirías a alguien que tiene todos tus números a mano. Por ejemplo:</p>
      <ul className="space-y-2 text-foreground">
        {examples.map(q => (
          <li key={q} className="flex gap-2">
            <ArrowRight className="w-4 h-4 mt-1.5 text-primary shrink-0" aria-hidden="true" />
            <span>{nb(q)}</span>
          </li>
        ))}
      </ul>
      <ExampleChat key={kind} label={kind === "business" ? "Ejemplo de conversación · negocio de demo" : "Ejemplo de conversación · hogar de demo"}
        messages={messages} />
    </>
  );
}

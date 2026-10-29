"use client";

import { createContext, useContext, useState } from "react";
import { Home, Store } from "lucide-react";

export type Kind = "household" | "business";

const KindContext = createContext<{ kind: Kind; setKind: (k: Kind) => void }>({ kind: "household", setKind: () => {} });

/**
 * Hogar o negocio: el paso a paso es el mismo, cambian las preguntas de
 * ejemplo y lo que habilita la conexión. Un solo estado para toda la página,
 * así el selector de arriba y el ejemplo del último paso no se contradicen.
 */
export function KindProvider({ children }: { children: React.ReactNode }) {
  const [kind, setKind] = useState<Kind>("household");
  return <KindContext.Provider value={{ kind, setKind }}>{children}</KindContext.Provider>;
}

export const useKind = () => useContext(KindContext);

/** Elige qué preguntas mostrar. Es un selector de vista, no de navegación: aria-pressed. */
export function KindToggle({ className = "" }: { className?: string }) {
  const { kind, setKind } = useKind();
  const opts = [
    { value: "household" as const, label: "Hogar", icon: Home },
    { value: "business" as const, label: "Negocio", icon: Store },
  ];
  return (
    <div role="group" aria-label="Tipo de cuenta"
      className={`inline-flex rounded-full border-2 border-ink bg-card p-1 gap-1 shadow-chip ${className}`}>
      {opts.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
            kind === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          <Icon className="w-4 h-4" aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}

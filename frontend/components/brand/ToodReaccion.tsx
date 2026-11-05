"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ToodAvatar, type ToodReaction } from "@/components/brand/ToodAvatar";

// La t confirma lo que acabás de hacer: guardar, borrar o un error. Sin esto, cargar o eliminar algo no daba
// ninguna señal de que se hizo.
//   - Es una píldora de vidrio, la misma de la barra de abajo y de las hojas, con la t adentro y una línea de texto.
//   - En el celular sube desde la barra y se apoya justo arriba; en la compu, abajo a la derecha, donde está el +.
//     El + se esconde mientras tanto (Fab lee `useReaccionActiva`).
//   - No tapa lo que acabás de hacer: la fila nueva se tiene que poder ver mientras la t confirma.
// Se usa con `const reaccionar = useReaccion(); reaccionar("guardado", "Egreso guardado")`. El texto va
// siempre: es lo que lee un lector de pantalla y lo que ve quien tiene el movimiento reducido.

export type Reaccion = "guardado" | "ingreso" | "borrado" | "error";

const AVATAR: Record<Reaccion, ToodReaction> = { guardado: "gasto", ingreso: "meta", borrado: "pasado", error: "alerta" };
// Cuánto queda en pantalla: lo que dura la reacción de la t y un respiro.
const DURA: Record<Reaccion, number> = { guardado: 2300, ingreso: 2800, borrado: 2100, error: 2600 };
const SALIDA_MS = 220;

type Estado = { tipo: Reaccion; texto: string; key: number; visible: boolean };

const Ctx = createContext<{ reaccionar: (tipo: Reaccion, texto: string) => void; activa: boolean }>({
  reaccionar: () => {},
  activa: false,
});

export function ReaccionProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const timers = useRef<number[]>([]);

  const reaccionar = useCallback((tipo: Reaccion, texto: string) => {
    timers.current.forEach(clearTimeout);
    setEstado((e) => ({ tipo, texto, key: (e?.key ?? 0) + 1, visible: true }));
    timers.current = [
      window.setTimeout(() => setEstado((e) => (e ? { ...e, visible: false } : e)), DURA[tipo]),
      window.setTimeout(() => setEstado(null), DURA[tipo] + SALIDA_MS),
    ];
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <Ctx.Provider value={{ reaccionar, activa: !!estado }}>
      {children}
      {/* El texto, para lectores de pantalla, aunque la animación no se vea. */}
      <p role="status" aria-live="polite" className="sr-only">{estado?.texto ?? ""}</p>
      {estado && <ReaccionVisible estado={estado} />}
    </Ctx.Provider>
  );
}

function ReaccionVisible({ estado }: { estado: Estado }) {
  const { tipo, texto, key, visible } = estado;
  // Entra un cuadro después de montarse, para que la transición de entrada se vea.
  const [dentro, setDentro] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDentro(true));
    return () => cancelAnimationFrame(id);
  }, [key]);
  const on = dentro && visible;
  // Sube con un rebote chico y baja por donde vino, más rápido: la misma dirección de las hojas.
  const anim = `transition-[opacity,transform] ${on
    ? "duration-[420ms] ease-[cubic-bezier(0.34,1.4,0.64,1)] opacity-100 translate-y-0 scale-100"
    : dentro ? "duration-200 ease-in opacity-0 translate-y-4 scale-[0.97]" : "duration-0 opacity-0 translate-y-6 scale-95"}`;

  return (
    <div aria-hidden="true" className="fixed z-[70] pointer-events-none flex justify-center left-3 right-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:left-auto md:right-8 md:bottom-6">
      <div className={`${anim} flex items-center gap-1.5 max-w-full min-h-[64px] pl-2 pr-5 rounded-full border border-white/70 bg-card/85 backdrop-blur-2xl backdrop-saturate-150 shadow-flota`}>
        <ToodAvatar size={56} reaction={AVATAR[tipo]} reactionKey={key} duration={0} holeColor="hsl(var(--card))" className="shrink-0" />
        <p className="min-w-0 font-medium text-[16px] leading-tight tracking-[-0.01em] text-foreground">{texto}</p>
      </div>
    </div>
  );
}

/** Para avisar que algo se hizo (o no). */
export function useReaccion() {
  return useContext(Ctx).reaccionar;
}

/** Si hay una reacción en pantalla: el botón + se esconde en la compu mientras tanto. */
export function useReaccionActiva() {
  return useContext(Ctx).activa;
}

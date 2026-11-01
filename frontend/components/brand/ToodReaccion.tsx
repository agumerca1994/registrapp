"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ToodAvatar, type ToodReaction } from "@/components/brand/ToodAvatar";

// La t confirma lo que acabás de hacer: guardar, borrar o un error. Sin esto, cargar o eliminar algo no daba
// ninguna señal de que se hizo.
//   - En el celular aparece en el medio de la pantalla, con su animación y una línea de texto, y se va sola.
//   - En la compu aparece abajo a la derecha, mucho más grande que el botón +, y el + se esconde mientras tanto
//     (Fab lee `useReaccionActiva`). Si la pantalla no tiene +, aparece igual en ese lugar.
//   - Nunca dentro de una caja ni de un círculo: flota sobre la pantalla, con un desenfoque suave detrás (`Halo`).
// Se usa con `const reaccionar = useReaccion(); reaccionar("guardado", "Egreso guardado")`. El texto va
// siempre: es lo que lee un lector de pantalla y lo que ve quien tiene el movimiento reducido.

export type Reaccion = "guardado" | "ingreso" | "borrado" | "error";

const AVATAR: Record<Reaccion, ToodReaction> = { guardado: "gasto", ingreso: "meta", borrado: "pasado", error: "alerta" };
// Cuánto queda en pantalla: lo que dura la reacción de la t y un respiro.
const DURA: Record<Reaccion, number> = { guardado: 2300, ingreso: 2800, borrado: 2100, error: 2600 };
const SALIDA_MS = 250;

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
  const anim = `transition-all duration-300 ease-out ${on ? "opacity-100 scale-100" : "opacity-0 scale-75"}`;
  const avatar = (size: number) => (
    <ToodAvatar size={size} reaction={AVATAR[tipo]} reactionKey={key} duration={0} holeColor="#ffffff" />
  );

  return (
    <div aria-hidden="true">
      {/* Celular: en el medio de la pantalla, flotando sobre lo que haya, sin caja. */}
      <div className="md:hidden fixed inset-0 z-[70] grid place-items-center pointer-events-none px-6">
        <div className={`${anim} relative flex flex-col items-center gap-3`}>
          <Halo />
          <div className="relative translate-x-[5.5%]">{avatar(210)}</div>
          <p className="relative font-display font-semibold text-xl text-foreground text-center">{texto}</p>
        </div>
      </div>
      {/* Compu: abajo a la derecha, donde está el botón +, flotando y bastante más grande que él. */}
      <div className="hidden md:block fixed right-12 bottom-10 z-[45] pointer-events-none">
        <div className={`${anim} relative origin-bottom-right flex items-end gap-2`}>
          <Halo />
          <p className="relative mb-12 font-display font-semibold text-xl text-foreground whitespace-nowrap">{texto}</p>
          <div className="relative">{avatar(230)}</div>
        </div>
      </div>
    </div>
  );
}

/** Un desenfoque suave detrás, que se desvanece hacia los bordes: separa la t de lo que tiene abajo sin encerrarla
 *  en una caja. */
function Halo() {
  const mask = "radial-gradient(closest-side, #000 50%, transparent 100%)";
  return (
    <span className="absolute -inset-16 bg-background/60 backdrop-blur-xl"
      style={{ maskImage: mask, WebkitMaskImage: mask }} />
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

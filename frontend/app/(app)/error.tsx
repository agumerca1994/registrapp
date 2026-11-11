"use client";

import { useEffect } from "react";
import { ToodAvatar } from "@/components/brand/ToodAvatar";
import { reportError } from "@/lib/report-error";

/** Si una pantalla falla: lo que pasó y cómo seguir, en vez de la página de error del navegador. */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error("[AppError]", error); reportError(error); }, [error]);
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <ToodAvatar size={110} reaction="duda" reactionKey={1} duration={0} className="translate-x-[5.5%]" />
      <h1 className="mt-4 text-[26px] font-medium tracking-[-0.035em] text-foreground">Esta pantalla falló</h1>
      <p className="mt-1 text-[15.5px] leading-snug text-muted-foreground max-w-xs">Tus datos están bien. Probá de nuevo, y si sigue pasando, volvé a abrir la app.</p>
      <button type="button" onClick={reset}
        className="mt-5 h-12 px-6 rounded-full bg-ink text-background font-semibold text-[15px] active:scale-[0.97] transition-transform duration-100">
        Probar de nuevo
      </button>
    </div>
  );
}

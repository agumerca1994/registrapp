"use client";

import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "@/contexts/PrivacyContext";

/** El bloque de color de la marca: arriba de una pantalla, y sólo si tiene una cifra que lo justifique. */
export const VIOLET = "bg-[linear-gradient(165deg,#4A3FC4_0%,#352A9E_100%)] text-white";
export const BLOCK = `${VIOLET} rounded-[34px] px-3 pt-5 pb-3.5 md:px-5 md:pb-5`;

/**
 * El de Inicio llega hasta los bordes del celular, porque esa pantalla no tiene
 * barra arriba. `!mt-0`: la guía y la cifra flotante son hermanos anteriores, y
 * el `space-y` del padre le daría margen arriba.
 */
export const HOME_BLOCK = `!mt-0 ${VIOLET} -mx-4 md:mx-0 rounded-b-[34px] md:rounded-[34px] px-3 pb-5 md:px-5 md:pb-6`;
export const HOME_BLOCK_TOP = { paddingTop: "calc(1.25rem + env(safe-area-inset-top))" };

/**
 * El vidrio claro: lo que flota sobre la página (las barras, las hojas, el aviso
 * de la t). Bien translúcido y con el color de abajo saturado, porque sobre el
 * papel crema un vidrio casi opaco se lee como un bloque liso. Sin backdrop-filter queda casi opaco
 * para que se siga leyendo.
 */
export const GLASS_LIGHT = "border border-white/70 bg-card/95 supports-[backdrop-filter]:bg-card/55 backdrop-blur-xl backdrop-saturate-[1.8]";
/** El de las hojas: un poco más cubierto, porque adentro se lee y se escribe. */
export const GLASS_SHEET = "border border-white/70 bg-card/95 supports-[backdrop-filter]:bg-card/75 backdrop-blur-2xl backdrop-saturate-[1.8]";

/** Lo que va adentro del bloque violeta. */
export const GLASS = "rounded-3xl bg-white/[0.13] border border-white/[0.22] backdrop-blur-lg";

export function GlassEye() {
  const { hidden, toggle } = usePrivacy();
  return (
    <button onClick={toggle} aria-label={hidden ? "Mostrar montos" : "Ocultar montos"} title={hidden ? "Mostrar montos" : "Ocultar montos"}
      className="w-[46px] h-[46px] shrink-0 rounded-full bg-white/15 border border-white/25 backdrop-blur-lg text-white flex items-center justify-center active:scale-[0.95] transition-transform duration-100">
      {hidden ? <EyeOff className="w-[21px] h-[21px]" strokeWidth={1.8} /> : <Eye className="w-[21px] h-[21px]" strokeWidth={1.8} />}
    </button>
  );
}

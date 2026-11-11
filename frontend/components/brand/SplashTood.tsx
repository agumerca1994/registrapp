"use client";

import { useEffect, useState } from "react";
import { ToodAvatar } from "@/components/brand/ToodAvatar";
import { ToodLogo } from "@/components/brand/ToodLogo";
import { VIOLET } from "@/components/ui/glass";

// La pantalla de carga de la app: el mismo violeta de los bloques de Inicio, la t despierta mirando alrededor y el
// logo. Va en el HTML inicial (el layout de la app la dibuja mientras no sabe quién sos), así que al abrir la app se
// ve la marca y no una pantalla en blanco. Cuando la app está lista el violeta se levanta como un telón, y en Inicio
// empalma con su propio bloque violeta. La barra aparece recién si la carga tarda: en una rápida no se llega a ver.

const CURTAIN_MS = 560;
// El color de los ojos: el violeta del degradé a la altura de la t.
const HOLE = "#3F35B1";
// Hacia dónde mira mientras espera: un recorrido corto, como quien busca algo.
const GLANCES = [{ x: 0.7, y: -0.2 }, { x: -0.6, y: 0.1 }, { x: 0.1, y: 0.4 }, { x: -0.2, y: -0.4 }, { x: 0, y: 0 }];

export function SplashTood({ visible }: { visible: boolean }) {
  const [mounted, setMounted] = useState(visible);
  const [glance, setGlance] = useState(4);

  useEffect(() => {
    if (visible) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), CURTAIN_MS);
    return () => window.clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    if (!mounted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setGlance((g) => (g + 1) % GLANCES.length), 1100);
    return () => window.clearInterval(id);
  }, [mounted]);

  if (!mounted) return null;
  return (
    <div role="status" aria-label="Cargando tood"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center ${VIOLET} ${visible ? "" : "animate-splash-curtain pointer-events-none"}`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className={`flex flex-col items-center transition-[opacity,transform] duration-200 ${visible ? "" : "opacity-0 -translate-y-3"}`}>
        {/* Centrados por lo que se dibuja, como en el login: el copete corre el avatar y el logo de su caja. */}
        <ToodAvatar size={112} className="animate-splash-up translate-x-[5.5%]" ink="#ffffff" holeColor={HOLE}
          awake track lookAt={GLANCES[glance]} />
        <div className="animate-splash-up mt-3 [animation-delay:70ms]" style={{ transform: "translateX(-3%)" }}>
          <ToodLogo className="h-8 w-auto text-white" title="tood" />
        </div>
        <div aria-hidden="true" className="animate-splash-up mt-7 w-20 h-[3px] rounded-full bg-white/20 overflow-hidden [animation-delay:900ms]">
          <div className="animate-splash-bar h-full w-2/5 rounded-full bg-white" />
        </div>
      </div>
    </div>
  );
}

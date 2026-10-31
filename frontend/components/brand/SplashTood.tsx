"use client";

import { useEffect, useState } from "react";
import { ToodAvatar } from "@/components/brand/ToodAvatar";
import { ToodLogo } from "@/components/brand/ToodLogo";
import { BRAND_FIELD } from "@/lib/brand/tood-cara";

// La pantalla de carga de la app: el violeta del login, el logo y la t despierta mirando alrededor. Va en el HTML
// inicial (el layout de la app la dibuja mientras no sabe quién sos), así que al abrir la app se ve la marca y no
// una pantalla en blanco. Cuando la app está lista se desvanece; si la carga es instantánea, apenas se nota.

const FADE_MS = 400;
// Hacia dónde mira mientras espera: un recorrido corto, como quien busca algo.
const GLANCES = [{ x: 0.7, y: -0.2 }, { x: -0.6, y: 0.1 }, { x: 0.1, y: 0.4 }, { x: -0.2, y: -0.4 }, { x: 0, y: 0 }];

export function SplashTood({ visible }: { visible: boolean }) {
  const [mounted, setMounted] = useState(visible);
  const [glance, setGlance] = useState(4);

  useEffect(() => {
    if (visible) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), FADE_MS);
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
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-opacity ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      style={{ background: BRAND_FIELD, transitionDuration: `${FADE_MS}ms`, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Centrados por lo que se dibuja, como en el login: el copete corre el avatar y el logo de su caja. */}
      <div style={{ transform: "translateX(-3%)" }}><ToodLogo className="h-9 w-auto text-white" title="tood" /></div>
      <ToodAvatar size={150} className="mt-6 translate-x-[5.5%]" ink="#ffffff" holeColor={BRAND_FIELD}
        awake track lookAt={GLANCES[glance]} />
    </div>
  );
}

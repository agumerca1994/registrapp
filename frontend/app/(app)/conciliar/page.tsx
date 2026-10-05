"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Ya no hay una sección propia: "Subir resumen" vive en Tarjetas, y los
 * resúmenes a medio revisar se listan ahí. La ruta queda para que un favorito
 * viejo no termine en un 404; /conciliar/[id] sigue siendo la pantalla de
 * revisión (los links del bot de WhatsApp apuntan ahí).
 */
export default function ConciliarRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/tarjetas"); }, [router]);
  return null;
}

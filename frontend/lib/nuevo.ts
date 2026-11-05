"use client";

import { useEffect, useRef } from "react";

const EVENT = "tood:nuevo";

/**
 * El + de la barra abre el formulario de la pantalla que corresponda. Si ya
 * estás ahí, navegar a la misma ruta no vuelve a montar la página y no pasaría
 * nada, así que se avisa con un evento.
 */
export function pedirNuevo() {
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Abre el formulario de alta al llegar con `?{param}=1` y cada vez que se pide
 * con `pedirNuevo`. La marca se borra de la URL para que recargar o volver
 * atrás no lo reabra. Sin `param`, sólo escucha el evento (Egresos lee su URL
 * por su cuenta, porque el bot le pasa el formulario lleno).
 */
export function useNuevo(open: () => void, param?: string) {
  const latest = useRef(open);
  latest.current = open;

  useEffect(() => {
    if (param) {
      const url = new URL(window.location.href);
      if (url.searchParams.get(param) === "1") {
        url.searchParams.delete(param);
        window.history.replaceState(null, "", url.pathname + url.search);
        latest.current();
      }
    }
    const handler = () => latest.current();
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [param]);
}

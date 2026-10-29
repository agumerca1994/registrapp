"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface ShotData {
  src: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Una captura del paso a paso. Lleva sus dimensiones reales (next/image con
 * width/height): una imagen diferida que mide 0 mientras carga hace saltar la
 * línea de tiempo. `maxWidth` acota las capturas de un modal, que son más
 * angostas que las de una pantalla entera.
 *
 * Tocarla la abre a pantalla completa (`Lightbox`).
 */
export function Shot({ shot, maxWidth }: { shot: ShotData; maxWidth?: number }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}
        style={maxWidth ? { maxWidth } : undefined}
        className="group block w-full rounded-2xl border-2 border-ink bg-card overflow-hidden shadow-chip cursor-zoom-in transition-transform duration-300 hover:scale-[1.02] motion-reduce:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
        <Image src={shot.src} alt={shot.alt} width={shot.width} height={shot.height}
          sizes="(min-width: 768px) 640px, 92vw" className="block w-full h-auto" />
        <span className="sr-only">Ver la captura en grande</span>
      </button>
      {open && <Lightbox shot={shot} onClose={close} />}
    </>
  );
}

/**
 * La captura a pantalla completa. Mueve el foco al botón de cerrar al abrirse
 * y lo devuelve a la captura al cerrarse (lo hace `Shot`). Cierra con Escape,
 * con la X o tocando fuera de la imagen; Tab no se escapa del diálogo.
 */
export function Lightbox({ shot, onClose }: { shot: ShotData; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") { e.preventDefault(); close.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={shot.alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10 bg-ink/85 backdrop-blur-sm">
      <button ref={close} type="button" onClick={onClose} aria-label="Cerrar"
        className="absolute top-3 right-3 md:top-5 md:right-5 w-11 h-11 rounded-full border-2 border-ink bg-white text-foreground flex items-center justify-center shadow-chip">
        <X className="w-5 h-5" />
      </button>
      <Image src={shot.src} alt={shot.alt} width={shot.width} height={shot.height}
        onClick={e => e.stopPropagation()}
        sizes="100vw"
        className="max-h-full w-auto max-w-full h-auto object-contain rounded-2xl border-2 border-white/20" />
    </div>,
    document.body,
  );
}

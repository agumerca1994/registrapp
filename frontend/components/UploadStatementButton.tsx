"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSearch, Loader2, X } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * "Subir resumen": elige el PDF del banco, lo sube y lleva directo a la
 * pantalla de revisión. Uno solo para todas las entradas (Tarjetas, una
 * tarjeta, un resumen) así no derivan.
 *
 * Con `cardId` el backend ya sabe de qué tarjeta es y se saltea la pregunta.
 * `pulse` marca que hay resúmenes esperando revisión.
 *
 * Con `href` no sube nada: es un link con el mismo aspecto (lo usa /tarjetas
 * para llevar a /tarjetas/resumenes, donde están el historial y la subida —
 * abrir el selector de archivos de una dejaba el historial inalcanzable).
 * `primary` es la variante de llamado principal: botón lleno y el texto
 * visible también en el teléfono.
 */
export function UploadStatementButton({
  cardId, pulse = false, href, primary = false,
}: { cardId?: number; pulse?: boolean; href?: string; primary?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (uploading) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<{ id: number }>("/reconcile", fd, {
        params: cardId != null ? { card_id: cardId } : undefined,
      });
      router.push(`/conciliar/${res.data.id}`);
      // Sin setUploading(false): la navegación desmonta el botón, y apagar el
      // spinner antes lo deja un instante como si no hubiera pasado nada.
    } catch (e) {
      setError(getErrorMessage(e, "No se pudo leer el resumen"));
      setUploading(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // volver a elegir el mismo archivo tiene que disparar de nuevo
    if (file) upload(file);
  };

  const icon = uploading
    ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
    : <FileSearch className="w-4 h-4 shrink-0" />;
  const label = <span className={primary ? undefined : "hidden sm:inline"}>
    {uploading ? "Leyendo el PDF..." : "Subir resumen"}
  </span>;

  return (
    <div className="relative shrink-0">
      {href ? (
        <Button asChild variant={primary ? "primary" : "outline"}>
          <Link href={href} title="Subir un resumen o ver los ya subidos" aria-label="Subir resumen">
            {icon}{label}
          </Link>
        </Button>
      ) : (
        <>
          <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={onPick} />
          <Button
            variant={primary ? "primary" : "outline"}
            onClick={() => input.current?.click()}
            disabled={uploading}
            title="Subir el PDF del resumen del banco"
            aria-label="Subir resumen"
          >
            {icon}{label}
          </Button>
        </>
      )}
      {pulse && !uploading && (
        <span aria-hidden="true" className="pointer-events-none absolute -top-1 -right-1 flex w-3 h-3">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping motion-reduce:animate-none" />
          <span className="relative inline-flex w-3 h-3 rounded-full bg-amber-500 ring-2 ring-background" />
        </span>
      )}
      {/* Flotando bajo el botón y no en el flujo: vive en encabezados de una
          sola fila, y un error en el flujo los rompería. */}
      {error && (
        <div role="alert"
          className="absolute right-0 top-full mt-2 z-20 w-64 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-lg">
          <span className="flex-1 min-w-0">{error}</span>
          <button onClick={() => setError(null)} aria-label="Cerrar" className="shrink-0 p-0.5 hover:text-rose-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

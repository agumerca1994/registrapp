import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

export const metadata: Metadata = {
  title: "Instructivo · RegistrApp Negocio",
  description: "Cómo usar RegistrApp Negocio, paso a paso.",
};

/**
 * La presentación (public/negocio/instructivo.html) a pantalla completa, con
 * una barra para volver y descargarla. El archivo es autocontenido: las
 * capturas van embebidas, así que el descargado anda sin conexión.
 */
export default function InstructivoPage() {
  return (
    <div className="h-[100dvh] flex flex-col bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 h-14 flex items-center gap-3">
          <Link href="/negocio" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> RegistrApp Negocio
          </Link>
          <a href="/negocio/instructivo.html" download="RegistrApp-Negocio-Instructivo.html"
            className="ml-auto inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-4 py-1.5 text-sm font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
            <Download className="w-4 h-4" /> Descargar
          </a>
        </div>
      </header>
      <iframe src="/negocio/instructivo.html" title="Instructivo de RegistrApp Negocio"
        className="flex-1 w-full border-0" />
    </div>
  );
}

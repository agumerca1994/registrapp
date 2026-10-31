import type { Metadata } from "next";
import Link from "next/link";
import { ToodLogo } from "@/components/brand/ToodLogo";
import { ArrowRight } from "lucide-react";
import SiteFooter from "@/components/marketing/SiteFooter";
import { LEGAL, LEGAL_DOCS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Legales · tood",
  description: "Política de privacidad y términos y condiciones de tood Hogar y tood Negocio.",
};

/** Índice de los documentos legales. Pública, fuera de `(app)`, como /hogar y /negocio. */
export default function LegalIndexPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center gap-3">
          <Link href="/" aria-label="tood, ir a la home"><ToodLogo className="h-8 w-auto text-primary" /></Link>
          <span className="rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-semibold">Legales</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-8 pt-10 md:pt-14 pb-16">
        <h1 className="font-display font-bold text-3xl md:text-5xl tracking-tight">Legales</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Cómo tratamos tus datos y las reglas para usar la app. Consultas: {LEGAL.email}
        </p>
        <div className="mt-8 grid gap-4">
          {LEGAL_DOCS.map(d => (
            <Link key={d.href} href={d.href}
              className="group rounded-2xl border-2 border-ink bg-card p-5 shadow-chip flex items-center gap-4 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
              <div className="min-w-0">
                <h2 className="font-display font-bold text-xl">{d.title}</h2>
                <p className="mt-1 text-muted-foreground">{d.lead}</p>
              </div>
              <ArrowRight className="ml-auto w-5 h-5 shrink-0 text-primary group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

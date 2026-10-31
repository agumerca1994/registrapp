import type { ReactNode } from "react";
import Link from "next/link";
import { appHref } from "@/lib/site";
import { ToodLogo } from "@/components/brand/ToodLogo";
import SiteFooter from "@/components/marketing/SiteFooter";
import { LEGAL } from "@/lib/legal";

/**
 * Esqueleto de los documentos de /legal: páginas públicas, fuera de `(app)`,
 * como /hogar y /negocio. El índice lateral sale de `sections`, así el número
 * y el título de cada sección se escriben una sola vez.
 */
export function LegalPage({ title, intro, sections, children }: {
  title: string;
  intro: ReactNode;
  sections: { id: string; title: string }[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center gap-3">
          <Link href="/" aria-label="tood, ir a la home"><ToodLogo className="h-8 w-auto text-primary" /></Link>
          <Link href="/legal" className="rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-semibold">Legales</Link>
          <nav className="ml-auto">
            <Link href={appHref("/login")}
              className="inline-flex items-center rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-8 pt-10 md:pt-14 pb-16 grid lg:grid-cols-[minmax(0,1fr)_16rem] gap-10">
        <article className="min-w-0 max-w-3xl">
          <h1 className="font-display font-bold text-3xl md:text-5xl leading-tight tracking-tight text-balance">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Versión {LEGAL.version} · Última actualización: {LEGAL.updated}
          </p>
          {LEGAL.draft && (
            <p className="mt-4 rounded-xl border-2 border-dashed border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Borrador.</strong> Este texto todavía puede cambiar antes de su versión definitiva.
            </p>
          )}
          <div className="mt-6 space-y-4 text-[17px] leading-relaxed">{intro}</div>
          <div className="mt-4">{children}</div>
        </article>

        <aside className="hidden lg:block">
          <nav aria-label="Secciones" className="sticky top-24 text-sm">
            <p className="font-semibold mb-3">En esta página</p>
            <ol className="space-y-2 text-muted-foreground">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="hover:text-foreground">{i + 1}. {s.title}</a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      </main>

      <SiteFooter />
    </div>
  );
}

/** `<Section {...sec("datos")}>`: número y título salen de la lista que arma el índice. */
export function sectionsOf(sections: { id: string; title: string }[]) {
  return (id: string) => {
    const i = sections.findIndex(s => s.id === id);
    if (i < 0) throw new Error(`Sección legal desconocida: ${id}`);
    return { id, n: i + 1, title: sections[i].title };
  };
}

export function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 pt-8">
      <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight">{n}. {title}</h2>
      <div className="mt-3 space-y-3 text-[17px] leading-relaxed">{children}</div>
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc pl-6 space-y-1.5 marker:text-primary">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

export function Mail() {
  return <a href={`mailto:${LEGAL.email}`} className="font-semibold text-primary hover:underline">{LEGAL.email}</a>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { appHref } from "@/lib/site";
import SiteFooter from "@/components/marketing/SiteFooter";
import SiteHeader from "@/components/marketing/SiteHeader";
import { PriceCalculator, ProfitCalculator } from "@/components/marketing/MarginCalculator";

export const metadata: Metadata = {
  title: "Calculadora de margen y ganancia",
  description:
    "Calculá cuánto ganó tu negocio en el mes y a cuánto vender un producto para ganar el margen que querés. Gratis, sin registrarte.",
};

/**
 * Calculadora pública de margen y ganancia, para negocios chicos. Vive fuera de `(app)` (ese layout manda a
 * /login) y figura en `PUBLIC_PREFIXES` de `lib/site.ts`, así se sirve en el sitio y no en la app.
 * Todo se calcula en el navegador: no llama al backend ni guarda nada.
 */
export default function CalculadoraPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader current="calculadora" />

      <main className="max-w-6xl mx-auto px-4 md:px-8 pt-10 md:pt-14 pb-12">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Calculadora para tu negocio</p>
        <h1 className="mt-3 font-display font-bold text-4xl md:text-5xl leading-[1.05] tracking-tight text-balance">
          Margen y ganancia, en dos minutos
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          Poné tus números y mirá cuánto te quedó en el mes, o a cuánto tenés que vender para ganar lo que querés.
          No hace falta registrarte y no se guarda nada.
        </p>

        <div className="mt-10 grid lg:grid-cols-2 gap-6 items-start">
          <ProfitCalculator />
          <PriceCalculator />
        </div>

        <section className="mt-12 rounded-2xl border-2 border-ink bg-card p-6 md:p-8 shadow-chip flex flex-col md:flex-row md:items-center gap-5">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight">
              Esto lo hace tood solo
            </h2>
            <p className="mt-2 text-lg text-muted-foreground max-w-2xl">
              Cargás las ventas y los gastos del día a día y ves el resultado del mes, sin armar ninguna cuenta.
            </p>
          </div>
          <Link href={appHref("/login")}
            className="md:ml-auto self-start md:self-auto shrink-0 inline-flex items-center rounded-full border-2 border-ink bg-primary text-primary-foreground px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
            Probá tood gratis
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

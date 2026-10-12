import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  CreditCard, DollarSign, Download, Home, Play, ReceiptText, TrendingUp, Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "RegistrApp Hogar",
  description: "Ingresos, gastos, tarjetas, dólares e hipoteca de tu casa, en una sola app.",
};

/**
 * La landing pública de RegistrApp Hogar. Vive fuera del grupo `(app)`: ese
 * layout manda a /login a quien no inició sesión, y esta página es justamente
 * para quien todavía no tiene cuenta. Mismo sistema que /negocio.
 *
 * Las capturas y la presentación (public/hogar/) son de una cuenta de demo
 * armada en desarrollo, con datos inventados (tools/instructivo/hogar/).
 */

const FEATURES = [
  { icon: TrendingUp, title: "Sueldos con su detalle",
    text: "Bruto, descuentos y bonos de cada recibo. El neto se calcula solo, y ves por qué un mes cobraste distinto." },
  { icon: ReceiptText, title: "Gastos por categoría",
    text: "Cargás un gasto en segundos y ves en qué se va la plata del mes, categoría por categoría." },
  { icon: CreditCard, title: "Tarjetas y cuotas",
    text: "Cada compra en su resumen. Las cuotas se reparten solas en los meses que vienen." },
  { icon: DollarSign, title: "Pesos y dólares, por separado",
    text: "Cuántos dólares tenés y cuánto valen. Comprar dólares no cuenta como gasto: la plata cambia de bolsillo." },
  { icon: Users, title: "Gastos compartidos",
    text: "Dividís un gasto con quien quieras y la app lleva la cuenta de quién le debe a quién." },
  { icon: Home, title: "Hipoteca UVA",
    text: "La cuota en UVAs pasada a pesos, cuántas faltan, y cada cuota registrada sola como gasto." },
];

const STEPS = [
  { title: "Entrá con Google", text: "Creá tu hogar y ponele nombre." },
  { title: "Sumá a tu familia", text: "Con el código del hogar, ven y cargan lo mismo que vos." },
  { title: "Cargá ingresos y gastos", text: "El cierre del mes se arma solo." },
];

function Screen({ src, alt, hero = false, height = 800 }: { src: string; alt: string; hero?: boolean; height?: number }) {
  return (
    <div className={`rounded-2xl border-2 border-ink bg-card overflow-hidden ${hero ? "shadow-hero" : "shadow-chip"}`}>
      <div className="flex gap-1.5 px-3 py-2 border-b-2 border-ink bg-accent" aria-hidden="true">
        <span className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
        <span className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
        <span className="w-2.5 h-2.5 rounded-full bg-white border border-ink/30" />
      </div>
      <Image src={src} alt={alt} width={1280} height={height} className="w-full h-auto" priority={hero} />
    </div>
  );
}

export default function HogarPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center gap-3">
          <span className="font-display font-bold text-xl text-primary">RegistrApp</span>
          <span className="rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-semibold">Hogar</span>
          <nav className="ml-auto flex items-center gap-2">
            <a href="#instructivo" className="hidden sm:inline px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Cómo funciona
            </a>
            <Link href="/login"
              className="inline-flex items-center rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="max-w-6xl mx-auto px-4 md:px-8 pt-10 md:pt-16 pb-12 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 items-center">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">Para las cuentas de tu casa</p>
            <h1 className="mt-3 font-display font-bold text-4xl md:text-5xl leading-[1.05] tracking-tight text-balance">
              Sabé cuánta plata te queda a fin de mes.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl">
              Ingresos, gastos, tarjetas, dólares e hipoteca en una sola app. Cargás desde el celular, la compu
              o WhatsApp, y el cierre del mes se arma solo, en pesos y en dólares.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/login"
                className="inline-flex items-center rounded-full border-2 border-ink bg-primary text-primary-foreground px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                Crear mi hogar
              </Link>
              <a href="#instructivo"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                <Play className="w-4 h-4" /> Ver cómo funciona
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Entrás con tu cuenta de Google y creás tu hogar.</p>
          </div>
          <div className="min-w-0">
            <Screen src="/hogar/inicio.jpg" alt="Inicio de RegistrApp Hogar: los pesos y los dólares que quedan en el mes" hero />
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 py-12">
          <h2 className="font-display font-bold text-3xl tracking-tight">Lo que hace por tu hogar</h2>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-border bg-card p-5">
                <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold text-lg">{title}</h3>
                <p className="mt-1.5 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 py-12 grid lg:grid-cols-2 gap-8 items-center">
          <Screen src="/hogar/nuevo-gasto.jpg" height={776} alt="El formulario de un gasto nuevo, compartido en partes iguales con otra persona" />
          <div className="min-w-0">
            <h2 className="font-display font-bold text-3xl tracking-tight">Un gasto, en segundos</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Categoría, monto y listo. Si lo pagaste con tarjeta elegís la tarjeta y las cuotas; si lo compartís,
              elegís con quién y la app divide los montos.
            </p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 py-12 grid lg:grid-cols-2 gap-8 items-center">
          <div className="min-w-0 lg:order-1 order-2">
            <h2 className="font-display font-bold text-3xl tracking-tight">Tus dólares, aparte</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Cuántos dólares tiene el hogar y cuánto valen en pesos. Las compras, las ventas y lo que pagás
              en dólares, sin mezclar monedas.
            </p>
          </div>
          <div className="min-w-0 lg:order-2 order-1">
            <Screen src="/hogar/divisas.jpg" alt="La tenencia en dólares del hogar y las compras del mes" />
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 py-12 grid md:grid-cols-2 gap-8">
          <div className="min-w-0">
            <Screen src="/hogar/ingreso.jpg" height={776} alt="El detalle de un sueldo: bruto, presentismo, jubilación, obra social y neto" />
            <h3 className="mt-5 font-semibold text-xl">El recibo de sueldo, entero</h3>
            <p className="mt-1.5 text-muted-foreground">Lo que suma y lo que resta, con el neto calculado.</p>
          </div>
          <div className="min-w-0">
            <Screen src="/hogar/compartidos.jpg" alt="Los gastos compartidos con una persona y el balance entre los dos" />
            <h3 className="mt-5 font-semibold text-xl">Cuentas claras con cada persona</h3>
            <p className="mt-1.5 text-muted-foreground">Quién le debe a quién, mes por mes.</p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 py-12">
          <h2 className="font-display font-bold text-3xl tracking-tight">Cómo arrancar</h2>
          <ol className="mt-8 grid md:grid-cols-3 gap-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-border bg-card p-5 flex gap-4">
                <span className="shrink-0 w-9 h-9 rounded-full border-2 border-ink bg-primary text-primary-foreground font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg">{s.title}</h3>
                  <p className="mt-1 text-muted-foreground">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="instructivo" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-12">
          <div className="flex flex-wrap items-end gap-4 justify-between">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-3xl tracking-tight">El instructivo</h2>
              <p className="mt-2 text-lg text-muted-foreground max-w-2xl">
                Una presentación con capturas reales y los pasos de cada tarea: cargar un gasto o un sueldo,
                compartir, comprar dólares y pagar en cuotas.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/hogar/instructivo"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-primary text-primary-foreground px-4 py-2 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                <Play className="w-4 h-4" /> Ver a pantalla completa
              </Link>
              <a href="/hogar/instructivo.html" download="RegistrApp-Hogar-Instructivo.html"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-4 py-2 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                <Download className="w-4 h-4" /> Descargar
              </a>
            </div>
          </div>
          <div className="mt-6 rounded-2xl border-2 border-ink overflow-hidden shadow-hero bg-card">
            <iframe src="/hogar/instructivo.html" title="Instructivo de RegistrApp Hogar"
              className="block w-full h-[78vh] min-h-[520px] border-0" loading="lazy" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            El archivo descargado se abre en cualquier navegador, sin conexión. Los datos de las capturas son de ejemplo.
          </p>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 pt-4 pb-16">
          <div className="rounded-2xl border-2 border-ink bg-primary text-primary-foreground p-8 md:p-10 flex flex-wrap items-center gap-6 justify-between shadow-chip">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-3xl tracking-tight">Probalo con tu hogar</h2>
              <p className="mt-2 text-primary-foreground/85 text-lg">Entrás con Google y lo configurás en un minuto.</p>
            </div>
            <Link href="/login"
              className="inline-flex items-center rounded-full border-2 border-ink bg-white text-foreground px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
              Crear mi hogar
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 text-sm text-muted-foreground flex flex-wrap gap-4 justify-between">
          <span>RegistrApp</span>
          <Link href="/login" className="hover:text-foreground">Entrar a la app</Link>
        </div>
      </footer>
    </div>
  );
}

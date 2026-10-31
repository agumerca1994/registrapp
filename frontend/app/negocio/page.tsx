import type { Metadata } from "next";
import { Phone, Screen } from "@/components/marketing/Frames";
import Link from "next/link";
import { appHref } from "@/lib/site";
import {
  BarChart3, Boxes, Download, MessageCircle, Play, ReceiptText, ShoppingBag, Users,
} from "lucide-react";
import SiteFooter from "@/components/marketing/SiteFooter";
import SiteHeader from "@/components/marketing/SiteHeader";

export const metadata: Metadata = {
  title: "tood Negocio",
  description: "Cerrá la caja cada día y sabé cuánto ganó tu comercio en el mes: ventas menos gastos, por medio de pago, con el stock al día.",
};

/**
 * La landing pública de tood Negocio. Vive fuera del grupo `(app)`:
 * ese layout manda a /login a quien no inició sesión, y esta página es
 * justamente para quien todavía no tiene cuenta.
 *
 * Las capturas y la presentación (public/negocio/) son de una cuenta de demo
 * armada en desarrollo, con datos inventados.
 */

const FEATURES = [
  { icon: ShoppingBag, title: "Ventas y cierre de caja",
    text: "Cargás cada venta con un toque o cerrás el día con lo que hay en la caja. Si falta plata, te lo marca." },
  { icon: Boxes, title: "Stock que se mueve solo",
    text: "Las ventas descuentan, las compras y la producción suman. Te avisa lo que queda poco o en negativo." },
  { icon: ReceiptText, title: "Egresos y proveedores",
    text: "Alquiler, sueldos, mercadería y servicios, con a quién se le pagó. Las compras con tarjeta, en su resumen." },
  { icon: BarChart3, title: "El resultado del mes",
    text: "Ventas menos egresos, contados por la fecha en que sale la plata. Por medio de pago y por producto." },
  { icon: Users, title: "Tu equipo, con permisos",
    text: "Los empleados cargan ventas, el cierre y el stock. Los números del negocio los ven el dueño y los socios." },
  { icon: MessageCircle, title: "Por WhatsApp",
    text: "«vendí 3 empanadas 4500 efectivo» o «cierre 200 lucas efectivo». Lo carga y te confirma qué entendió." },
];

const STEPS = [
  { title: "Entrá con Google", text: "Elegí «Mi negocio» y ponele nombre." },
  { title: "Cargá tus productos", text: "Con su precio, y si querés, con stock." },
  { title: "Vendé y cerrá el día", text: "El resultado del mes se arma solo." },
];


export default function NegocioPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader current="negocio" />

      <main>
        <section className="max-w-6xl mx-auto px-4 md:px-8 pt-10 md:pt-16 pb-12 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 items-center">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">tood Negocio</p>
            <h1 className="mt-3 font-display font-bold text-4xl md:text-5xl leading-[1.05] tracking-tight text-balance">
              Cerrá la caja y sabé cuánto ganaste en el mes
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl">
              Para un kiosco, una rotisería o un local chico. Anotás cada venta o sólo el total del día, el stock
              baja con lo que vendés y a fin de mes ves lo vendido menos lo gastado, por medio de pago.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={appHref("/login")}
                className="inline-flex items-center rounded-full border-2 border-ink bg-primary text-primary-foreground px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                Crear mi negocio
              </Link>
              <a href="#instructivo"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                <Play className="w-4 h-4" /> Ver cómo funciona
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Es gratis. Tus empleados cargan ventas sin ver los números del negocio.</p>
          </div>
          <div className="min-w-0">
            <div className="hidden sm:block"><Screen src="/negocio/inicio.jpg" alt="Inicio de tood Negocio: el resultado del mes y las ventas por medio de pago" hero /></div>
            <Phone src="/home/celular-negocio.jpg" alt="tood Negocio en el celular" className="sm:hidden mx-auto w-[68%] max-w-[260px]" />
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 py-12">
          <h2 className="font-display font-bold text-3xl tracking-tight">Lo que hace por tu negocio</h2>
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
          <Screen src="/negocio/nueva-venta.jpg" alt="El formulario de nueva venta con productos y medio de pago" />
          <div className="min-w-0">
            <h2 className="font-display font-bold text-3xl tracking-tight">La venta, mientras cobrás</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Tocás los productos, elegís cómo te pagaron y listo. El total sale de los precios y el stock se descuenta solo.
              Al final del día, contás la caja y la app te dice si coincide.
            </p>
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
                Una presentación con capturas reales y los pasos de cada tarea: cargar una venta, cerrar el día,
                productos, stock, egresos y equipo.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/negocio/instructivo"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-primary text-primary-foreground px-4 py-2 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                <Play className="w-4 h-4" /> Ver a pantalla completa
              </Link>
              <a href="/negocio/instructivo.html" download="tood-Negocio-Instructivo.html"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-4 py-2 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
                <Download className="w-4 h-4" /> Descargar
              </a>
            </div>
          </div>
          <div className="mt-6 rounded-2xl border-2 border-ink overflow-hidden shadow-hero bg-card">
            <iframe src="/negocio/instructivo.html" title="Instructivo de tood Negocio"
              className="block w-full h-[78vh] min-h-[520px] border-0" loading="lazy" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            El archivo descargado se abre en cualquier navegador, sin conexión. Los datos de las capturas son de ejemplo.
          </p>
        </section>

        <section className="max-w-6xl mx-auto px-4 md:px-8 pt-4 pb-16">
          <div className="rounded-2xl border-2 border-ink bg-primary text-primary-foreground p-8 md:p-10 flex flex-wrap items-center gap-6 justify-between shadow-chip">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-3xl tracking-tight">Probalo con tu negocio</h2>
              <p className="mt-2 text-primary-foreground/85 text-lg">Entrás con Google, le ponés nombre a tu negocio y cargás tus productos.</p>
            </div>
            <Link href={appHref("/login")}
              className="inline-flex items-center rounded-full border-2 border-ink bg-white text-foreground px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
              Crear mi negocio
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

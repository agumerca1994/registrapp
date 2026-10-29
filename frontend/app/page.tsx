import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Bot, Check, Home as HomeIcon, Laptop, MessageCircle, ShieldCheck, Smartphone, Store,
} from "lucide-react";
import HomeRedirect from "@/components/marketing/HomeRedirect";
import { Phone, Screen } from "@/components/marketing/Frames";
import SiteFooter from "@/components/marketing/SiteFooter";

export const metadata: Metadata = {
  title: "RegistrApp · Las cuentas claras, en casa y en tu negocio",
  description:
    "Ingresos, gastos, tarjetas, dólares y ventas en una sola app. Desde la compu, el celular, WhatsApp o tu asistente de IA.",
};

/**
 * La home pública. Fuera de `(app)`: ese layout manda a /login a quien no
 * inició sesión. Quien ya tiene sesión pasa a la app (HomeRedirect).
 *
 * Todo lo que se afirma acá existe en la app; las capturas son de cuentas de
 * demo con datos inventados (tools/instructivo/). El conector de IA se explica
 * por lo que hace, no por cómo se llama el protocolo.
 */

const PILL = "inline-flex items-center gap-2 rounded-full border-2 border-ink px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none";

const VARIANTS = [
  {
    href: "/hogar", icon: HomeIcon, name: "RegistrApp Hogar", image: "/hogar/inicio.jpg", phone: "/home/celular-hogar.jpg",
    lead: "Para las cuentas de tu casa: cuánta plata te queda a fin de mes, en pesos y en dólares.",
    items: ["Sueldos con su detalle", "Tarjetas y cuotas", "Dólares y tenencia", "Hipoteca UVA", "Gastos compartidos"],
  },
  {
    href: "/negocio", icon: Store, name: "RegistrApp Negocio", image: "/negocio/inicio.jpg", phone: "/home/celular-negocio.jpg",
    lead: "Para comercios chicos: ventas, cierre de caja, stock y el resultado del mes.",
    items: ["Ventas y cierre de caja", "Stock que se mueve solo", "Proveedores y empleados", "Equipo con permisos", "Resultado del mes"],
  },
];

const PLATFORMS = [
  { icon: Laptop, title: "En la compu",
    text: "Todo a la vista en pantalla grande: el mes completo, las tarjetas y los resúmenes." },
  { icon: Smartphone, title: "En el celular",
    text: "Se instala como una app desde el navegador, en iPhone y en Android. Cargás el gasto o la venta en el momento." },
  { icon: MessageCircle, title: "Por WhatsApp",
    text: "Escribís «12 lucas verdulería» y queda cargado. Le mandás el PDF del resumen de la tarjeta y lo compara con lo tuyo." },
  { icon: Bot, title: "Con tu asistente de IA",
    text: "Conectás Claude a tu cuenta y le preguntás por tu plata con tus números reales." },
];

const AI_POINTS = [
  "Te contesta con los números que cargaste en RegistrApp.",
  "Puede cargar o corregir por vos: un recibo de sueldo, un gasto, una compra en cuotas.",
  "Antes de guardar cualquier cosa te muestra qué va a hacer, y sólo sigue si confirmás.",
  "Se conecta desde Configuración y lo desconectás cuando quieras.",
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HomeRedirect />

      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center gap-2">
          <span className="font-display font-bold text-xl text-primary">RegistrApp</span>
          <nav className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link href="/hogar" className="hidden sm:inline px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Hogar</Link>
            <Link href="/negocio" className="hidden sm:inline px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Negocio</Link>
            <a href="#ia" className="hidden md:inline px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Con IA</a>
            <Link href="/login" className="inline-flex items-center rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Portada */}
        <section className="max-w-6xl mx-auto px-4 md:px-8 pt-10 md:pt-16 pb-14 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 items-center">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">Finanzas claras, sin planillas</p>
            <h1 className="mt-3 font-display font-bold text-4xl md:text-6xl leading-[1.02] tracking-tight text-balance">
              Las cuentas claras, en casa y en tu negocio.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-xl">
              RegistrApp ordena tus ingresos, gastos, tarjetas, dólares y ventas. Lo usás desde la compu, el celular,
              WhatsApp o tu asistente de IA, y a fin de mes ves cómo te fue.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/login" className={`${PILL} bg-primary text-primary-foreground`}>Crear mi cuenta</Link>
              <a href="#versiones" className={`${PILL} bg-white`}>Ver las versiones</a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Entrás con tu cuenta de Google y elegís si es para tu hogar o tu negocio.</p>
          </div>
          {/* En un celular, la captura de escritorio queda en letra ilegible: ahí va la del celular. */}
          <Phone src="/home/celular-hogar.jpg" alt="RegistrApp en el celular: el cierre del mes en pesos y en dólares"
            className="sm:hidden mx-auto w-[68%] max-w-[260px]" />
          <div className="relative min-w-0 pb-6 lg:pb-0 hidden sm:block">
            <Screen src="/hogar/inicio.jpg" alt="RegistrApp en la compu: el cierre del mes en pesos y en dólares" hero />
            <Phone src="/home/celular-hogar.jpg" alt="RegistrApp en el celular"
              className="absolute -bottom-4 -right-2 w-[24%] max-w-[150px]" />
          </div>
        </section>

        {/* Versiones */}
        <section id="versiones" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
          <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">Una app, dos versiones</h2>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl">
            Elegís una cuando creás tu cuenta. Cada una muestra sólo lo que necesitás.
          </p>
          <div className="mt-8 grid lg:grid-cols-2 gap-6">
            {VARIANTS.map(({ href, icon: Icon, name, image, phone, lead, items }) => (
              <article key={href} className="rounded-2xl border-2 border-ink bg-card p-4 md:p-6 flex flex-col gap-5 shadow-chip">
                <div className="flex items-center gap-2">
                  <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
                  <h3 className="font-display font-bold text-2xl">{name}</h3>
                </div>
                <p className="text-muted-foreground text-lg">{lead}</p>
                <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
                  {items.map(i => (
                    <li key={i} className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" /> {i}
                    </li>
                  ))}
                </ul>
                <div className="hidden sm:block"><Screen src={image} alt={`Inicio de ${name}`} /></div>
                <Phone src={phone} alt={`${name} en el celular`} className="sm:hidden mx-auto w-[62%] max-w-[230px]" />
                <Link href={href} className="mt-auto inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                  Ver {name} <ArrowRight className="w-4 h-4" />
                </Link>
              </article>
            ))}
          </div>
        </section>

        {/* Multiplataforma */}
        <section className="max-w-6xl mx-auto px-4 md:px-8 py-14 grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-10 items-center">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">Donde estés, como te quede cómodo</h2>
            <p className="mt-3 text-lg text-muted-foreground max-w-2xl">
              Es la misma cuenta en todos lados: lo que cargás en el celular lo ves en la compu.
            </p>
            <div className="mt-8 grid sm:grid-cols-2 gap-4">
              {PLATFORMS.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-border bg-card p-5">
                  <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold text-lg">{title}</h3>
                  <p className="mt-1.5 text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
          {/* En un celular esos dos ya se vieron en las versiones, justo arriba. */}
          <div className="min-w-0 hidden sm:flex justify-center items-start gap-4">
            <Phone src="/home/celular-hogar.jpg" alt="RegistrApp Hogar en el celular" className="w-1/2 max-w-[230px]" />
            <Phone src="/home/celular-negocio.jpg" alt="RegistrApp Negocio en el celular" className="w-1/2 max-w-[230px] mt-10" />
          </div>
        </section>

        {/* IA */}
        <section id="ia" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
          <div className="rounded-3xl border-2 border-ink bg-card p-5 md:p-10 shadow-hero grid lg:grid-cols-2 gap-8 md:gap-10 items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wider text-primary">Conectado a Claude</p>
              <h2 className="mt-2 font-display font-bold text-3xl md:text-4xl tracking-tight text-balance">
                Hablá de tu plata con tu asistente de IA
              </h2>
              <p className="mt-3 text-lg text-muted-foreground">
                Conectá RegistrApp a Claude y preguntale como le preguntarías a alguien que tiene todos tus números a mano.
              </p>
              <ul className="mt-6 space-y-3">
                {AI_POINTS.map(p => (
                  <li key={p} className="flex gap-3">
                    <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-muted-foreground">
                Funciona con Claude en la web, en la app de escritorio y en Claude Code.
              </p>
              <Link href="/conectar" className="mt-4 inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                Cómo conectarlo <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="min-w-0 rounded-2xl bg-background border border-border p-3 md:p-5 space-y-3 text-[15px] md:text-base" aria-label="Ejemplo de conversación">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ejemplo de conversación</p>
              <p className="ml-auto max-w-[85%] w-fit rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5">
                ¿En qué gasté más este mes comparado con septiembre?
              </p>
              <p className="max-w-[90%] w-fit rounded-2xl rounded-bl-md bg-card border border-border px-4 py-2.5">
                Supermercado subió de $&nbsp;92.000 a $&nbsp;105.200, pero descontando la inflación es casi lo mismo.
                Lo que más creció fue Restaurantes: de $&nbsp;41.000 a $&nbsp;82.000.
              </p>
              <p className="ml-auto max-w-[85%] w-fit rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5">
                Cargame este recibo de sueldo.
              </p>
              <p className="max-w-[90%] w-fit rounded-2xl rounded-bl-md bg-card border border-border px-4 py-2.5">
                Encontré octubre: neto $&nbsp;1.890.000, con bruto, jubilación, obra social y Ganancias. ¿Lo guardo?
              </p>
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="max-w-6xl mx-auto px-4 md:px-8 pt-4 pb-16">
          <div className="rounded-2xl border-2 border-ink bg-primary text-primary-foreground p-6 md:p-10 flex flex-wrap items-center gap-6 justify-between shadow-chip">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-3xl tracking-tight">Probala con tu cuenta de Google</h2>
              <p className="mt-2 text-primary-foreground/85 text-lg">Elegís si es para tu hogar o tu negocio, le ponés nombre y empezás a cargar.</p>
            </div>
            <Link href="/login" className={`${PILL} bg-white text-foreground`}>Crear mi cuenta</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

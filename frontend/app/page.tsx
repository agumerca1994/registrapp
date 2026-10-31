import type { Metadata } from "next";
import Link from "next/link";
import { appHref } from "@/lib/site";
import { ToodConLema } from "@/components/brand/ToodLogoAnimado";
import {
  ArrowRight, Bot, Check, Home as HomeIcon, Laptop, MessageCircle, ShieldCheck, Smartphone, Store,
} from "lucide-react";
import HomeRedirect from "@/components/marketing/HomeRedirect";
import { Phone, Screen } from "@/components/marketing/Frames";
import SiteFooter from "@/components/marketing/SiteFooter";
import SiteHeader from "@/components/marketing/SiteHeader";

export const metadata: Metadata = {
  title: "tood · Las cuentas de tu casa o de tu negocio, en una sola app",
  description:
    "Anotás lo que entra y lo que sale (sueldos, gastos, tarjetas, dólares o ventas) y ves cuánto te queda a fin de mes. Desde la compu, el celular o WhatsApp. Gratis.",
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
    href: "/hogar", icon: HomeIcon, name: "tood Hogar", image: "/hogar/inicio.jpg", phone: "/home/celular-hogar.jpg",
    lead: "Para las cuentas de tu casa. Ves cuánto te queda a fin de mes, en pesos y en dólares, y qué cuotas vienen.",
    items: ["Sueldos con su detalle", "Tarjetas y cuotas", "Ahorro en dólares", "Hipoteca UVA", "Gastos compartidos con otros"],
  },
  {
    href: "/negocio", icon: Store, name: "tood Negocio", image: "/negocio/inicio.jpg", phone: "/home/celular-negocio.jpg",
    lead: "Para un comercio chico. Cargás las ventas o el cierre de caja del día y ves el resultado del mes: lo que vendiste menos lo que gastaste.",
    items: ["Ventas y cierre de caja", "Stock que baja con cada venta", "Proveedores y empleados", "Empleados con acceso limitado", "Resultado del mes"],
  },
];

const STEPS = [
  { title: "Cargás lo que entra y lo que sale",
    text: "A mano, con un mensaje de WhatsApp o subiendo el PDF del resumen de la tarjeta." },
  { title: "tood lo ordena",
    text: "Lo separa por categoría, reparte las cuotas en los meses que vienen y lleva los pesos y los dólares por separado." },
  { title: "Ves cómo cerrás el mes",
    text: "Cuánto entró, cuánto salió, cuánto te queda y qué vas a tener que pagar." },
];

const PLATFORMS = [
  { icon: Laptop, title: "En la compu",
    text: "Para mirar el mes completo, las tarjetas y los resúmenes en pantalla grande." },
  { icon: Smartphone, title: "En el celular",
    text: "Se instala desde el navegador, en iPhone y en Android, sin pasar por la tienda. Sirve para anotar el gasto o la venta en el momento." },
  { icon: MessageCircle, title: "Por WhatsApp",
    text: "Escribís «12 lucas verdulería» y queda cargado. Si mandás el PDF del resumen de la tarjeta, lo compara con lo que ya cargaste." },
  { icon: Bot, title: "Con Claude",
    text: "Si usás Claude, lo conectás a tu cuenta y le preguntás por tu plata. Más abajo te contamos cómo." },
];

const AI_POINTS = [
  "Contesta con lo que cargaste en tood.",
  "Carga o corrige lo que le pidas: un recibo de sueldo, un gasto, una compra en cuotas.",
  "Antes de guardar cualquier cosa te muestra qué va a hacer, y sólo sigue si confirmás.",
  "Se conecta desde Configuración y lo desconectás cuando quieras.",
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HomeRedirect />

      <SiteHeader current="home" />

      <main>
        {/* Portada */}
        <section className="max-w-6xl mx-auto px-4 md:px-8 pt-10 md:pt-16 pb-14 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 items-center">
          <div className="min-w-0">
            <ToodConLema className="mb-8" />
            <h1 className="font-display font-bold text-4xl md:text-6xl leading-[1.02] tracking-tight text-balance">
              Llevá las cuentas de tu casa o de tu negocio, sin planillas.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-xl">
              tood es una app para anotar lo que entra y lo que sale: sueldos, gastos, compras con tarjeta, dólares
              o ventas. Con eso te muestra cuánto te queda a fin de mes y qué pagos se vienen.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={appHref("/login")} className={`${PILL} bg-primary text-primary-foreground`}>Crear mi cuenta</Link>
              <a href="#como-funciona" className={`${PILL} bg-white`}>Cómo funciona</a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Es gratis. Entrás con tu cuenta de Google y elegís si es para tu casa o tu negocio.</p>
          </div>
          {/* En un celular, la captura de escritorio queda en letra ilegible: ahí va la del celular. */}
          <Phone src="/home/celular-hogar.jpg" alt="tood en el celular: el cierre del mes en pesos y en dólares"
            className="sm:hidden mx-auto w-[68%] max-w-[260px]" />
          <div className="relative min-w-0 pb-6 lg:pb-0 hidden sm:block">
            <Screen src="/hogar/inicio.jpg" alt="tood en la compu: el cierre del mes en pesos y en dólares" hero />
            <Phone src="/home/celular-hogar.jpg" alt="tood en el celular"
              className="absolute -bottom-4 -right-2 w-[24%] max-w-[150px]" />
          </div>
        </section>

        {/* Cómo funciona: es un proceso real, por eso va numerado */}
        <section id="como-funciona" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
          <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">Cómo funciona</h2>
          <ol className="mt-8 grid md:grid-cols-3 gap-4">
            {STEPS.map(({ title, text }, i) => (
              <li key={title} className="rounded-2xl border border-border bg-card p-5">
                <span className="inline-flex w-8 h-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-display font-bold">
                  {i + 1}
                </span>
                <h3 className="mt-3 font-semibold text-lg">{title}</h3>
                <p className="mt-1.5 text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Versiones */}
        <section id="versiones" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
          <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">Para tu casa o para tu negocio</h2>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl">
            Elegís una de las dos versiones al crear la cuenta. Cada una muestra sólo lo que le sirve a esa cuenta.
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
            <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">Desde la compu, el celular o WhatsApp</h2>
            <p className="mt-3 text-lg text-muted-foreground max-w-2xl">
              Es la misma cuenta en todos lados: lo que anotás en el celular lo ves en la compu.
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
            <Phone src="/home/celular-hogar.jpg" alt="tood Hogar en el celular" className="w-1/2 max-w-[230px]" />
            <Phone src="/home/celular-negocio.jpg" alt="tood Negocio en el celular" className="w-1/2 max-w-[230px] mt-10" />
          </div>
        </section>

        {/* IA */}
        <section id="ia" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
          <div className="rounded-3xl border-2 border-ink bg-card p-5 md:p-10 shadow-hero grid lg:grid-cols-2 gap-8 md:gap-10 items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wider text-primary">Con IA</p>
              <h2 className="mt-2 font-display font-bold text-3xl md:text-4xl tracking-tight text-balance">
                Preguntale a Claude por tu plata
              </h2>
              <p className="mt-3 text-lg text-muted-foreground">
                Si usás Claude, lo podés conectar a tu cuenta de tood. Te contesta con tus números y también puede
                cargar cosas por vos.
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
              <h2 className="font-display font-bold text-3xl tracking-tight">Empezá con tu cuenta de Google</h2>
              <p className="mt-2 text-primary-foreground/85 text-lg">Es gratis. Elegís si es para tu casa o tu negocio, le ponés nombre y empezás a cargar.</p>
            </div>
            <Link href={appHref("/login")} className={`${PILL} bg-white text-foreground`}>Crear mi cuenta</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { appHref } from "@/lib/site";
import { ArrowDown, Brain, MessageSquareText, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { AssistantTabs } from "@/components/marketing/connect/AssistantTabs";
import { ASSISTANTS } from "@/components/marketing/connect/assistants";
import { KindProvider, KindToggle } from "@/components/marketing/connect/kind";
import { QuestionBlocks } from "@/components/marketing/connect/KindBlocks";
import { Reveal } from "@/components/marketing/connect/Reveal";
import AvatarConIA from "@/components/marketing/connect/AvatarConIA";
import { Step, StepTimeline } from "@/components/marketing/connect/StepTimeline";
import SiteFooter from "@/components/marketing/SiteFooter";
import SiteHeader from "@/components/marketing/SiteHeader";

export const metadata: Metadata = {
  title: "Conectá tood a tu asistente de IA",
  description:
    "Preguntale a tu asistente de IA por tus gastos, tus cuotas o tus ventas y que te conteste con tus números. Qué es, qué podés hacer y el paso a paso para conectarlo.",
};

/**
 * Cómo conectar tood a un asistente de IA. Pública y fuera de `(app)`:
 * ese layout manda a /login, y esto lo lee también quien todavía no tiene
 * cuenta. No redirige a quien ya inició sesión: es justo quien la necesita.
 *
 * El modelo es la página del conector de IOL (anatomía y mecánica, no su
 * marca); el agente `connector-landing` tiene el porqué de cada decisión.
 * Todo lo que se afirma acá está en el código: el conector (`/mcp`), la página
 * de autorizar y Configuración → Conectar con una IA.
 */

const PILL = "inline-flex items-center gap-2 rounded-full border-2 border-ink px-5 py-3 font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none";

const BENEFITS = [
  { icon: Brain, title: "Con tus números",
    text: "Contesta con los ingresos, gastos, tarjetas y cuotas que cargaste en tood." },
  { icon: MessageSquareText, title: "Como hablás",
    text: "«¿Me alcanza para la tele?», «anotá 12 lucas de verdulería». Le escribís como a una persona." },
  { icon: ShieldCheck, title: "Tu contraseña queda afuera",
    text: "Iniciás sesión con Google en la página de tood. La IA recibe un permiso, nunca tu contraseña." },
  { icon: SlidersHorizontal, title: "Vos decidís",
    text: "Antes de guardar algo te muestra una vista previa. Y lo desconectás cuando quieras." },
];

const FAQ = [
  { q: "¿Puede modificar mis datos?", a: <>
    <p>
      Sí, si se lo pedís. En un hogar puede cargar, editar y borrar gastos, ingresos, tarjetas y gastos compartidos; en un negocio,
      ventas, el cierre del día, stock, productos, gastos y tarjetas. Lo demás es sólo lectura.
    </p>
    <p>
      Cada cambio arranca como una vista previa que no guarda nada: el asistente te la muestra y sólo la guarda si confirmás.
      En Claude, además, elegís herramienta por herramienta si la usa sola, si te pregunta antes o si queda bloqueada.
    </p>
  </> },
  { q: "¿Mis credenciales pasan por la IA?", a: <>
    <p>
      No. Iniciás sesión con Google en la página de tood, no en el asistente. El asistente recibe un permiso de acceso a tu
      cuenta que podés cortar cuando quieras. Si tu asistente pide un token, lo creás vos en tood y lo borrás cuando quieras.
    </p>
  </> },
  { q: "¿Cómo lo desconecto?", a: <>
    <p>
      Desde tood: Configuración → Conectar con una IA → Apps conectadas, el tacho al lado de la app y Confirmar. Corta el acceso
      en el acto. Un token se borra igual, desde la lista de tokens de esa misma sección. También lo podés quitar desde el
      asistente; en Claude: Configuración → Conectores → tood → Desconectar.
    </p>
  </> },
  { q: "¿Funciona en un negocio? ¿Y para un empleado?", a: <>
    <p>
      En un negocio sí: el paso a paso es el mismo y le preguntás por ventas, stock y gastos. Un empleado no puede conectarlo:
      la sección no le aparece, y si alguien pasa a ser empleado, sus conexiones dejan de funcionar.
    </p>
  </> },
  { q: "El asistente dice que no encuentra la herramienta", a: <>
    <p>
      Fijate que tood esté prendido en esa conversación (en Claude, el <strong>+</strong> del cuadro de mensaje → Conectores).
      Si lo está, desconectalo y volvé a conectarlo: el asistente vuelve a leer la lista de herramientas.
    </p>
  </> },
];

export default function ConectarPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader current="conectar" />

      <KindProvider>
        <main>
          {/* Portada: dos manchas muy tenues de la marca y un solo botón. */}
          <section className="relative">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-32 -left-24 w-[34rem] h-[34rem] rounded-full bg-[radial-gradient(closest-side,hsl(var(--primary)/0.14),transparent)]" />
              <div className="absolute top-16 right-[-12rem] w-[28rem] h-[28rem] rounded-full bg-[radial-gradient(closest-side,rgba(16,185,129,0.10),transparent)]" />
            </div>
            <div className="relative max-w-6xl mx-auto px-4 md:px-8 pt-14 md:pt-24 pb-16 md:pb-24 text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-primary">tood con inteligencia artificial</p>
              <h1 className="mt-3 font-display font-bold text-[2.1rem] sm:text-5xl md:text-6xl leading-[1.08] tracking-tight text-balance max-w-4xl mx-auto">
                Conectá tood a tu <span className="text-primary">asistente de IA</span> y preguntale por tu plata
              </h1>
              <p className="mt-5 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto text-pretty">
                Te contesta con tus gastos, tus cuotas o tus ventas, y carga lo que le pidas después de mostrártelo.
              </p>
              <AvatarConIA className="mt-8 w-full max-w-xl mx-auto h-auto" />
              <div className="mt-6 flex justify-center">
                <a href="#tutorial" className={`${PILL} bg-primary text-primary-foreground`}>
                  Ver el paso a paso <ArrowDown className="w-4 h-4" aria-hidden="true" />
                </a>
              </div>
            </div>
          </section>

          {/* Qué es */}
          <section id="que-es" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
            <Reveal>
              <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">¿Qué es y para qué sirve?</h2>
              <p className="mt-4 text-lg text-muted-foreground max-w-3xl">
                Es un puente entre tu cuenta de tood y el asistente de IA que ya usás. Una vez conectado, cuando le preguntás
                algo de tu plata, el asistente mira tus números en tood para contestarte, y si le pedís que cargue algo, te muestra
                qué va a guardar antes de hacerlo.
              </p>
            </Reveal>
            <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {BENEFITS.map(({ icon: Icon, title, text }) => (
                <Reveal key={title}>
                  <div className="h-full rounded-2xl border border-border bg-card p-5 transition-transform duration-300 hover:-translate-y-1 motion-reduce:hover:translate-y-0">
                    <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
                    <h3 className="mt-3 font-semibold text-lg">{title}</h3>
                    <p className="mt-1.5 text-muted-foreground">{text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* Qué podés hacer */}
          <section id="preguntas" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
            <Reveal className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">¿Qué le podés preguntar?</h2>
                <p className="mt-3 text-lg text-muted-foreground max-w-2xl">
                  Lo mismo que ves en la app, pero preguntado. Elegí tu tipo de cuenta:
                </p>
              </div>
              <KindToggle />
            </Reveal>
            <div className="mt-8">
              <QuestionBlocks />
            </div>
          </section>

          {/* Paso a paso */}
          <section id="tutorial" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
            <Reveal>
              <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">Conectalo paso a paso</h2>
              <p className="mt-3 text-lg text-muted-foreground max-w-2xl">
                Son unos minutos y se hace una sola vez. Hoy tenemos el paso a paso de Claude; otros asistentes que aceptan
                conectores personalizados usan la misma dirección. Elegí cuál usás:
              </p>
            </Reveal>
            <div className="mt-6">
              <AssistantTabs label="Asistente" tabs={ASSISTANTS.map(a => ({
                id: a.id,
                label: a.label,
                content: (
                  <>
                    <p className="mb-8 max-w-[720px] text-muted-foreground md:text-lg">{a.intro}</p>
                    <StepTimeline label={`Pasos para conectar ${a.label}`}>
                      {a.steps.map((s, i) => <Step key={s.title} n={i + 1} title={s.title}>{s.body}</Step>)}
                    </StepTimeline>
                  </>
                ),
              }))} />
            </div>
          </section>

          {/* Preguntas frecuentes */}
          <section id="preguntas-frecuentes" className="scroll-mt-20 max-w-6xl mx-auto px-4 md:px-8 py-14">
            <Reveal>
              <h2 className="font-display font-bold text-3xl md:text-4xl tracking-tight">Preguntas frecuentes</h2>
            </Reveal>
            <div className="mt-6 max-w-3xl divide-y-2 divide-ink/10 border-y-2 border-ink/10">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group">
                  <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none [&::-webkit-details-marker]:hidden font-semibold text-lg">
                    {q}
                    <span className="shrink-0 w-8 h-8 rounded-full border-2 border-ink flex items-center justify-center transition-transform duration-300 group-open:rotate-45 motion-reduce:transition-none">
                      <Plus className="w-4 h-4" aria-hidden="true" />
                    </span>
                  </summary>
                  <div className="pb-5 -mt-1 space-y-3 text-muted-foreground">{a}</div>
                </details>
              ))}
            </div>
          </section>

          {/* Cierre */}
          <section className="max-w-6xl mx-auto px-4 md:px-8 pt-4 pb-16">
            <div className="rounded-2xl border-2 border-ink bg-primary text-primary-foreground p-6 md:p-10 flex flex-wrap items-center gap-6 justify-between shadow-chip">
              <div className="min-w-0">
                <h2 className="font-display font-bold text-3xl tracking-tight">¿Todavía no usás tood?</h2>
                <p className="mt-2 text-primary-foreground/85 text-lg">Entrás con Google, elegís hogar o negocio, y después lo conectás.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href={appHref("/login")} className={`${PILL} bg-white text-foreground`}>Crear mi cuenta</Link>
                <a href="#tutorial" className={`${PILL} bg-primary text-primary-foreground border-white/80`}>Ver el paso a paso</a>
              </div>
            </div>
          </section>
        </main>
      </KindProvider>

      <SiteFooter />
    </div>
  );
}

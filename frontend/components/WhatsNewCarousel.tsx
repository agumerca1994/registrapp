"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Check, CheckCircle2, Copy, Coins, FileText, MessageCircle,
  Receipt, ShieldCheck, Sparkles,
} from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { usePendingShared } from "@/contexts/PendingSharedContext";
import { useTourRunning } from "@/components/ProductTour";
import { features } from "@/lib/features";
import { cn } from "@/lib/utils";

/**
 * "Novedades": el carrusel que anuncia "Subir resumen" y el bot de WhatsApp.
 *
 * Aparece una sola vez por usuario y dispositivo. La clave vive en
 * localStorage como las de las guías, y "Reiniciar guía" en Configuración la
 * borra junto con ellas. Si el storage tira (modo privado, sitio bloqueado),
 * se muestra a lo sumo una vez por sesión con el flag de módulo de abajo: una
 * novedad que reaparece en cada pantalla es peor que una que no aparece.
 *
 * Los montos de las ilustraciones son strings fijos a propósito, no pasan por
 * `formatARS`: son un dibujo, no datos del usuario, y "Ocultar montos" no
 * tiene nada que esconder ahí — enmascararlos dejaría la ilustración sin
 * sentido.
 */
export const WHATS_NEW_KEY = "whats_new_seen_subir_resumen_v1";

let seenThisSession = false;

function hasSeen(): boolean {
  if (seenThisSession) return true;
  try {
    return !!localStorage.getItem(WHATS_NEW_KEY);
  } catch {
    return false;
  }
}

function markSeen() {
  seenThisSession = true;
  try {
    localStorage.setItem(WHATS_NEW_KEY, "1");
  } catch {
    // El flag de módulo ya cubre esta sesión.
  }
}

const BRAND_FIELD =
  "radial-gradient(120% 80% at 15% -10%, #7B6DF5 0%, rgba(123,109,245,0) 60%)," +
  "radial-gradient(90% 60% at 110% 105%, #3F34A8 0%, rgba(63,52,168,0) 55%)," +
  "linear-gradient(165deg, #5B4FE9 0%, #4A3FC4 55%, #3D338F 100%)";

// Los "stickers" de las ilustraciones: blancos con borde de tinta y sombra
// dura. El color del texto se fija en tinta porque son dibujos, no superficies
// del tema — en modo oscuro un sticker blanco con texto claro no se lee.
const STICKER = "bg-white text-ink border-2 border-ink shadow-[4px_4px_0_0_#1E1A2E]";
const DOTS_BG = {
  backgroundImage: "radial-gradient(rgba(30,26,46,0.12) 1.2px, transparent 1.2px)",
  backgroundSize: "14px 14px",
};

const SLIDES = 4;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function WhatsNewCarousel() {
  const { appUser } = useAuth();
  const { count, loaded, dialogDismissed } = usePendingShared();
  // Misma compuerta que PendingSharedDialog: se pregunta si hay una guía
  // CORRIENDO, no si quedó alguna sin ver (las `requireDesktop` nunca se
  // marcan como vistas en un teléfono).
  const tourRunning = useTourRunning();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  // El aviso de gastos compartidos va primero: es una decisión pendiente del
  // usuario, esto es una novedad. Se espera a que los pendientes hayan cargado
  // — antes de eso la cuenta es 0 y el carrusel ganaría la carrera — y cede
  // si el diálogo está a la vista (hay pendientes y no lo cerró).
  const sharedDialogVisible = count > 0 && !dialogDismissed;
  const blocked = !loaded || tourRunning || sharedDialogVisible;

  useEffect(() => {
    if (!features.reconcile || open || blocked || hasSeen()) return;
    // Un respiro para que una guía que arranca con la pantalla se publique
    // antes; si no, el carrusel abre y se esconde un instante después.
    const t = window.setTimeout(() => { if (!hasSeen()) setOpen(true); }, 600);
    return () => window.clearTimeout(t);
  }, [open, blocked]);

  // Si mientras está abierto arranca una guía o llega un pendiente, se aparta
  // (sin marcarse como visto) y vuelve después: dos overlays encimados no se
  // pueden usar.
  const visible = open && !blocked;

  useEffect(() => {
    if (!visible) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { restoreFocus.current?.focus?.(); };
  }, [visible]);

  const close = useCallback((to?: string) => {
    markSeen();
    setOpen(false);
    if (to) router.push(to);
  }, [router]);

  const goTo = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    const target = Math.max(0, Math.min(SLIDES - 1, i));
    el.scrollTo({ left: target * el.clientWidth, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setActive(target);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") { e.preventDefault(); goTo(active + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(active - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, active, close, goTo]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== active) setActive(i);
  };

  if (!visible) return null;

  const linked = !!appUser?.whatsapp_phone;
  const last = active === SLIDES - 1;

  return (
    <div className="fixed inset-0 z-[60] flex md:items-center md:justify-center md:bg-ink/60 md:p-6">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Novedades"
        tabIndex={-1}
        className={cn(
          "relative flex flex-col w-full h-full bg-card text-foreground overflow-hidden outline-none",
          "md:w-[420px] md:h-[85vh] md:max-h-[880px] md:rounded-[28px] md:border-[2.5px] md:border-ink md:shadow-[8px_8px_0_0_#1E1A2E]",
        )}
      >
        {!last && (
          <button
            onClick={() => close()}
            className="absolute right-4 z-10 inline-flex items-center gap-1 rounded-full border-2 border-ink bg-white text-ink px-3 py-1 text-xs font-semibold shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            style={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
          >
            Saltar
          </button>
        )}

        <div
          ref={scroller}
          onScroll={onScroll}
          className="flex-1 min-h-0 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden no-scrollbar overscroll-x-contain"
        >
          <SlideHero />
          <SlideResumen />
          <SlideBot />
          <SlideCierre />
        </div>

        {/* Pie fijo: paginación y botones no se deslizan con la slide. */}
        <div
          className="shrink-0 border-t-2 border-ink/10 bg-card px-5 pt-3 space-y-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
        >
          <div className="flex items-center justify-center gap-1.5" role="tablist" aria-label="Pasos">
            {Array.from({ length: SLIDES }, (_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === active}
                aria-label={`Ir al paso ${i + 1} de ${SLIDES}`}
                onClick={() => goTo(i)}
                className={cn(
                  "h-2.5 rounded-full border-2 border-ink transition-all",
                  i === active ? "w-7 bg-primary" : "w-2.5 bg-white hover:bg-primary/20",
                )}
              />
            ))}
          </div>

          {last ? (
            /* Apilados, primario arriba: lado a lado "Vincular WhatsApp" no
               entraba en media fila y partía en dos renglones. */
            <div className="flex flex-col gap-2">
              {linked ? (
                <>
                  <Button className="w-full whitespace-nowrap" onClick={() => close("/tarjetas")}>Ir a Tarjetas</Button>
                  <Button variant="outline" className="w-full" onClick={() => close()}>Listo</Button>
                </>
              ) : (
                <>
                  <Button className="w-full whitespace-nowrap" onClick={() => close("/settings#whatsapp")}>
                    <MessageCircle className="w-4 h-4" /> Vincular WhatsApp
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => close("/tarjetas")}>Ir a Tarjetas</Button>
                </>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              {active > 0 && (
                <Button variant="outline" className="flex-1" onClick={() => goTo(active - 1)}>Atrás</Button>
              )}
              <Button className="flex-1" onClick={() => goTo(active + 1)}>
                Siguiente <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Piezas comunes ───────────────────────────────────────────────────────────

function Slide({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="snap-center snap-always w-full shrink-0 h-full overflow-y-auto overflow-x-hidden flex flex-col"
    >
      {children}
    </section>
  );
}

function Band({ children, style, className }: {
  children: React.ReactNode; style?: React.CSSProperties; className?: string;
}) {
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden border-b-[2.5px] border-ink", className)}
      style={{ paddingTop: "env(safe-area-inset-top)", ...style }}
    >
      {children}
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 px-6 pt-5 pb-6 space-y-3">{children}</div>;
}

function StepChip({ children }: { children: React.ReactNode }) {
  return <Chip tone="violet" className="uppercase tracking-wide font-bold text-[11px]">{children}</Chip>;
}

function Headline({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-[26px] leading-[1.1] font-bold text-foreground text-balance">{children}</h2>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-foreground">
      <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-emerald-100 border-2 border-ink flex items-center justify-center">
        <Check className="w-3 h-3 text-emerald-700" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </li>
  );
}

// ── 1 · Hero ─────────────────────────────────────────────────────────────────

function SlideHero() {
  return (
    <Slide label="Novedades">
      <Band className="h-[46%] min-h-[300px]" style={{ background: BRAND_FIELD }}>
        <span
          className="absolute left-5 inline-flex items-center gap-1 rounded-full border-2 border-ink bg-white text-ink px-3 py-1 text-xs font-bold tracking-wide shadow-chip"
          style={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <Sparkles className="w-3.5 h-3.5 text-primary" /> NUEVO
        </span>

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center" style={{ top: "calc(env(safe-area-inset-top) + 44px)" }} aria-hidden="true">
          <div className="relative w-[300px] h-[210px]">
            {/* PDF */}
            <div className={cn(STICKER, "absolute left-2 top-6 w-[104px] rounded-xl p-2.5 -rotate-[8deg]")}>
              <div className="flex items-center gap-1.5">
                <span className="rounded-md bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 border-2 border-ink">PDF</span>
              </div>
              <p className="mt-1.5 text-[11px] font-bold leading-tight">Resumen BBVA</p>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 rounded-full bg-ink/15 w-full" />
                <div className="h-1.5 rounded-full bg-ink/15 w-4/5" />
                <div className="h-1.5 rounded-full bg-ink/15 w-11/12" />
                <div className="h-1.5 rounded-full bg-ink/15 w-3/5" />
              </div>
            </div>

            {/* Flecha punteada */}
            <svg className="absolute left-[104px] top-[62px]" width="74" height="40" viewBox="0 0 74 40" fill="none">
              <path d="M4 30 C 24 4, 46 4, 64 20" stroke="white" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" />
              <path d="M56 12 L66 21 L54 25" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            {/* Teléfono */}
            <div className={cn(STICKER, "absolute right-2 top-0 w-[112px] h-[176px] rounded-[22px] p-2 rotate-[5deg] shadow-[5px_5px_0_0_#1E1A2E]")}>
              <div className="mx-auto w-8 h-1.5 rounded-full bg-ink/80" />
              <div className="mt-2 h-[140px] rounded-[14px] bg-[#F1EEFF] border-2 border-ink/80 flex flex-col items-center justify-center gap-2 px-2 text-center">
                <span className="w-11 h-11 rounded-full bg-emerald-400 border-2 border-ink flex items-center justify-center shadow-[2px_2px_0_0_#1E1A2E]">
                  <Check className="w-6 h-6 text-white" strokeWidth={3.5} />
                </span>
                <p className="text-[11px] font-bold leading-tight">31 gastos cargados</p>
              </div>
            </div>

            {/* Burbuja de chat */}
            <div className="absolute left-12 bottom-1 rotate-[-3deg]">
              <div className="relative rounded-2xl rounded-bl-sm bg-[#D9FDD3] text-ink border-2 border-ink shadow-[3px_3px_0_0_#1E1A2E] px-3 py-1.5 text-xs font-semibold">
                12 lucas verdu <span className="text-emerald-600">✓</span>
              </div>
            </div>
          </div>
        </div>
      </Band>

      <Body>
        <Headline>Dejá de cargar gastos a mano</Headline>
        <p className="text-[15px] text-muted-foreground leading-relaxed">
          Subí el resumen de tu tarjeta o mandá un comprobante: RegistrApp deja tus datos al día.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Chip>📄 Subí tu resumen</Chip>
          <Chip tone="emerald">💬 Bot de WhatsApp</Chip>
          <Chip tone="amber">🧾 Comprobantes</Chip>
        </div>
      </Body>
    </Slide>
  );
}

// ── 2 · Subir resumen ────────────────────────────────────────────────────────

const GROUPS = [
  { label: "Faltantes", n: 3, Icon: FileText, tile: "bg-sky-100 text-sky-700" },
  { label: "Sumados dos veces", n: 3, Icon: Copy, tile: "bg-rose-100 text-rose-700" },
  { label: "USD mal identificados", n: 1, Icon: Coins, tile: "bg-emerald-100 text-emerald-700" },
  { label: "Redondeos de cuota", n: 2, Icon: Receipt, tile: "bg-amber-100 text-amber-700" },
] as const;

function SlideResumen() {
  return (
    <Slide label="Subir resumen">
      <Band className="h-[46%] min-h-[320px] bg-[#EEEBFF]" style={DOTS_BG}>
        <div className="absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] flex items-center justify-center px-6 pt-6" aria-hidden="true">
          <div className={cn(STICKER, "w-full max-w-[300px] rounded-2xl p-3 space-y-2 -rotate-[1.5deg] shadow-[5px_5px_0_0_#1E1A2E]")}>
            <p className="text-[12px] font-bold leading-tight">Revisar resumen · BBVA septiembre</p>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg border-2 border-ink bg-[#F1EEFF] px-2 py-1">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink/60">Banco</p>
                <p className="text-[13px] font-black tabular-nums">$2.773.339</p>
              </div>
              <div className="rounded-lg border-2 border-ink bg-white px-2 py-1">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink/60">RegistrApp</p>
                <p className="text-[13px] font-black tabular-nums">$2.676.207</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border-2 border-ink bg-[#DCEFD9] px-2 py-1 text-[11px] font-semibold text-emerald-800">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Diferencia explicada al centavo ✓
            </div>
            <ul className="space-y-1">
              {GROUPS.map(({ label, n, Icon, tile }) => (
                <li key={label} className="flex items-center gap-2 rounded-lg border-2 border-ink/15 px-1.5 py-1">
                  <span className={cn("w-6 h-6 shrink-0 rounded-md border-2 border-ink flex items-center justify-center", tile)}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[11px] font-semibold">{label}</span>
                  <span className="shrink-0 rounded-full bg-ink text-white text-[10px] font-bold px-1.5 min-w-[18px] text-center">{n}</span>
                  <span className="shrink-0 rounded-full border-2 border-ink bg-primary text-white text-[10px] font-bold px-2 py-px">Aplicar</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Band>

      <Body>
        <StepChip>1 · Subí tu resumen</StepChip>
        <Headline>Subí el PDF. Tus datos quedan al día.</Headline>
        <ul className="space-y-2 pt-1">
          <Bullet>Carga lo que falta, corrige montos y borra duplicados</Bullet>
          <Bullet>Crea la tarjeta y el resumen si no existen</Bullet>
          <Bullet>Vos confirmás grupo por grupo — y podés deshacer</Bullet>
        </ul>
        <p className="text-xs text-muted-foreground pt-1">
          Está en <span className="font-semibold text-foreground">Tarjetas → Subir resumen</span>
        </p>
      </Body>
    </Slide>
  );
}

// ── 3 · Bot de WhatsApp ──────────────────────────────────────────────────────

function Bubble({ me, children }: { me?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex", me ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] rounded-xl border-[1.5px] border-ink px-2 py-1 text-[10.5px] leading-snug text-ink shadow-[2px_2px_0_0_#1E1A2E]",
          me ? "bg-[#D9FDD3] rounded-br-sm" : "bg-white rounded-bl-sm",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function SlideBot() {
  return (
    <Slide label="Bot de WhatsApp">
      <Band className="h-[52%] min-h-[340px] bg-[#E3F5E1]" style={DOTS_BG}>
        <div className="absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] flex justify-center pt-8" aria-hidden="true">
          {/* El teléfono asoma desde abajo: el borde inferior de la banda lo corta. */}
          <div className={cn(STICKER, "relative w-[236px] h-[420px] rounded-[30px] p-2 shadow-[5px_5px_0_0_#1E1A2E]")}>
            <div className="h-full rounded-[22px] border-2 border-ink overflow-hidden flex flex-col">
              <div className="flex items-center gap-1.5 bg-[#1F6F5C] px-2.5 py-1.5 text-white">
                <span className="w-5 h-5 rounded-full bg-white/90 border border-ink flex items-center justify-center">
                  <MessageCircle className="w-3 h-3 text-[#1F6F5C]" />
                </span>
                <span className="text-[11px] font-bold">RegistrApp</span>
              </div>
              <div className="flex-1 bg-[#EFE7DC] p-2 space-y-1.5">
                <Bubble me>12 lucas verdu</Bubble>
                <Bubble>✅ $12.000,00 · Verdulería (sugerida). ¿Le agregás una descripción?</Bubble>
                <Bubble me>compras del finde</Bubble>
                <Bubble>✏️ Listo: $12.000,00 · compras del finde</Bubble>
                <Bubble me><span className="font-semibold">📄 comprobante.pdf</span></Bubble>
                <Bubble>¿En qué categoría va Kiosco Mar ($3.600,00)? 1️⃣ Supermercado 2️⃣ Varios</Bubble>
              </div>
            </div>
          </div>
        </div>

        {/* En el hueco a la izquierda del primer mensaje: más arriba tapaba el
            encabezado del chat, más abajo las burbujas del bot. */}
        <span style={{ top: "calc(env(safe-area-inset-top) + 88px)" }} className="absolute left-3 -rotate-[7deg] rounded-full border-2 border-ink bg-amber-200 text-ink px-2.5 py-1 text-[10px] font-bold shadow-chip" aria-hidden="true">
          Entiende «lucas» y «palos»
        </span>
        <span className="absolute right-3 bottom-8 rotate-[6deg] rounded-full border-2 border-ink bg-white text-ink px-2.5 py-1 text-[10px] font-bold shadow-chip" aria-hidden="true">
          Aprende tus categorías
        </span>
      </Band>

      <Body>
        <StepChip>2 · Bot de WhatsApp</StepChip>
        <Headline>Escribile como le escribís a un amigo</Headline>
        <p className="text-[15px] text-muted-foreground leading-relaxed">
          Mandá un gasto en texto, como te salga, o el PDF de un comprobante o del resumen. El bot lo
          registra y te pregunta lo que no sabe.
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {["deshacer", "editar monto", "editar categoría", "editar descripción"].map(c => (
            <span key={c} className="rounded-full border-2 border-ink bg-[#F1EEFF] text-ink px-2.5 py-0.5 font-mono text-[11px] font-semibold">
              {c}
            </span>
          ))}
        </div>
      </Body>
    </Slide>
  );
}

// ── 4 · Cierre ───────────────────────────────────────────────────────────────

const WAYS = [
  { Icon: FileText, tile: "bg-[#EEEBFF] text-primary", title: "Resumen de tarjeta", line: "En Tarjetas → Subir resumen, o mandalo al bot." },
  { Icon: MessageCircle, tile: "bg-emerald-100 text-emerald-700", title: "Un gasto por chat", line: "Ej: «12 lucas verdu» o «usd 20 regalo ayer»." },
  { Icon: Receipt, tile: "bg-amber-100 text-amber-700", title: "Comprobante de pago", line: "Compartí el PDF de Mercado Pago, Personal Pay o tu banco." },
] as const;

function SlideCierre() {
  return (
    <Slide label="Empezá ya">
      <Band className="h-[20%] min-h-[130px] bg-[#FFF1D6]" style={DOTS_BG}>
        <div className="absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] flex items-center justify-center gap-4" aria-hidden="true">
          {/* Íconos de línea y no emoji: los emoji del sistema cambian de
              dibujo entre iOS y Android (el 🧾 hasta dice "RECEIPT") y
              chocaban con los íconos de las tarjetas de abajo. */}
          {[
            { k: "doc", Icon: FileText, r: "-rotate-[8deg]", bg: "bg-[#EEEBFF] text-[#5B4FE9]" },
            { k: "chat", Icon: MessageCircle, r: "rotate-[4deg] -translate-y-2", bg: "bg-[#D9FDD3] text-emerald-700" },
            { k: "receipt", Icon: Receipt, r: "rotate-[10deg]", bg: "bg-[#FFF1D6] text-amber-700" },
          ].map(({ k, Icon, r, bg }) => (
            <span key={k} className={cn("w-14 h-14 rounded-2xl border-2 border-ink shadow-[4px_4px_0_0_#1E1A2E] flex items-center justify-center", bg, r)}>
              <Icon className="w-7 h-7" strokeWidth={2.25} />
            </span>
          ))}
        </div>
      </Band>

      <Body>
        <StepChip>3 · Empezá ya</StepChip>
        <Headline>Tres formas de cargar sin cargar</Headline>
        <ol className="space-y-2.5 pt-1">
          {WAYS.map(({ Icon, tile, title, line }, i) => (
            <li key={title} className="relative flex items-center gap-3 rounded-2xl border-2 border-ink bg-white text-ink p-3 shadow-chip">
              <span className="absolute -left-2 -top-2 w-6 h-6 rounded-full bg-ink text-white text-[11px] font-black flex items-center justify-center border-2 border-white">
                {i + 1}
              </span>
              <span className={cn("w-10 h-10 shrink-0 rounded-xl border-2 border-ink flex items-center justify-center", tile)}>
                <Icon className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{title}</span>
                <span className="block text-xs text-ink/70 leading-snug">{line}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-2 text-xs text-muted-foreground pt-1">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>Nada se guarda sin tu confirmación. Siempre podés deshacer.</span>
        </p>
      </Body>
    </Slide>
  );
}

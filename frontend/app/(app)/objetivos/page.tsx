"use client";

import { useCallback, useEffect, useState } from "react";
import { useNuevo } from "@/lib/nuevo";
import Link from "next/link";
import { ChevronDown, MoreVertical, Target, Plus } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Step } from "react-joyride";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { useReaccion } from "@/components/brand/ToodReaccion";
import ProductTour from "@/components/ProductTour";
import { BLOCK, GLASS } from "@/components/ui/glass";
import { useCountUp } from "@/components/ui/count-up";
import { MotionList } from "@/components/ui/motion-list";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import {
  GoalForm, ProgressBar, STATUS_TONE, goalStatus, money, monthLabel,
  type Currency, type Goal, type GoalsResponse,
} from "@/components/objetivos/goals";

// Lo que hay en la pantalla, en el orden en que se mira. Sólo con objetivos: vacía no hay nada que mostrar.
const TOUR_STEPS: Step[] = [
  {
    target: "[data-tour='ahorro-total']",
    title: "Lo que llevás juntado",
    content: "Lo apartado para tus objetivos, en pesos y en dólares por separado, y cuánto apartar este mes para llegar al próximo.",
  },
  {
    target: "[data-tour='ahorro-goal']",
    title: "Cada objetivo",
    content: "Cuánto llevás, cuánto te falta y cuánto apartar por mes. Tocalo para aportar, retirar o ver sus aportes.",
  },
  {
    target: "[data-tour='ahorro-new']",
    title: "Otro objetivo",
    content: "Ponele un monto y, si querés, una fecha. Con la fecha te digo cuánto apartar cada mes.",
  },
];


/** La cifra del bloque: los dólares si hay, si no los pesos. Nunca las dos sumadas. */
function TotalFigure({ amount, currency }: { amount: number; currency: Currency }) {
  const counted = useCountUp(amount);
  return (
    <p className="font-medium leading-[1.08] tracking-[-0.045em] tabular-nums text-[clamp(2.5rem,13vw,3.5rem)]">
      {money(Math.round(counted), currency)}
    </p>
  );
}

/** El objetivo con fecha que vence primero y todavía se puede alcanzar. */
function nextGoal(goals: Goal[]): Goal | undefined {
  return goals
    .filter(g => !g.achieved && !g.overdue && g.target_date && g.per_month_needed !== null)
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!))[0];
}

/**
 * Lo apartado en dólares contra lo que figura en Divisas. Es una referencia, no
 * un control: la plata de un objetivo puede estar en otra cuenta que la app no ve.
 */
function holdingLine(assigned: number, holding: number): string | null {
  if (assigned <= 0) return null;
  if (assigned > holding + 0.005) {
    return holding > 0
      ? `A objetivos asignaste ${money(assigned - holding, "USD")} más de lo que figura en Divisas (${money(holding, "USD")}). Puede que estén en otra cuenta.`
      : `En Divisas no figuran dólares. Puede que los ${money(assigned, "USD")} de tus objetivos estén en otra cuenta.`;
  }
  return `En Divisas tenés ${money(holding, "USD")}; a objetivos asignaste ${money(assigned, "USD")}.`;
}

function GoalRow({ goal, tour }: { goal: Goal; tour?: boolean }) {
  const saved = Number(goal.saved);
  const status = goalStatus(goal);
  return (
    <Link href={`/objetivos/${goal.id}`} data-tour={tour ? "ahorro-goal" : undefined} data-no-press
      className="block py-3.5 border-b border-border last:border-b-0 active:opacity-60 transition-opacity">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-semibold text-[15.5px] text-foreground truncate">{goal.name}</span>
        <span className="shrink-0 tabular-nums text-right text-base font-medium text-foreground">
          {saved > 0
            ? <>{money(saved, goal.currency)} <span className="text-sm font-normal text-muted-foreground">de {money(goal.target_amount, goal.currency).replace(/^(U\$D|\$)\s?/, "")}</span></>
            : <><span className="text-sm font-normal text-muted-foreground">Meta </span>{money(goal.target_amount, goal.currency)}</>}
        </span>
      </span>
      <ProgressBar pct={goal.pct} done={goal.achieved} className="mt-2" />
      <span className={`mt-1.5 block text-sm truncate ${STATUS_TONE[status.tone]}`}>
        {status.text}
        {goal.target_date && !goal.achieved && !goal.overdue && <span className="text-muted-foreground"> · para {monthLabel(goal.target_date)}</span>}
      </span>
    </Link>
  );
}

export default function ObjetivosPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const reaccionar = useReaccion();
  const [data, setData] = useState<GoalsResponse | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  useNuevo(() => setCreating(""), "nuevo");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    setError("");
    api.get<GoalsResponse>("/savings/goals")
      .then(({ data }) => setData(data))
      .catch(e => setError(getErrorMessage(e, "No pudimos traer tus objetivos.")));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Inicio manda acá con ?nuevo=1 para crear el primer objetivo.
    if (new URLSearchParams(window.location.search).get("nuevo") !== "1") return;
    setCreating("");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const active = data?.goals.filter(g => !g.archived) ?? [];
  const archived = data?.goals.filter(g => g.archived) ?? [];
  // Lo que todavía se está juntando primero, por fecha; los cumplidos al final.
  const ordered = [...active].sort((a, b) =>
    Number(a.achieved) - Number(b.achieved)
    || (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"));
  const usd = Number(data?.saved_usd ?? 0);
  const ars = Number(data?.saved_ars ?? 0);
  const next = nextGoal(active);
  const holding = holdingLine(usd, Number(data?.usd_holding ?? 0));

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Objetivos</h1>
      <div className="flex items-center gap-0.5 shrink-0">
        {/* En el celular el alta va por el + de la barra: acá arriba quedaba tapado por el encabezado. */}
        {active.length > 0 && (
          <button onClick={() => setCreating("")} data-tour="ahorro-new"
            className="hidden md:inline-flex h-11 pl-3.5 pr-4 rounded-full bg-ink text-background text-[14.5px] font-semibold items-center gap-1.5 active:scale-[0.97] transition-transform duration-100">
            <Plus className="w-[18px] h-[18px]" /> Objetivo
          </button>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button title="Más acciones" aria-label="Más acciones"
              className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
              <MoreVertical className="w-5 h-5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4}
              className="rounded-[22px] border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota p-1.5 animate-fade-in w-48 z-50">
              <DropdownMenu.Item asChild><PrivacyMenuItem /></DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );

  const form = creating !== null && (
    <GoalForm presetName={creating} onClose={() => setCreating(null)}
      onSaved={goal => {
        setCreating(null);
        reaccionar(goal.achieved ? "ingreso" : "guardado", goal.achieved ? "¡Objetivo cumplido!" : "Objetivo creado");
        load();
      }} />
  );

  if (error && !data) {
    return (
      <div className="space-y-4 md:space-y-6">
        {header}
        <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
          <p>{error} Tus datos están bien: fijate si tenés conexión.</p>
          <button onClick={load} className="mt-1 min-h-[40px] font-semibold underline">Probar de nuevo</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 md:space-y-6">
        {header}
        <div aria-busy="true" className={`${BLOCK} h-[200px] animate-pulse`}>
          <span className="sr-only">Cargando tus objetivos</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 md:pb-16">
      {active.length > 0 && <ProductTour tourId="ahorro-intro" steps={TOUR_STEPS} />}
      {header}

      {active.length === 0 ? (
        // Como el vacío de Créditos: qué es, para qué sirve y un botón. El formulario trae su guía.
        <section className="px-2 pt-2">
          <Target className="w-8 h-8 text-[#3B2FB3]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-3 text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">
            {archived.length > 0 ? "No tenés objetivos abiertos" : "Todavía no tenés objetivos"}
          </p>
          <p className="mt-1 text-[15.5px] leading-snug text-muted-foreground">
            Ponele monto y fecha a algo que quieras, y te digo cuánto apartar cada mes para llegar.
          </p>
          <button onClick={() => setCreating("")} className="mt-4 h-[52px] px-6 rounded-full bg-ink text-background font-semibold text-[15.5px] active:scale-[0.98] transition-transform duration-100">
            Crear objetivo
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 items-start">
          <section className={BLOCK} data-tour="ahorro-total">
            <div className="px-2.5">
              <p className="text-[16.5px] font-medium">Llevás juntado</p>
              {usd > 0 || ars === 0
                ? <TotalFigure amount={usd} currency="USD" />
                : <TotalFigure amount={ars} currency="ARS" />}
              {usd > 0 && ars > 0 && (
                <p className="mt-0.5 text-[19px] font-medium tracking-[-0.02em] tabular-nums">y {money(ars, "ARS")} en pesos</p>
              )}
            </div>
            {/* Con un solo objetivo, su fila ya lo dice. */}
            {next && active.length > 1 && (
              <div className={`mt-4 ${GLASS} px-4 py-3.5`}>
                <p className="text-[15px]">Próximo: <span className="font-semibold">{next.name}</span></p>
                <p className="mt-0.5 text-[19px] font-medium leading-snug tracking-[-0.02em]">
                  {/* Con cuota fija manda la cuota, como en su fila y en Inicio: el
                      reparto hasta la fecha decía otro número para el mismo objetivo. */}
                  {next.plan_amount && !next.plan_paused ? (
                    <>Tu cuota es <span className="tabular-nums">{money(next.plan_amount, next.currency)}</span> por mes{next.plan_eta ? <>: llegás en {monthLabel(next.plan_eta)}</> : null}.</>
                  ) : (
                    <>Apartá <span className="tabular-nums">{money(next.per_month_needed!, next.currency)}</span> por mes para llegar a {monthLabel(next.target_date!)}.</>
                  )}
                </p>
              </div>
            )}
            {holding && <p className="mt-3 px-2.5 text-sm leading-snug text-white/85">{holding}</p>}
          </section>

          <section className="px-2">
            <h2 className="mb-0.5 text-[22px] font-medium tracking-[-0.03em] text-foreground">Tus objetivos</h2>
            <MotionList>
              {ordered.map((g, i) => <GoalRow key={g.id} goal={g} tour={i === 0} />)}
            </MotionList>
          </section>
        </div>
      )}

      {archived.length > 0 && (
        <MotionList as="section" className="px-2">
          <button onClick={() => setShowArchived(v => !v)} aria-expanded={showArchived}
            className="w-full min-h-[48px] flex items-center justify-between gap-3 text-[15.5px] font-medium text-muted-foreground">
            Archivados ({archived.length})
            <ChevronDown className={`w-[18px] h-[18px] transition-transform ${showArchived ? "rotate-180" : ""}`} />
          </button>
          {showArchived && (
            <div className="opacity-80">
              {archived.map(g => <GoalRow key={g.id} goal={g} />)}
            </div>
          )}
        </MotionList>
      )}

      {form}
    </div>
  );
}

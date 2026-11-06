"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Archive, ArchiveRestore, MoreVertical, Pencil, Trash2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "@/lib/api";
import { formatARS, formatUSD, getErrorMessage } from "@/lib/utils";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import { LoadedByTag, useLoadedBy } from "@/components/LoadedBy";
import { LedgerRow } from "@/components/movimientos/Ledger";
import { EntrySheet, SheetActions, SheetRow } from "@/components/movimientos/EntrySheet";
import {
  ContributionForm, GoalForm, ProgressBar, STATUS_TONE, goalStatus, hasPace, money, monthLabel,
  type Contribution, type Goal,
} from "@/components/ahorro/goals";

interface Detail { goal: Goal; contributions: Contribution[] }

const MENU_ITEM = "flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-accent w-full outline-none cursor-pointer";

/** Lo grande se lee primero; los centavos, si los hay, más chicos. */
function BigSaved({ text }: { text: string }) {
  const comma = text.lastIndexOf(",");
  return (
    <p className="font-medium text-[clamp(2.5rem,12vw,3.25rem)] leading-[1.08] tracking-[-0.045em] tabular-nums text-foreground">
      {comma >= 0 ? text.slice(0, comma) : text}
      {comma >= 0 && <span className="text-[0.5em] tracking-[-0.02em] text-muted-foreground">{text.slice(comma)}</span>}
    </p>
  );
}

export default function AhorroGoalPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const reaccionar = useReaccion();
  const loadedBy = useLoadedBy();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<"in" | "out" | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<Contribution | null>(null);
  const [sheetError, setSheetError] = useState("");

  const load = useCallback(() => {
    setError("");
    return api.get<Detail>(`/savings/goals/${id}`)
      .then(({ data }) => { setData(data); return data; })
      .catch(e => {
        if ((e as { response?: { status?: number } })?.response?.status === 404) setNotFound(true);
        else setError(getErrorMessage(e, "No pudimos traer este objetivo."));
        return null;
      });
  }, [id]);
  useEffect(() => {
    // Inicio manda acá con ?aportar=1: el aporte se abre apenas está el objetivo.
    const aportar = new URLSearchParams(window.location.search).get("aportar") === "1";
    load().then(goal => {
      if (!aportar || !goal) return;
      setMode("in");
      window.history.replaceState(null, "", window.location.pathname);
    });
  }, [load]);

  const back = (
    <Link href="/ahorro" className="inline-flex items-center gap-1.5 min-h-[44px] -ml-1 pr-2 text-[15px] font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-[18px] h-[18px]" /> Ahorro
    </Link>
  );

  if (notFound) {
    return (
      <div className="space-y-4">
        {back}
        <p className="px-2 text-[15.5px] text-muted-foreground">Este objetivo ya no existe. Puede que lo hayan eliminado.</p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="space-y-4">
        {back}
        <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
          <p>{error} Fijate si tenés conexión.</p>
          <button onClick={load} className="mt-1 min-h-[40px] font-semibold underline">Probar de nuevo</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        {back}
        <div className="px-2 animate-pulse space-y-3">
          <div className="h-8 w-48 rounded-full bg-ink/[0.07]" />
          <div className="h-14 w-60 rounded-2xl bg-ink/[0.07]" />
          <div className="h-2 rounded-full bg-ink/[0.07]" />
        </div>
        <span className="sr-only">Cargando el objetivo</span>
      </div>
    );
  }

  const { goal, contributions } = data;
  const status = goalStatus(goal);
  const saved = Number(goal.saved);
  const fmt = goal.currency === "USD" ? formatUSD : formatARS;

  async function setArchived(archived: boolean) {
    try {
      await api.patch(`/savings/goals/${goal.id}`, { archived });
      reaccionar("guardado", archived ? "Objetivo archivado" : "Objetivo de vuelta en la lista");
      load();
    } catch (e) {
      reaccionar("error", getErrorMessage(e, "No se pudo cambiar"));
    }
  }

  async function deleteGoal() {
    try {
      await api.delete(`/savings/goals/${goal.id}`);
      reaccionar("borrado", "Objetivo eliminado");
      router.push("/ahorro");
    } catch (e) {
      setConfirmDelete(false);
      reaccionar("error", getErrorMessage(e, "No se pudo eliminar"));
    }
  }

  async function deleteContribution(c: Contribution) {
    setSheetError("");
    try {
      await api.delete(`/savings/contributions/${c.id}`);
      setViewing(null);
      reaccionar("borrado", Number(c.amount) < 0 ? "Retiro eliminado" : "Aporte eliminado");
      load();
    } catch (e) {
      setSheetError(getErrorMessage(e, "No se pudo eliminar."));
    }
  }

  // Sólo lo que la línea de estado no dice ya.
  const facts: { label: string; value: string }[] = [];
  const statusHasRemaining = goal.overdue || (status.tone === "quiet" && !hasPace(goal));
  if (!goal.achieved && saved > 0 && !statusHasRemaining) facts.push({ label: "Te falta", value: money(goal.remaining, goal.currency) });
  if (goal.target_date && !goal.achieved) facts.push({ label: goal.overdue ? "Era para" : "Para", value: monthLabel(goal.target_date) });
  if (hasPace(goal) && !goal.achieved) facts.push({ label: "Venís aportando", value: `${money(Math.round(Number(goal.pace_per_month)), goal.currency)} por mes` });
  // Con fecha, el ritmo dice si llega a tiempo; sin fecha, ya lo dice la línea de estado.
  if (goal.eta && hasPace(goal) && goal.target_date && !goal.achieved && !goal.overdue) {
    facts.push(goal.eta.slice(0, 7) <= goal.target_date.slice(0, 7)
      ? { label: "A este ritmo", value: "llegás a tiempo" }
      : { label: "A este ritmo llegás en", value: monthLabel(goal.eta) });
  }

  return (
    <div className="space-y-4 md:space-y-6 md:pb-16">
      <div className="flex items-center justify-between gap-2">
        {back}
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
              <DropdownMenu.Item asChild>
                <button onClick={() => setEditing(true)} className={`${MENU_ITEM} text-foreground`}>
                  <Pencil className="w-4 h-4 text-muted-foreground" /> Editar
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <button onClick={() => setArchived(!goal.archived)} className={`${MENU_ITEM} text-foreground`}>
                  {goal.archived
                    ? <><ArchiveRestore className="w-4 h-4 text-muted-foreground" /> Desarchivar</>
                    : <><Archive className="w-4 h-4 text-muted-foreground" /> Archivar</>}
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild><PrivacyMenuItem /></DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item asChild>
                <button onClick={() => setConfirmDelete(true)} className={`${MENU_ITEM} text-destructive`}>
                  <Trash2 className="w-4 h-4" /> Eliminar
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <MotionList className="space-y-4">
        {confirmDelete && (
          <div className="rounded-[22px] bg-rose-50 border border-rose-200 p-2.5" role="alert">
            <p className="px-1.5 pb-2 text-[15px] font-medium text-rose-900">
              {contributions.length > 0
                ? `¿Eliminar ${goal.name} y ${contributions.length === 1 ? "su aporte" : `sus ${contributions.length} aportes`}? No se puede deshacer.`
                : `¿Eliminar ${goal.name}? No se puede deshacer.`}
              {!goal.archived && " Si ya no lo usás, también podés archivarlo."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" autoFocus onClick={() => setConfirmDelete(false)}
                className="h-12 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-foreground">
                No, dejarlo
              </button>
              <button type="button" onClick={deleteGoal}
                className="h-12 rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px]">
                Sí, eliminar
              </button>
            </div>
          </div>
        )}

        <div className="lg:grid lg:grid-cols-2 lg:gap-10 lg:items-start space-y-4 lg:space-y-0">
          <section className="px-2">
            <h1 className="text-[26px] md:text-3xl font-display font-medium leading-tight tracking-[-0.035em] text-foreground break-words">{goal.name}</h1>
            {goal.archived && <p className="mt-1 font-marca text-xs text-muted-foreground">archivado</p>}
            {/* Sin aportes, lo grande es la meta: "$ 0" no le dice nada a nadie. */}
            <div className="mt-3">
              {saved > 0 ? <>
                <BigSaved text={money(saved, goal.currency)} />
                <p className="mt-0.5 text-[15.5px] text-muted-foreground">de {money(goal.target_amount, goal.currency)}</p>
              </> : <>
                <p className="text-[15.5px] text-muted-foreground">Meta</p>
                <BigSaved text={money(goal.target_amount, goal.currency)} />
              </>}
            </div>
            <ProgressBar pct={goal.pct} done={goal.achieved} className="mt-3.5 h-2.5" />
            <p className={`mt-2 text-[15.5px] font-medium ${STATUS_TONE[status.tone]}`}>{status.text}</p>

            {goal.archived ? (
              <div className="mt-4 rounded-3xl p-4 bg-accent border border-[#CFC9E4]">
                <p className="text-[15px] leading-snug text-[#4A4658]">Está archivado: no suma en lo juntado de Ahorro. Lo apartado sigue acá.</p>
                <button onClick={() => setArchived(false)}
                  className="mt-3 h-11 px-5 rounded-full bg-ink text-background text-sm font-semibold active:scale-[0.97] transition-transform duration-100">
                  Desarchivar
                </button>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => setMode("in")}
                  className="flex-1 h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] active:scale-[0.98] transition-transform duration-100">
                  Aportar
                </button>
                {saved > 0 && (
                  <button onClick={() => setMode("out")}
                    className="h-[52px] px-6 rounded-full border border-border bg-card font-semibold text-[15.5px] text-foreground active:scale-[0.98] transition-transform duration-100">
                    Retirar
                  </button>
                )}
              </div>
            )}

            {facts.length > 0 && (
              <div className="mt-4 rounded-[22px] bg-card border border-border px-4 divide-y divide-border">
                {facts.map(f => (
                  <div key={f.label} className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
                    <span className="text-[#4A4658]">{f.label}</span>
                    <span className="font-medium text-foreground tabular-nums text-right first-letter:uppercase">{f.value}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="px-2">
            <h2 className="mb-1 text-[22px] font-medium tracking-[-0.03em] text-foreground">Aportes</h2>
            {contributions.length === 0 ? (
              <p className="py-3 text-[15px] text-muted-foreground">
                Todavía no apartaste nada para esto. Cuando lo hagas, cargalo con Aportar y la cuenta se hace sola.
              </p>
            ) : (
              <MotionList>
                {contributions.map((c, i) => {
                  const amount = Number(c.amount);
                  const kind = amount < 0 ? "Retiro" : "Aporte";
                  const who = loadedBy.nameOf(c.user_id);
                  return (
                    <LedgerRow key={c.id}
                      date={c.contribution_date}
                      showDate={i === 0 || contributions[i - 1].contribution_date !== c.contribution_date}
                      title={c.note || kind}
                      sub={(c.note || who) ? <>
                        {c.note && <span className="block truncate">{kind}</span>}
                        <LoadedByTag name={who} />
                      </> : undefined}
                      amount={`${amount < 0 ? "−" : "+"}${money(Math.abs(amount), goal.currency)}`}
                      positive={amount > 0}
                      onOpen={() => { setSheetError(""); setViewing(c); }}
                    />
                  );
                })}
              </MotionList>
            )}
          </section>
        </div>
      </MotionList>

      {viewing && (
        <EntrySheet
          date={viewing.contribution_date}
          title={viewing.note || (Number(viewing.amount) < 0 ? "Retiro" : "Aporte")}
          badge={viewing.note ? { label: Number(viewing.amount) < 0 ? "Retiro" : "Aporte" } : undefined}
          amount={`${Number(viewing.amount) < 0 ? "−" : ""}${fmt(Math.abs(Number(viewing.amount)))}`}
          positive={Number(viewing.amount) > 0}
          onClose={() => setViewing(null)}
          footer={<>
            {sheetError && <p role="alert" className="px-1.5 pb-2.5 text-sm leading-snug text-destructive">{sheetError}</p>}
            <SheetActions
              question={Number(viewing.amount) < 0 ? "¿Eliminar este retiro? No se puede deshacer." : undefined}
              noun="aporte"
              onDelete={() => deleteContribution(viewing)} />
          </>}
        >
          {loadedBy.nameOf(viewing.user_id) && <SheetRow label="Lo cargó">{loadedBy.nameOf(viewing.user_id)}</SheetRow>}
        </EntrySheet>
      )}

      {mode && (
        <ContributionForm goal={goal} mode={mode} first={contributions.length === 0}
          onClose={() => setMode(null)}
          onSaved={async () => {
            const wasDone = goal.achieved;
            const out = mode === "out";
            setMode(null);
            const fresh = await load();
            if (!out && fresh?.goal.achieved && !wasDone) reaccionar("ingreso", `¡Llegaste! ${goal.name} está cumplido`);
            else reaccionar("guardado", out ? "Retiro guardado" : "Aporte guardado");
          }} />
      )}

      {editing && (
        <GoalForm goal={goal} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reaccionar("guardado", "Objetivo actualizado"); load(); }} />
      )}
    </div>
  );
}

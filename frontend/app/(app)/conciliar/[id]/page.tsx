"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { features } from "@/lib/features";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import { getErrorMessage } from "@/lib/utils";
import { Check, CreditCard, Loader2, Plus, Undo2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { FIELD, SegmentedToggle, SelectField } from "@/components/ui/form";
import { SummaryCard, SummaryHeader, ChainRow } from "@/components/ui/summary-card";
import { ErrorNote, shortDate, StatusChip, SubHeader } from "@/components/tarjetas/parts";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import {
  fmtAmount, GROUP_HINTS, GROUP_LABELS, GROUP_NOUNS, groupActionLabel, periodLabel,
  type Action, type ApplyResult, type CurrencyTotals, type SessionDetail,
} from "../shared";

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }

const REASON_TEXTS: Record<string, string> = {
  no_parser: "La app todavía no lee resúmenes de este banco.",
  totals_mismatch: "Los consumos que se leyeron no suman el total que imprimió el banco, así que no se propone ningún cambio.",
  encrypted: "El PDF tiene contraseña. Descargalo sin contraseña y volvé a subirlo.",
  no_text: "No se pudo sacar texto del archivo. Pasa con los PDF escaneados o armados con fotos.",
  no_items: "Se reconoció el banco, pero no apareció ningún consumo en el resumen, así que no se propone ningún cambio.",
};

/** La cadena de una moneda: diferencia, explicada, sin explicar. Lo que da cero no se muestra. */
function TotalsChain({ currency, totals }: { currency: string; totals: CurrencyTotals }) {
  const difference = Number(totals.difference);
  const unexplained = Number(totals.unexplained);
  if (difference === 0 && unexplained === 0) {
    return <p className="text-foreground">Coinciden al centavo.</p>;
  }
  return (
    <>
      <ChainRow label="Diferencia" value={fmtAmount(currency, totals.difference)} />
      {Number(totals.explained) !== 0 && <ChainRow label="Explicada" value={fmtAmount(currency, totals.explained)} />}
      {unexplained === 0 ? (
        <p className="flex items-center gap-1 text-foreground font-medium">
          <Check className="w-4 h-4 shrink-0" /> Explicada al centavo
        </p>
      ) : (
        <ChainRow label="Sin explicar" value={fmtAmount(currency, totals.unexplained)} strong />
      )}
    </>
  );
}

// Las opciones de la pregunta de tarjeta o de período: lila la elegida.
const OPTION = "w-full min-h-[52px] flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border text-left text-[15px] transition-colors active:scale-[0.99]";
const OPTION_ON = "bg-accent border-[#CFC9E4]";
const OPTION_OFF = "bg-card border-border";

export default function ConciliarDetailPage() {
  const reaccionar = useReaccion();
  useAmountsHidden(); // repinta la pantalla al ocultar/mostrar montos
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  // Aplicar o deshacer cambia qué queda pendiente: el puntito de Tarjetas
  // tiene que enterarse.
  const { refresh: refreshPending } = usePendingStatements();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  // needs_choice
  const [selCard, setSelCard] = useState<number | null>(null);
  const [selStmt, setSelStmt] = useState<number | null>(null);
  const [saveCardRule, setSaveCardRule] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // El resumen puede ser de una tarjeta que todavía no está cargada: el alta
  // va acá mismo — mandar al usuario a /tarjetas y que vuelva a subir el PDF
  // es exactamente la fricción que esta pantalla existe para matar.
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [newCardAlias, setNewCardAlias] = useState("");
  const [newCardLast4, setNewCardLast4] = useState("");

  // needs_ai
  const [interested, setInterested] = useState(false);
  const [sendingInterest, setSendingInterest] = useState(false);

  // edición por fila
  const [descDraft, setDescDraft] = useState<Record<number, string>>({});
  const [ruleChecked, setRuleChecked] = useState<Record<number, boolean>>({});
  const [userPicked, setUserPicked] = useState<Record<number, boolean>>({});

  // aplicar / deshacer
  const [applying, setApplying] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<Record<string, string>>({});
  const [undoing, setUndoing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<SessionDetail>(`/reconcile/${id}`);
      setSession(res.data);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Las categorías del hogar, para los faltantes en pesos.
  useEffect(() => {
    if (!session?.groups?.missing?.length) return;
    api.get<Category[]>("/expenses/categories")
      .then(res => setCategories(res.data))
      .catch(() => {});
  }, [session?.groups?.missing?.length]);

  const mergeAction = (updated: Action) => {
    setSession(prev => prev && ({
      ...prev,
      groups: Object.fromEntries(
        Object.entries(prev.groups).map(([k, arr]) => [k, arr?.map(a => (a.id === updated.id ? updated : a))])
      ),
    }));
  };

  const patchAction = async (actionId: number, body: Record<string, unknown>) => {
    try {
      const res = await api.patch<Action>(`/reconcile/${id}/actions/${actionId}`, body);
      mergeAction(res.data);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const applyGroup = async (klass: string) => {
    setApplying(klass);
    try {
      const res = await api.post<ApplyResult>(`/reconcile/${id}/groups/${klass}/apply`, null, {
        params: { dry_run: false },
      });
      const d = res.data;
      const parts = [klass === "missing"
        ? `${d.applied} ${d.applied === 1 ? "creado" : "creados"}`
        : `${d.applied} ${d.applied === 1 ? "aplicado" : "aplicados"}`];
      const sinCat = d.skipped.filter(s => s.reason === "sin_categoria").length;
      const otros = d.skipped.length - sinCat;
      if (sinCat) parts.push(`${sinCat} sin categoría (elegí una y volvé a aplicar)`);
      if (otros) parts.push(`${otros} ${otros === 1 ? "salteado" : "salteados"}`);
      if (d.propagated_future_cuotas) parts.push(`${d.propagated_future_cuotas} cuotas siguientes cargadas en sus resúmenes`);
      setApplyMsg(prev => ({ ...prev, [klass]: parts.join(" · ") }));
      if (d.applied > 0) reaccionar("guardado", "Resumen corregido");
      setError(null);
      await load();
      refreshPending();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setApplying(null);
    }
  };

  const discardGroup = async (klass: string) => {
    setApplying(klass);
    try {
      await api.post(`/reconcile/${id}/groups/${klass}/discard`);
      setApplyMsg(prev => ({ ...prev, [klass]: "" }));
      setError(null);
      await load();
      refreshPending();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setApplying(null);
    }
  };

  const undoLast = async () => {
    setUndoing(true);
    try {
      await api.post(`/reconcile/${id}/undo`);
      reaccionar("borrado", "Lo último quedó deshecho");
      setApplyMsg({});
      setError(null);
      await load();
      refreshPending();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setUndoing(false);
    }
  };

  const sendInterest = async () => {
    setSendingInterest(true);
    try {
      await api.post(`/reconcile/${id}/interest`);
      setInterested(true);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSendingInterest(false);
    }
  };

  const confirmChoice = async () => {
    setChoosing(true);
    try {
      const body: Record<string, unknown> = {};
      if (newCardOpen && newCardAlias.trim()) {
        body.new_card = {
          alias: newCardAlias.trim(),
          bank: session?.bank ?? null,
          last_4_digits: newCardLast4.trim() || null,
        };
        body.save_card_rule = saveCardRule;
      } else if (selCard != null) { body.card_id = selCard; body.save_card_rule = saveCardRule; }
      if (selStmt != null) body.statement_id = selStmt;
      const res = await api.post<SessionDetail>(`/reconcile/${id}/choose`, body);
      setSession(res.data);
      setSelCard(null); setSelStmt(null); setSaveCardRule(false);
      setNewCardOpen(false); setNewCardAlias(""); setNewCardLast4("");
      setError(null);
      refreshPending(); // deja de faltar elegir: cambia el chip en Tarjetas
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setChoosing(false);
    }
  };

  const back = { backLabel: "Volver a Resúmenes subidos", backHref: "/tarjetas/resumenes" };

  if (!features.reconcile) {
    return (
      <div className="space-y-4">
        <SubHeader title="Revisar resumen" {...back} />
        <p className="px-2 text-[15px] text-muted-foreground">Subir resumen no está disponible por ahora.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <SubHeader title="Revisar resumen" {...back} />
        <div className="h-[136px] rounded-3xl bg-ink/[0.06] animate-pulse" />
        <span className="sr-only">Cargando el resumen</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <SubHeader title="Revisar resumen" {...back} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button variant="outline" className="h-11" onClick={() => router.push("/tarjetas/resumenes")}>
          Ver los resúmenes subidos
        </Button>
      </div>
    );
  }

  const period = periodLabel(session.period_year, session.period_month);
  const title = [session.bank, period].filter(Boolean).join(" · ") || "Resumen sin identificar";

  const visibleActions = (klass: string): Action[] =>
    (session.groups[klass] ?? []).filter(a => a.status !== "discarded");

  const proposedCount = (klass: string): number =>
    visibleActions(klass).filter(a => a.status === "proposed").length;

  const anyApplied = Object.values(session.groups).some(arr => arr?.some(a => a.status === "applied"));
  const pendingParts = session.group_order
    .map(klass => {
      const n = proposedCount(klass);
      if (!n) return null;
      const nouns = GROUP_NOUNS[klass] ?? [klass, klass];
      return `${n} ${n === 1 ? nouns[0] : nouns[1]}`;
    })
    .filter(Boolean);

  const inReview = ["ready", "unexplained", "applied", "closed"].includes(session.status);

  return (
    <div className="space-y-4 md:space-y-6">
      <SubHeader title="Revisar resumen" {...back}
        sub={<span className="first-letter:uppercase inline-block">{title}{session.card_label && ` · ${session.card_label}`}</span>}>
        <StatusChip status={session.status} />
      </SubHeader>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* ─── No se pudo leer ─────────────────────────────────────────────── */}
      {session.status === "needs_ai" && (
        <Card className="space-y-3">
          <p className="text-[19px] font-medium leading-snug tracking-[-0.02em] text-foreground">
            {REASON_TEXTS[session.reason ?? ""] ?? "No se pudo leer el resumen."}
          </p>
          {session.plan === "free" && (
            <div className="rounded-2xl bg-accent border border-[#CFC9E4] px-3.5 py-3 space-y-2.5">
              <p className="text-[15px] leading-snug text-[#3F3B4B]">
                Analizarlo con IA va a ser parte del plan Pro (próximamente).
              </p>
              {interested ? (
                <Button variant="outline" className="h-11" disabled>
                  <Check className="w-4 h-4" /> Anotamos tu interés
                </Button>
              ) : (
                <Button variant="outline" className="h-11" onClick={sendInterest} disabled={sendingInterest}>
                  {sendingInterest && <Loader2 className="w-4 h-4 animate-spin" />} Me interesa
                </Button>
              )}
            </div>
          )}
          <p className="text-[15px] text-muted-foreground">
            Mientras tanto podés{" "}
            <Link href="/tarjetas" className="font-semibold text-[#3B2FB3]">
              cargarlo a mano en Tarjetas
            </Link>.
          </p>
        </Card>
      )}

      {/* ─── Falta elegir tarjeta o período ─────────────────────────────── */}
      {session.status === "needs_choice" && (
        <section className="space-y-3">
          {session.choices?.cards && (
            <>
              <h3 className="px-2 text-[22px] font-medium tracking-[-0.03em] text-foreground">¿De qué tarjeta es este resumen?</h3>
              <div className="space-y-2">
                {session.choices.cards.map(c => (
                  <button key={c.card_id} type="button" onClick={() => setSelCard(c.card_id)}
                    aria-pressed={selCard === c.card_id}
                    className={`${OPTION} ${selCard === c.card_id ? OPTION_ON : OPTION_OFF}`}>
                    <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-semibold text-foreground">{c.alias}</span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {c.bank}{c.last_4 && ` · •••• ${c.last_4}`}
                    </span>
                  </button>
                ))}
                <button type="button" aria-pressed={newCardOpen}
                  onClick={() => { setNewCardOpen(v => !v); setSelCard(null); }}
                  className={`${OPTION} border-dashed ${newCardOpen ? OPTION_ON : "border-border"}`}>
                  <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 font-semibold text-foreground">
                    {session.choices.cards.length ? "Es otra tarjeta: crearla" : "Crear la tarjeta de este resumen"}
                  </span>
                </button>
              </div>
              {newCardOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={newCardAlias} onChange={e => setNewCardAlias(e.target.value)}
                    aria-label="Alias de la tarjeta"
                    placeholder={`Alias (ej: ${session.bank ?? "Visa"} nueva)`} className={FIELD} />
                  <input value={newCardLast4} onChange={e => setNewCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    aria-label="Últimos 4 dígitos"
                    placeholder="Últimos 4 dígitos (opcional)" inputMode="numeric" pattern="[0-9]*" className={FIELD} />
                </div>
              )}
              <label className="flex items-center gap-2.5 min-h-[44px] px-2 text-[15px] text-[#3F3B4B] cursor-pointer">
                <input type="checkbox" checked={saveCardRule} onChange={e => setSaveCardRule(e.target.checked)}
                  className="w-[18px] h-[18px] accent-[#1C1B25] shrink-0" />
                Recordar esta tarjeta para este resumen
              </label>
            </>
          )}
          {session.choices?.statements && (
            <>
              <h3 className="px-2 text-[22px] font-medium tracking-[-0.03em] text-foreground">¿A qué resumen corresponde?</h3>
              <div className="space-y-2">
                {session.choices.statements.map(s => (
                  <button key={s.statement_id} type="button" onClick={() => setSelStmt(s.statement_id)}
                    aria-pressed={selStmt === s.statement_id}
                    className={`${OPTION} ${selStmt === s.statement_id ? OPTION_ON : OPTION_OFF}`}>
                    <span className="flex-1 min-w-0 truncate font-semibold text-foreground first-letter:uppercase">
                      {periodLabel(s.year, s.month)}
                    </span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {s.item_count === 1 ? "1 consumo" : `${s.item_count} consumos`}
                      {s.closing_date && ` · cierre ${shortDate(s.closing_date)}`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <Button onClick={confirmChoice} className="w-full sm:w-auto h-[52px] px-6"
            disabled={choosing || (selCard == null && selStmt == null && !(newCardOpen && newCardAlias.trim()))}>
            {choosing && <Loader2 className="w-4 h-4 animate-spin" />} Comparar con lo cargado
          </Button>
        </section>
      )}

      {/* ─── Revisión: las cifras + grupos ──────────────────────────────── */}
      {inReview && (
        <>
          {session.totals && (
            <SummaryCard>
              <SummaryHeader title="El banco y lo que cargaste"
                open={showDetail} onToggle={() => setShowDetail(v => !v)} />
              {(["ARS", "USD"] as const).map(cur => {
                const totals = session.totals?.[cur];
                // Una moneda en cero en los dos lados no dice nada.
                if (!totals || (Number(totals.bank_total) === 0 && Number(totals.app_total) === 0)) return null;
                return (
                  // Cada moneda cierra por su lado — los totales nunca se suman.
                  <MotionList key={cur} className="border-t border-border/60">
                    <div className="grid grid-cols-2">
                      <div className="pl-4 md:pl-6 pr-2 pt-2.5 pb-3 min-w-0">
                        <p className="text-sm text-muted-foreground">Banco{cur === "USD" && ", en dólares"}</p>
                        <p className="text-xl md:text-3xl font-medium tracking-[-0.03em] tabular-nums text-foreground whitespace-nowrap">{ledgerAmount(totals.bank_total, cur)}</p>
                      </div>
                      <div className="pl-3 md:pl-6 pr-3 pt-2.5 pb-3 min-w-0 border-l border-border/60">
                        <p className="text-sm text-muted-foreground">Cargado{cur === "USD" && ", en dólares"}</p>
                        <p className="text-xl md:text-3xl font-medium tracking-[-0.03em] tabular-nums text-foreground whitespace-nowrap">{ledgerAmount(totals.app_total, cur)}</p>
                      </div>
                    </div>
                    {showDetail && (
                      <div className="px-4 md:px-6 py-3 space-y-1 text-sm border-t border-border/60">
                        <TotalsChain currency={cur} totals={totals} />
                      </div>
                    )}
                  </MotionList>
                );
              })}
            </SummaryCard>
          )}

          {session.status === "unexplained" && (
            <p className="rounded-3xl bg-accent border border-[#CFC9E4] px-4 py-3 text-[15px] leading-snug font-medium text-foreground">
              La diferencia no queda explicada al centavo. Revisá cada cambio con cuidado antes de confirmarlo.
            </p>
          )}

          {session.group_order.map(klass => {
            const actions = visibleActions(klass);
            if (actions.length === 0) return null;
            const pending = proposedCount(klass);
            return (
              <section key={klass} className="px-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground min-w-0">
                    {GROUP_LABELS[klass] ?? klass}
                  </h3>
                  <span className="font-marca text-xs text-muted-foreground shrink-0">
                    {actions.length}
                  </span>
                </div>
                {GROUP_HINTS[klass] && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{GROUP_HINTS[klass]}</p>
                )}
                <MotionList className="mt-1 divide-y divide-border border-b border-border">
                  {actions.map(a => (
                    <ActionRow key={a.id} klass={klass} action={a} categories={categories}
                      fixHref={session.card_id && session.statement_id && a.item_id != null
                        ? `/tarjetas/${session.card_id}/${session.statement_id}?item=${a.item_id}` : null}
                      descDraft={descDraft} setDescDraft={setDescDraft}
                      ruleChecked={ruleChecked} setRuleChecked={setRuleChecked}
                      userPicked={userPicked} setUserPicked={setUserPicked}
                      patchAction={patchAction} />
                  ))}
                </MotionList>
                <div className="pt-2.5 flex items-center gap-2 flex-wrap">
                  {pending > 0 ? (
                    <>
                      <Button className="h-11" onClick={() => applyGroup(klass)} disabled={applying !== null}>
                        {applying === klass && <Loader2 className="w-4 h-4 animate-spin" />}
                        {groupActionLabel(klass, pending)}
                      </Button>
                      <Button variant="outline" className="h-11" onClick={() => discardGroup(klass)} disabled={applying !== null}>
                        Descartar
                      </Button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sm text-foreground font-medium">
                      <Check className="w-4 h-4" /> Hecho
                    </span>
                  )}
                  {applyMsg[klass] && (
                    <p className="w-full text-sm text-muted-foreground">{applyMsg[klass]}</p>
                  )}
                </div>
              </section>
            );
          })}

          {(anyApplied || pendingParts.length > 0) && (
            <div className="px-2 flex items-center gap-3 flex-wrap">
              {anyApplied && (
                <Button variant="outline" className="h-11" onClick={undoLast} disabled={undoing}>
                  {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                  Deshacer lo último
                </Button>
              )}
              {pendingParts.length > 0 && (
                <p className="text-sm text-muted-foreground">Quedan: {pendingParts.join(" · ")}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Una fila de un grupo. La forma depende del `klass`, el estado la apaga. */
function ActionRow({ klass, action, categories, fixHref, descDraft, setDescDraft, ruleChecked, setRuleChecked, userPicked, setUserPicked, patchAction }: {
  klass: string;
  action: Action;
  categories: Category[];
  fixHref: string | null;
  descDraft: Record<number, string>;
  setDescDraft: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  ruleChecked: Record<number, boolean>;
  setRuleChecked: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  userPicked: Record<number, boolean>;
  setUserPicked: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  patchAction: (actionId: number, body: Record<string, unknown>) => Promise<void>;
}) {
  const p = action.payload;
  const proposed = action.status === "proposed";
  // Apagado = ya resuelto. Lo que se corrige en la app sigue esperando algo.
  const muted = !proposed && action.status !== "needs_app";

  const dismissApp = (
    <button onClick={() => patchAction(action.id, { discard: true })}
      aria-label="Dejarlo así" title="Dejarlo así"
      className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted-foreground hover:bg-ink/[0.06] transition-colors shrink-0">
      <X className="w-4 h-4" />
    </button>
  );

  const stateBadge = action.status === "needs_app" ? dismissApp : action.status === "applied" ? (
    <span className="inline-flex items-center gap-1 text-xs text-foreground font-medium shrink-0">
      <Check className="w-3.5 h-3.5" /> Aplicado
    </span>
  ) : proposed ? (
    // Toda sugerencia se puede rechazar sola: si no, la única salida para
    // una equivocada era aceptarla con el resto del grupo.
    <button onClick={() => patchAction(action.id, { discard: true })}
      aria-label="Descartar" title="Descartar este cambio"
      className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted-foreground hover:bg-ink/[0.06] transition-colors shrink-0">
      <X className="w-4 h-4" />
    </button>
  ) : null;

  // Lo que la API no toca (compartidos, cuotas 2..N) lleva al ítem en su
  // resumen, y se puede dejar así (la X de arriba): si no, queda en pantalla sin
  // salida. Va en su propio renglón: al lado del monto no entra en un celular.
  const needsAppNote = action.status === "needs_app" ? (
    <div className="mt-0.5 space-y-1.5">
      <p className="text-sm text-muted-foreground">
        {p.why_app === "shared"
          ? "Es un gasto compartido: se corrige desde el resumen."
          : p.why_app === "child"
            ? "Es una cuota de un plan: se corrige desde la cuota 1."
            : "Es compartido o una cuota de un plan: se corrige desde el resumen."}
      </p>
      {fixHref ? (
        <Link href={fixHref} title="Abrir este consumo en el resumen" className="inline-flex min-h-[44px] items-center">
          <Chip locked className="hover:bg-accent transition-colors">Corregir en la app →</Chip>
        </Link>
      ) : (
        <Chip locked>Corregir en la app</Chip>
      )}
    </div>
  ) : null;

  // ── Fechas del resumen ──
  if (klass === "dates") {
    return (
      <div className={`py-3 text-sm space-y-1 ${muted ? "opacity-60" : ""}`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 space-y-0.5">
            {p.next && (
              <p className="text-sm text-muted-foreground">
                Próximo resumen ({periodLabel(p.year ?? null, p.month ?? null)})
              </p>
            )}
            {p.closing_date && (
              <p className="text-foreground">Cierre: <span className="font-medium">{shortDate(p.closing_date)}</span></p>
            )}
            {p.due_date && (
              <p className="text-foreground">Vencimiento: <span className="font-medium">{shortDate(p.due_date)}</span></p>
            )}
          </div>
          {stateBadge}
        </div>
      </div>
    );
  }

  // ── Faltantes: crear el ítem en el resumen ──
  if (klass === "missing") {
    const isARS = (p.currency ?? "ARS") === "ARS";
    const suggested = !!p.category_id && /^(suggest|rule)/.test(p.category_source ?? "");
    const picked = userPicked[action.id];
    const draft = descDraft[action.id] ?? p.description ?? "";
    const cuota = p.installment_number && p.installment_count
      ? ` · cuota ${p.installment_number}/${p.installment_count}` : "";
    return (
      <div className={`py-3 space-y-2 ${muted ? "opacity-60" : ""}`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {proposed ? (
              <input
                className={`${FIELD} mt-0 py-1.5`}
                value={draft}
                onChange={e => setDescDraft(prev => ({ ...prev, [action.id]: e.target.value }))}
                onBlur={() => {
                  if (draft.trim() && draft !== (p.description ?? "")) {
                    patchAction(action.id, { description: draft.trim() });
                  }
                }}
                aria-label="Descripción"
              />
            ) : (
              <p className="font-semibold text-[15.5px] text-foreground truncate">{p.description}</p>
            )}
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {p.date && shortDate(p.date)}
              {p.bank_description && p.bank_description !== p.description && ` · ${p.bank_description}`}
              {cuota}
            </p>
            {p.recurrence_id && (
              <p className="text-sm text-[#3B2FB3] mt-0.5">Es recurrente: vuelve a su serie y el mes que viene queda a confirmar.</p>
            )}
          </div>
          <p className="font-medium text-base tabular-nums shrink-0 pt-1.5">{ledgerAmount(p.amount ?? 0, p.currency)}</p>
          {stateBadge}
        </div>
        {proposed && isARS && (
          <div className="sm:max-w-xs space-y-1">
            <SelectField
              value={p.category_id != null ? String(p.category_id) : ""}
              placeholder="Categoría"
              options={categories.map(c => ({ value: String(c.id), label: c.name }))}
              onChange={v => {
                setUserPicked(prev => ({ ...prev, [action.id]: true }));
                patchAction(action.id, { category_id: Number(v), save_merchant_rule: !!ruleChecked[action.id] });
              }}
            />
            {suggested && !picked && (
              <p className="px-1 text-xs text-muted-foreground">
                {p.category_source === "suggest:ai" ? "sugerida por IA" : "sugerida"}
              </p>
            )}
            {picked && p.category_id != null && (
              <label className="flex items-center gap-2.5 min-h-[44px] px-1 text-sm text-[#3F3B4B] cursor-pointer">
                <input type="checkbox" checked={!!ruleChecked[action.id]}
                  className="w-[18px] h-[18px] accent-[#1C1B25] shrink-0"
                  onChange={e => {
                    const checked = e.target.checked;
                    setRuleChecked(prev => ({ ...prev, [action.id]: checked }));
                    // Marcarlo recién guarda la regla; desmarcarlo sólo deja de
                    // ofrecerla para los próximos cambios.
                    if (checked && p.category_id != null) {
                      patchAction(action.id, { category_id: p.category_id, save_merchant_rule: true });
                    }
                  }} />
                Recordar: este comercio → esta categoría
              </label>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Recurrentes que vinieron: confirmar con el monto del banco ──
  if (klass === "recurring") {
    const changed = p.amount != null && p.app_amount != null && Number(p.amount) !== Number(p.app_amount);
    return (
      <div className={`py-3 ${muted ? "opacity-60" : ""}`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[15.5px] text-foreground truncate">{p.app_description}</p>
            <p className="text-sm text-muted-foreground truncate">{p.bank_description}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-medium text-base tabular-nums">{ledgerAmount(p.amount ?? 0, p.currency)}</p>
            {changed && (
              <p className="text-sm text-muted-foreground tabular-nums">antes {ledgerAmount(p.app_amount!, p.currency)}</p>
            )}
          </div>
          {stateBadge}
        </div>
      </div>
    );
  }

  // ── Recurrentes que no vinieron: ¿el mes que viene sigue? ──
  if (klass === "recurring_absent") {
    const keep = p.keep_going !== false;
    return (
      <div className={`py-3 ${muted ? "opacity-60" : ""}`}>
        <div className="flex items-center gap-3 min-h-[44px]">
          <p className="flex-1 min-w-0 font-semibold text-[15.5px] text-foreground truncate">{p.description}</p>
          <p className="font-medium text-base tabular-nums shrink-0">{ledgerAmount(p.amount ?? 0, p.currency)}</p>
          {stateBadge}
        </div>
        {proposed ? (
          <div className="mt-1 space-y-1.5 sm:max-w-sm">
            <p className="text-sm text-muted-foreground">Este mes no vino. ¿Y el mes que viene?</p>
            <SegmentedToggle
              ariaLabel={`El mes que viene, ${p.description}`}
              value={keep ? "keep" : "end"}
              onChange={v => patchAction(action.id, { keep_going: v === "keep" })}
              options={[
                { value: "keep", label: "Sigue" },
                { value: "end", label: "Darlo de baja" },
              ]}
            />
          </div>
        ) : action.status === "applied" && (
          <p className="text-sm text-muted-foreground">{keep ? "Salteado: sigue el mes que viene." : "Dado de baja."}</p>
        )}
      </div>
    );
  }

  // ── Sobrantes: ítems cargados que el banco no muestra ──
  if (klass === "surplus") {
    return (
      <div className={`py-3 ${muted ? "opacity-60" : ""}`}>
        <div className="flex items-center gap-3 min-h-[44px]">
          <p className="flex-1 min-w-0 font-semibold text-[15.5px] text-foreground truncate">{p.description}</p>
          <p className="font-medium text-base tabular-nums shrink-0">{ledgerAmount(p.amount ?? 0, p.currency)}</p>
          {stateBadge}
        </div>
        {needsAppNote}
      </div>
    );
  }

  // ── Correcciones (rounding / amount_diff / double_count / usd_fix) ──
  const newAmount = p.updates?.amount;
  const newDesc = p.updates?.description;
  return (
    <div className={`py-3 ${muted ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15.5px] text-foreground truncate">
            {p.app_description}
            {newDesc && <span className="font-normal text-muted-foreground"> → {newDesc}</span>}
          </p>
          <p className="text-sm text-muted-foreground truncate">
            {p.bank_description}
            {p.bank_coupon && ` · cupón ${p.bank_coupon}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-medium text-base tabular-nums">
            {ledgerAmount(newAmount ?? p.app_amount ?? 0, p.currency)}
          </p>
          {newAmount != null && p.app_amount != null && (
            <p className="text-sm text-muted-foreground tabular-nums">antes {ledgerAmount(p.app_amount, p.currency)}</p>
          )}
        </div>
        {stateBadge}
      </div>
      {needsAppNote}
    </div>
  );
}

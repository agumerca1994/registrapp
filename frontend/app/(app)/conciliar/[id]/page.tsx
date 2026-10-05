"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { features } from "@/lib/features";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import { formatDate, getErrorMessage } from "@/lib/utils";
import { Check, ChevronLeft, CreditCard, Loader2, Plus, Undo2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { FIELD, SelectField } from "@/components/ui/form";
import {
  SummaryCard, SummaryHeader, SummarySection, SummaryGrid, SummaryCell,
  SummaryFigure, ChainRow,
} from "@/components/ui/summary-card";
import {
  fmtAmount, GROUP_LABELS, GROUP_NOUNS, periodLabel, STATUS_CHIP,
  type Action, type ApplyResult, type CurrencyTotals, type SessionDetail,
} from "../shared";

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }

const REASON_TEXTS: Record<string, string> = {
  no_parser: "Todavía no sé leer los resúmenes de este banco automáticamente.",
  totals_mismatch: "Leí el resumen pero las sumas no coinciden con los totales del banco, así que no propongo cambios.",
  encrypted: "El PDF tiene contraseña. Descargalo sin contraseña y volvé a subirlo.",
  no_text: "No pude extraer texto del archivo.",
};

/** La cadena de una moneda: diferencia, explicada, sin explicar. */
function TotalsChain({ currency, totals }: { currency: string; totals: CurrencyTotals }) {
  const unexplained = Number(totals.unexplained);
  return (
    <>
      <ChainRow label="Diferencia" value={fmtAmount(currency, totals.difference)} />
      <ChainRow label="Explicada" value={fmtAmount(currency, totals.explained)} />
      {unexplained === 0 ? (
        <p className="flex items-center gap-1 text-emerald-700 font-medium">
          <Check className="w-4 h-4 shrink-0" /> Explicada al centavo
        </p>
      ) : (
        <ChainRow label="Sin explicar" value={fmtAmount(currency, totals.unexplained)} strong />
      )}
    </>
  );
}

export default function ConciliarDetailPage() {
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
      if (d.propagated_future_cuotas) parts.push(`${d.propagated_future_cuotas} cuotas futuras propagadas`);
      setApplyMsg(prev => ({ ...prev, [klass]: parts.join(" · ") }));
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

  if (!features.reconcile) {
    return (
      <div className="max-w-4xl">
        <p className="text-sm text-muted-foreground">Esta función no está disponible.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl space-y-4">
        <Card variant="hero" className="h-36 animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-4xl space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <Button variant="outline" onClick={() => router.push("/tarjetas/resumenes")}>
          <ChevronLeft className="w-4 h-4" /> Volver a resúmenes
        </Button>
      </div>
    );
  }

  const period = periodLabel(session.period_year, session.period_month);
  const title = [session.bank, period].filter(Boolean).join(" · ") || "Resumen sin identificar";
  const chip = STATUS_CHIP[session.status] ?? { label: session.status, tone: "neutral" as const };

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
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/tarjetas/resumenes")} aria-label="Volver"
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl md:text-2xl font-display font-bold text-foreground truncate">Revisar resumen</h2>
          <p className="text-sm text-muted-foreground truncate">
            {title}
            {session.card_label && <span> · {session.card_label}</span>}
          </p>
        </div>
        <Chip tone={chip.tone} className="ml-auto shrink-0">{chip.label}</Chip>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      {/* ─── No se pudo leer ─────────────────────────────────────────────── */}
      {session.status === "needs_ai" && (
        <Card className="space-y-3">
          <p className="text-sm text-foreground">
            {REASON_TEXTS[session.reason ?? ""] ?? "No se pudo leer el resumen."}
          </p>
          {session.plan === "free" && (
            <div className="rounded-lg border border-border bg-accent/40 px-3 py-2.5 space-y-2">
              <p className="text-xs text-muted-foreground">
                Analizarlo con IA va a ser parte del plan Pro (próximamente).
              </p>
              {interested ? (
                <Button variant="outline" disabled>
                  <Check className="w-4 h-4" /> ¡Anotado! Te vamos a avisar.
                </Button>
              ) : (
                <Button variant="outline" onClick={sendInterest} disabled={sendingInterest}>
                  {sendingInterest && <Loader2 className="w-4 h-4 animate-spin" />} Me interesa
                </Button>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Mientras tanto podés{" "}
            <Link href="/tarjetas" className="text-primary font-medium hover:underline">
              cargarlo a mano en Tarjetas
            </Link>.
          </p>
        </Card>
      )}

      {/* ─── Falta elegir tarjeta o período ─────────────────────────────── */}
      {session.status === "needs_choice" && (
        <Card className="space-y-3">
          {session.choices?.cards && (
            <>
              <p className="text-sm font-medium text-foreground">¿De qué tarjeta es este resumen?</p>
              <div className="space-y-2">
                {session.choices.cards.map(c => (
                  <button key={c.card_id} type="button" onClick={() => setSelCard(c.card_id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left text-sm transition-colors ${
                      selCard === c.card_id ? "border-ink bg-accent" : "border-border hover:bg-accent/50"
                    }`}>
                    <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-medium text-foreground">{c.alias}</span>
                    <span className="text-muted-foreground shrink-0">
                      {c.bank}{c.last_4 && ` · ···· ${c.last_4}`}
                    </span>
                  </button>
                ))}
              </div>
              <button type="button"
                onClick={() => { setNewCardOpen(v => !v); setSelCard(null); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 border-dashed text-left text-sm transition-colors ${
                  newCardOpen ? "border-ink bg-accent" : "border-border hover:bg-accent/50"
                }`}>
                <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 font-medium text-foreground">
                  {session.choices.cards.length ? "Es otra tarjeta — crearla" : "Crear la tarjeta de este resumen"}
                </span>
              </button>
              {newCardOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={newCardAlias} onChange={e => setNewCardAlias(e.target.value)}
                    placeholder={`Alias (ej: ${session.bank ?? "Visa"} nueva)`} className={FIELD} />
                  <input value={newCardLast4} onChange={e => setNewCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="Últimos 4 dígitos (opcional)" inputMode="numeric" pattern="[0-9]*" className={FIELD} />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={saveCardRule} onChange={e => setSaveCardRule(e.target.checked)}
                  className="w-4 h-4 accent-primary shrink-0" />
                Recordar esta tarjeta para este resumen
              </label>
            </>
          )}
          {session.choices?.statements && (
            <>
              <p className="text-sm font-medium text-foreground">¿A qué resumen corresponde?</p>
              <div className="space-y-2">
                {session.choices.statements.map(s => (
                  <button key={s.statement_id} type="button" onClick={() => setSelStmt(s.statement_id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left text-sm transition-colors ${
                      selStmt === s.statement_id ? "border-ink bg-accent" : "border-border hover:bg-accent/50"
                    }`}>
                    <span className="flex-1 min-w-0 truncate font-medium text-foreground first-letter:uppercase">
                      {periodLabel(s.year, s.month)}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {s.item_count === 1 ? "1 ítem" : `${s.item_count} ítems`}
                      {s.closing_date && ` · cierre ${formatDate(s.closing_date)}`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex justify-end pt-1">
            <Button onClick={confirmChoice}
              disabled={choosing || (selCard == null && selStmt == null && !(newCardOpen && newCardAlias.trim()))}>
              {choosing && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Revisión: hero + grupos ────────────────────────────────────── */}
      {inReview && (
        <>
          {session.totals && (
            <SummaryCard>
              <SummaryHeader title={`Revisar resumen · ${title}`}
                open={showDetail} onToggle={() => setShowDetail(v => !v)} />
              {(["ARS", "USD"] as const).map(cur => {
                const totals = session.totals?.[cur];
                if (!totals) return null;
                return (
                  // Cada moneda cierra por su lado — los totales nunca se suman.
                  <div key={cur}>
                    <SummarySection label={cur === "ARS" ? "En pesos" : "En dólares"} />
                    <SummaryGrid cols={2}>
                      <SummaryCell figure>
                        <SummaryFigure value={fmtAmount(cur, totals.bank_total)} sub="Banco" />
                      </SummaryCell>
                      <SummaryCell figure className="border-t sm:border-t-0 sm:border-l border-border/60">
                        <SummaryFigure value={fmtAmount(cur, totals.app_total)} sub="RegistrApp" />
                      </SummaryCell>
                      {showDetail && (
                        <SummaryCell className="border-t border-border/60 sm:col-span-2">
                          <TotalsChain currency={cur} totals={totals} />
                        </SummaryCell>
                      )}
                    </SummaryGrid>
                  </div>
                );
              })}
            </SummaryCard>
          )}

          {session.status === "unexplained" && (
            <Card className="border-amber-200 bg-amber-50">
              <p className="text-sm text-amber-900 font-medium">
                La diferencia no queda explicada al centavo. Revisá los grupos con cuidado antes de aplicar.
              </p>
            </Card>
          )}

          {session.group_order.map(klass => {
            const actions = visibleActions(klass);
            if (actions.length === 0) return null;
            const pending = proposedCount(klass);
            return (
              <Card key={klass} className="p-0 md:p-0">
                <div className="flex items-center gap-2 px-4 md:px-5 pt-4">
                  <h3 className="font-semibold text-foreground text-sm md:text-base">
                    {GROUP_LABELS[klass] ?? klass}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {actions.length === 1 ? "1 ítem" : `${actions.length} ítems`}
                  </span>
                </div>
                <div className="divide-y mt-2">
                  {actions.map(a => (
                    <ActionRow key={a.id} klass={klass} action={a} categories={categories}
                      descDraft={descDraft} setDescDraft={setDescDraft}
                      ruleChecked={ruleChecked} setRuleChecked={setRuleChecked}
                      userPicked={userPicked} setUserPicked={setUserPicked}
                      patchAction={patchAction} />
                  ))}
                </div>
                <div className="px-4 md:px-5 py-3 border-t bg-muted/40 rounded-b-2xl flex items-center gap-3 flex-wrap">
                  <Button onClick={() => applyGroup(klass)} disabled={applying !== null || pending === 0}>
                    {applying === klass && <Loader2 className="w-4 h-4 animate-spin" />}
                    Aplicar grupo ({pending})
                  </Button>
                  {applyMsg[klass] && (
                    <p className="text-xs text-muted-foreground">{applyMsg[klass]}</p>
                  )}
                </div>
              </Card>
            );
          })}

          {(anyApplied || pendingParts.length > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
              {anyApplied && (
                <Button variant="outline" onClick={undoLast} disabled={undoing}>
                  {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                  Deshacer último grupo
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
function ActionRow({ klass, action, categories, descDraft, setDescDraft, ruleChecked, setRuleChecked, userPicked, setUserPicked, patchAction }: {
  klass: string;
  action: Action;
  categories: Category[];
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
  const muted = !proposed;

  const stateBadge = action.status === "needs_app" ? (
    <Chip locked className="shrink-0">Corregir en la app</Chip>
  ) : action.status === "applied" ? (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium shrink-0">
      <Check className="w-3.5 h-3.5" /> Aplicado
    </span>
  ) : null;

  // ── Fechas del resumen ──
  if (klass === "dates") {
    return (
      <div className={`px-4 md:px-5 py-3 text-sm space-y-1 ${muted ? "opacity-60" : ""}`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 space-y-0.5">
            {p.closing_date && (
              <p className="text-foreground">Fecha de cierre → <span className="font-medium">{formatDate(p.closing_date)}</span></p>
            )}
            {p.due_date && (
              <p className="text-foreground">Vencimiento → <span className="font-medium">{formatDate(p.due_date)}</span></p>
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
      <div className={`px-4 md:px-5 py-3 space-y-2 ${muted ? "opacity-60" : ""}`}>
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
              <p className="text-sm font-medium text-foreground truncate">{p.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {p.date && formatDate(p.date)}
              {p.bank_description && p.bank_description !== p.description && ` · ${p.bank_description}`}
              {cuota}
            </p>
          </div>
          <p className="text-sm font-bold tabular-nums shrink-0 pt-1.5">{fmtAmount(p.currency, p.amount ?? 0)}</p>
          {stateBadge}
          {proposed && (
            <button onClick={() => patchAction(action.id, { discard: true })}
              aria-label="Descartar" title="Descartar este ítem"
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-600 transition-colors shrink-0">
              <X className="w-4 h-4" />
            </button>
          )}
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
              <p className="text-[11px] text-muted-foreground">sugerida</p>
            )}
            {picked && p.category_id != null && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={!!ruleChecked[action.id]}
                  className="w-4 h-4 accent-primary shrink-0"
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

  // ── Sobrantes: ítems cargados que el banco no muestra ──
  if (klass === "surplus") {
    return (
      <div className={`px-4 md:px-5 py-3 flex items-center gap-3 ${muted ? "opacity-60" : ""}`}>
        <p className="flex-1 min-w-0 text-sm text-foreground truncate">{p.description}</p>
        <p className="text-sm font-bold tabular-nums shrink-0">{fmtAmount(p.currency, p.amount ?? 0)}</p>
        {stateBadge}
      </div>
    );
  }

  // ── Correcciones (rounding / amount_diff / double_count / usd_fix) ──
  const newAmount = p.updates?.amount;
  const newDesc = p.updates?.description;
  return (
    <div className={`px-4 md:px-5 py-3 flex items-start gap-3 ${muted ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">
          {p.app_description}
          {newDesc && <span className="text-muted-foreground"> → {newDesc}</span>}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {p.bank_description}
          {p.bank_coupon && ` · cupón ${p.bank_coupon}`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold tabular-nums">
          {fmtAmount(p.currency, newAmount ?? p.app_amount ?? 0)}
        </p>
        {newAmount != null && p.app_amount != null && (
          <p className="text-xs text-muted-foreground tabular-nums">antes {fmtAmount(p.currency, p.app_amount)}</p>
        )}
      </div>
      {stateBadge}
    </div>
  );
}

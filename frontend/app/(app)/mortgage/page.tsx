"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format, getDaysInMonth, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, Home, Loader2, MoreVertical, Pencil, Trash2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatARSRound, getErrorMessage, parseAmount } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { FIELD, FormGrid, MonthField, SegmentedToggle } from "@/components/ui/form";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { BLOCK, GLASS } from "@/components/ui/glass";
import { EntrySheet, SheetRow } from "@/components/movimientos/EntrySheet";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { LedgerRow, ledgerAmount } from "@/components/movimientos/Ledger";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MortgageLoan {
  id: number;
  loan_type: string;
  description: string | null;
  loan_number: string | null;
  total_cuotas: number;
  first_payment_date: string;
  payment_day: number | null;
  cuota_uva: number | null;
  cuota_pesos: number | null;
  tna: number | null;
  original_capital_uva: number | null;
  is_active: boolean;
}

interface MortgageSummary {
  loan: MortgageLoan;
  cuota_numero: number;
  cuotas_restantes: number;
  pct_completado: number;
  cuota_uva: number | null;
  latest_uva_value: number | null;
  latest_uva_date: string | null;
  cuota_pesos_calculado: number | null;
  paid_this_month: boolean;
  mortgage_record_id: number | null;
  next_payment_date: string;
}

interface MortgageRecord {
  id: number;
  period_date: string;
  payment_amount: number;
  capital: number | null;
  interest: number | null;
  uva_units: number | null;
  mortgage_loan_id: number | null;
  expense_entry_id: number | null;
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  uva_frances:   "UVA Sistema Francés",
  uva_aleman:    "UVA Sistema Alemán",
  tasa_fija:     "Tasa fija en pesos",
  tasa_variable: "Tasa variable",
};

const LOAN_TYPE_DESC: Record<string, string> = {
  uva_frances:   "Cuota fija en UVAs; en pesos varía con el valor de la UVA",
  uva_aleman:    "Capital fijo en UVAs por cuota; el interés baja cada mes",
  tasa_fija:     "Cuota fija en pesos, sin ajuste por inflación",
  tasa_variable: "La cuota no se registra sola, porque su monto no se puede prever",
};

const EMPTY_FORM = {
  loan_type: "",
  description: "",
  loan_number: "",
  total_cuotas: "240",
  first_payment_date: "",
  payment_day_mode: "biz" as "biz" | "fixed",
  payment_day: "",
  cuota_uva: "",
  cuota_pesos: "",
  tna: "",
  original_capital_uva: "",
};

function fmtDate(iso: string) {
  try { return format(parseISO(iso), "d MMM yyyy", { locale: es }).replace(".", ""); }
  catch { return iso; }
}

function fmtDecimal(v: number | string | null | undefined): string {
  if (v == null) return "";
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
}

// Por parseAmount y no por parseFloat: "150.000" son ciento cincuenta mil, no 150.
function parseDecimalInput(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseAmount(v);
  return n > 0 ? n : null;
}

const LABEL = "text-xs font-medium text-muted-foreground";
const MENU_ITEM = "flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-accent w-full outline-none cursor-pointer";
const OPTION = "w-full text-left rounded-[22px] bg-white/70 border border-white/80 p-3.5 hover:bg-white transition-colors active:scale-[0.99] disabled:opacity-50";

// ── Formulario ─────────────────────────────────────────────────────────────────

// Los dos pasos del alta comparten este padre, así uno se funde con el otro.
const LOAN_STEP = "flex-1 min-h-0 flex flex-col";

function LoanConfigModal({ editLoan, onClose, onSaved }: {
  editLoan: MortgageLoan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(editLoan ? 2 : 1);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    loan_type: editLoan?.loan_type ?? "",
    description: editLoan?.description ?? "",
    loan_number: editLoan?.loan_number ?? "",
    total_cuotas: String(editLoan?.total_cuotas ?? 240),
    // MonthField needs YYYY-MM, strip the day part if coming from API
    first_payment_date: editLoan?.first_payment_date?.substring(0, 7) ?? "",
    payment_day_mode: (editLoan?.payment_day != null ? "fixed" : "biz") as "biz" | "fixed",
    payment_day: editLoan?.payment_day != null ? String(editLoan.payment_day) : "",
    cuota_uva: fmtDecimal(editLoan?.cuota_uva ?? null),
    cuota_pesos: fmtDecimal(editLoan?.cuota_pesos ?? null),
    tna: fmtDecimal(editLoan?.tna ?? null),
    // Se precarga: el PATCH manda este campo, y vacío borraría el que ya estaba.
    original_capital_uva: fmtDecimal(editLoan?.original_capital_uva ?? null),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const isUva = form.loan_type === "uva_frances" || form.loan_type === "uva_aleman";
  const paymentDay = form.payment_day_mode === "fixed" && form.payment_day ? parseInt(form.payment_day) : null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLoan && !form.first_payment_date) { setError("Elegí el mes de la primera cuota."); return; }
    if (form.payment_day_mode === "fixed" && !paymentDay) { setError("Decime qué día del mes se paga."); return; }
    setError("");
    setSaving(true);
    try {
      const cuotaUva = isUva ? parseDecimalInput(form.cuota_uva) : null;
      const cuotaPesos = form.loan_type === "tasa_fija" ? parseDecimalInput(form.cuota_pesos) : null;
      const tna = parseDecimalInput(form.tna);
      const origCapital = parseDecimalInput(form.original_capital_uva);

      if (editLoan) {
        await api.patch(`/mortgage/loans/${editLoan.id}`, {
          description: form.description || null,
          loan_number: form.loan_number || null,
          payment_day: paymentDay,
          cuota_uva: cuotaUva,
          cuota_pesos: cuotaPesos,
          tna,
          original_capital_uva: origCapital,
        });
      } else {
        await api.post("/mortgage/loans", {
          loan_type: form.loan_type,
          description: form.description || null,
          loan_number: form.loan_number || null,
          total_cuotas: parseInt(form.total_cuotas),
          first_payment_date: form.first_payment_date + "-01",  // YYYY-MM → YYYY-MM-01
          payment_day: paymentDay,
          cuota_uva: cuotaUva,
          cuota_pesos: cuotaPesos,
          tna,
          original_capital_uva: origCapital,
        });
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "No se pudo guardar la hipoteca. Probá de nuevo."));
    } finally {
      setSaving(false);
    }
  };

  if (step === 1) {
    return (
      <FormSheet title="¿Qué tipo de crédito es?" onClose={onClose}>
        <MotionList className={LOAN_STEP}>
        <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 space-y-2">
          {Object.entries(LOAN_TYPE_LABELS).map(([type, label]) => (
            <button key={type} type="button" className={OPTION}
              onClick={() => { setForm(p => ({ ...p, loan_type: type })); setStep(2); }}>
              <span className="block text-[15.5px] font-semibold text-foreground">{label}</span>
              <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">{LOAN_TYPE_DESC[type]}</span>
            </button>
          ))}
        </div>
        </MotionList>
      </FormSheet>
    );
  }

  return (
    <FormSheet title={editLoan ? "Editar hipoteca" : "Configurar hipoteca"} onClose={onClose}>
      <MotionList className={LOAN_STEP}>
      <form onSubmit={handleSave} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          {!editLoan && (
            <div className="flex items-center gap-2 px-1">
              <Chip tone="violet">{LOAN_TYPE_LABELS[form.loan_type]}</Chip>
              <button type="button" onClick={() => setStep(1)} className="min-h-[36px] px-1 text-sm font-medium text-[#3B2FB3] underline-offset-2 hover:underline">
                Cambiar
              </button>
            </div>
          )}

          {form.loan_type === "tasa_fija" && (
            <AmountField label="Cuota mensual" currency="ARS" required
              value={form.cuota_pesos} onChange={f("cuota_pesos")} />
          )}

          {isUva && (
            <div>
              <label className={LABEL}>Cuota en UVAs</label>
              <input type="text" inputMode="decimal" required placeholder="ej: 750,74" aria-label="Cuota en UVAs"
                value={form.cuota_uva} onChange={f("cuota_uva")} className={`${FIELD} tabular-nums`} />
            </div>
          )}

          <FormGrid>
            {!editLoan && (
              <>
                <div>
                  <label className={LABEL}>Primera cuota</label>
                  <MonthField required
                    value={form.first_payment_date}
                    onChange={v => setForm(p => ({ ...p, first_payment_date: v }))} />
                </div>
                <div>
                  <label className={LABEL}>Cantidad de cuotas</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" required aria-label="Cantidad de cuotas"
                    value={form.total_cuotas} onChange={f("total_cuotas")} className={`${FIELD} tabular-nums`} />
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <label className={LABEL}>Fecha de pago de la cuota</label>
              <SegmentedToggle
                ariaLabel="Fecha de pago de la cuota" className="mt-1"
                value={form.payment_day_mode}
                onChange={mode => setForm(p => ({ ...p, payment_day_mode: mode, payment_day: mode === "biz" ? "" : p.payment_day }))}
                options={[{ value: "biz", label: "Primer día hábil" }, { value: "fixed", label: "Día específico" }]}
              />
              {form.payment_day_mode === "fixed" ? (
                <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder="ej: 10" aria-label="Día de pago"
                  value={form.payment_day} onChange={f("payment_day")} className={`${FIELD} mt-2 tabular-nums`} />
              ) : (
                <p className="px-1.5 mt-1.5 text-sm leading-snug text-[#4A4658]">
                  Si el 1° cae sábado o domingo, se usa el lunes siguiente.
                </p>
              )}
            </div>

            {isUva && (
              <>
                <div>
                  <label className={LABEL}>TNA % (opcional)</label>
                  <input type="text" inputMode="decimal" placeholder="ej: 8,50" aria-label="TNA"
                    value={form.tna} onChange={f("tna")} className={`${FIELD} tabular-nums`} />
                </div>
                <div>
                  <label className={LABEL}>Capital original en UVAs (opcional)</label>
                  <input type="text" inputMode="decimal" placeholder="Para separar capital e interés" aria-label="Capital original en UVAs"
                    value={form.original_capital_uva} onChange={f("original_capital_uva")} className={`${FIELD} tabular-nums`} />
                </div>
              </>
            )}

            <div>
              <label className={LABEL}>Banco (opcional)</label>
              <input type="text" placeholder="ej: Banco Nación" aria-label="Banco"
                value={form.description} onChange={f("description")} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>N° de préstamo (opcional)</label>
              <input type="text" aria-label="N° de préstamo"
                value={form.loan_number} onChange={f("loan_number")} className={FIELD} />
            </div>
          </FormGrid>

          {error && <p role="alert" className="px-1.5 text-sm text-destructive">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label={editLoan ? "Guardar cambios" : "Activar hipoteca"} />
      </form>
      </MotionList>
    </FormSheet>
  );
}

// ── Eliminar la hipoteca ───────────────────────────────────────────────────────

function DeleteLoanModal({ loanId, onClose, onDeleted }: {
  loanId: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async (keepHistory: boolean) => {
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/mortgage/loans/${loanId}?keep_history=${keepHistory}`);
      onDeleted();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo eliminar la hipoteca. Probá de nuevo."));
      setDeleting(false);
    }
  };

  return (
    <FormSheet title="Eliminar hipoteca" onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 space-y-2">
        <p className="px-1.5 pb-1 text-[15px] text-[#4A4658]">¿Qué querés hacer con el historial de cuotas pagadas?</p>
        <button type="button" disabled={deleting} onClick={() => handleDelete(true)} className={OPTION}>
          <span className="block text-[15.5px] font-semibold text-foreground">Mantener el historial</span>
          <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">
            Se eliminan los datos de la hipoteca pero se conservan los egresos y el historial de pagos.
          </span>
        </button>
        <button type="button" disabled={deleting} onClick={() => handleDelete(false)} className={OPTION}>
          <span className="block text-[15.5px] font-semibold text-destructive">Eliminar todo</span>
          <span className="block mt-0.5 text-sm leading-snug text-[#4A4658]">
            Se eliminan la hipoteca, todos los registros de cuotas y los egresos generados automáticamente.
          </span>
        </button>
        {deleting && (
          <p className="flex items-center gap-2 px-1.5 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Eliminando…
          </p>
        )}
        {error && <p role="alert" className="px-1.5 text-sm text-destructive">{error}</p>}
      </div>
    </FormSheet>
  );
}

// ── La ficha de una cuota ──────────────────────────────────────────────────────

/** Una cuota registrada no se edita (no hay cómo en el backend): sólo se borra, y pregunta ahí mismo. */
function RecordSheet({ record, date, onClose }: {
  record: MortgageRecord;
  date: string;
  onClose: () => void;
}) {
  return (
    <EntrySheet date={date}
      title={`Cuota de ${format(parseISO(record.period_date), "MMMM yyyy", { locale: es })}`}
      amount={formatARS(record.payment_amount)}
      onClose={onClose}>
      {record.uva_units != null && Number(record.uva_units) > 0 && (
        <SheetRow label="UVAs"><span className="tabular-nums">{fmtDecimal(record.uva_units)}</span></SheetRow>
      )}
      {record.capital != null && Number(record.capital) > 0 && (
        <SheetRow label="Capital"><span className="tabular-nums">{formatARS(record.capital)}</span></SheetRow>
      )}
      {record.interest != null && Number(record.interest) > 0 && (
        <SheetRow label="Interés"><span className="tabular-nums">{formatARS(record.interest)}</span></SheetRow>
      )}
      {!record.mortgage_loan_id && <SheetRow label="Origen">Cargada a mano</SheetRow>}
    </EntrySheet>
  );
}

// ── Pantalla ───────────────────────────────────────────────────────────────────

export default function MortgagePage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const reaccionar = useReaccion();
  const [loans, setLoans] = useState<MortgageLoan[]>([]);
  const [summary, setSummary] = useState<MortgageSummary | null>(null);
  const [records, setRecords] = useState<MortgageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [editLoan, setEditLoan] = useState<MortgageLoan | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [viewing, setViewing] = useState<MortgageRecord | null>(null);

  const activeLoan = loans.find(l => l.is_active) ?? null;

  const load = useCallback(async () => {
    try {
      const [loansRes, recordsRes] = await Promise.all([
        api.get("/mortgage/loans"),
        api.get("/mortgage"),
      ]);
      setLoans(loansRes.data);
      setRecords(recordsRes.data);
      const active = (loansRes.data as MortgageLoan[]).find(l => l.is_active);
      if (active) {
        const sumRes = await api.get(`/mortgage/loans/${active.id}/summary`);
        setSummary(sumRes.data);
      } else {
        setSummary(null);
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => { reload(); }, [reload]);

  // La cuota se guarda con el 1° del mes, pero sale el día de pago: es la fecha de su egreso.
  const paidOn = (r: MortgageRecord) => {
    const day = activeLoan?.payment_day;
    if (!day || r.mortgage_loan_id !== activeLoan?.id) return r.period_date;
    const d = parseISO(r.period_date);
    return format(new Date(d.getFullYear(), d.getMonth(), Math.min(day, getDaysInMonth(d))), "yyyy-MM-dd");
  };

  if (loading && loans.length === 0 && !failed) {
    return (
      <div className="space-y-4" aria-busy="true">
        <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Hipoteca</h1>
        <div className={`${BLOCK} h-[220px] animate-pulse`}><span className="sr-only">Cargando tu hipoteca</span></div>
      </div>
    );
  }

  const isVariable = summary?.loan.loan_type === "tasa_variable";
  const isUvaLoan = summary?.cuota_uva != null;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Hipoteca</h1>
          {activeLoan?.description && (
            <p className="text-sm text-muted-foreground truncate">{activeLoan.description}</p>
          )}
        </div>
        {activeLoan && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button title="Más acciones" aria-label="Más acciones"
                className="w-11 h-11 -mr-2 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
                <MoreVertical className="w-5 h-5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="rounded-[22px] border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota p-1.5 animate-fade-in w-48 z-50">
                <DropdownMenu.Item asChild><PrivacyMenuItem /></DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <button onClick={() => { setEditLoan(activeLoan); setShowConfig(true); }} className={`${MENU_ITEM} text-foreground`}>
                    <Pencil className="w-4 h-4 text-muted-foreground" /> Editar hipoteca
                  </button>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-border my-1" />
                <DropdownMenu.Item asChild>
                  <button onClick={() => setShowDelete(true)} className={`${MENU_ITEM} text-destructive`}>
                    <Trash2 className="w-4 h-4" /> Eliminar hipoteca
                  </button>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>

      {failed && (
        <div role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-900">
          <p>No pudimos traer tu hipoteca. Tus datos están bien: fijate si tenés conexión.</p>
          <button onClick={reload} className="mt-1 font-semibold underline">Probar de nuevo</button>
        </div>
      )}

      {!activeLoan && !failed && (
        <section className="px-2 pt-2">
          <Home className="w-8 h-8 text-[#3B2FB3]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-3 text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">No tenés ninguna hipoteca configurada</p>
          <p className="mt-1 text-[15.5px] leading-snug text-muted-foreground">
            Cargá los datos del crédito y cada mes la cuota se registra sola, con su egreso.
          </p>
          <button onClick={() => { setEditLoan(null); setShowConfig(true); }}
            className="mt-4 h-[52px] px-6 rounded-full bg-ink text-background font-semibold text-[15.5px] active:scale-[0.98] transition-transform duration-100">
            Configurar hipoteca
          </button>
        </section>
      )}

      {summary && (
        <section className={BLOCK}>
          <div className="px-2.5">
            <p className="text-[16.5px] font-medium">Cuota {summary.cuota_numero} de {summary.loan.total_cuotas}</p>
            {summary.cuota_pesos_calculado ? (
              <p className="font-medium leading-[1.08] tracking-[-0.045em] tabular-nums text-[clamp(2.5rem,13vw,3.5rem)]">
                {formatARSRound(summary.cuota_pesos_calculado)}
              </p>
            ) : isUvaLoan ? (
              <p className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.025em]">
                Todavía no hay valor de la UVA para pasar la cuota a pesos.
              </p>
            ) : null}
            {isUvaLoan && (
              <p className="mt-1.5 text-[15.5px] leading-snug tabular-nums">{fmtDecimal(summary.cuota_uva)} UVAs</p>
            )}

            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(summary.pct_completado, 100)}
              aria-label="Cuotas pagadas" className="mt-3.5 h-2 rounded-full bg-[rgba(20,14,70,0.32)] overflow-hidden">
              <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(summary.pct_completado, 100)}%` }} />
            </div>
            <p className="mt-1.5 text-sm">{summary.cuotas_restantes} restantes · {Number(summary.pct_completado).toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de las cuotas</p>
          </div>

          <MotionList className={`mt-3.5 ${GLASS}`}>
            <div className="px-4 pt-3 pb-1 text-[15px] leading-snug">
              {summary.paid_this_month ? (
                <>
                  <p className="font-semibold">Cuota de {format(new Date(), "MMMM", { locale: es })} registrada</p>
                  <p>Próxima: {fmtDate(summary.next_payment_date)}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Próxima cuota: {fmtDate(summary.next_payment_date)}</p>
                  {isVariable ? (
                    <p>
                      No se registra sola, porque el monto cambia.{" "}
                      <Link href="/expenses?nuevo=1" className="font-semibold underline">Cargala como egreso</Link> cuando lo sepas.
                    </p>
                  ) : <p>Se registra sola.</p>}
                </>
              )}
            </div>
            <button onClick={() => setShowDetail(v => !v)} aria-expanded={showDetail}
              className="w-full min-h-[44px] px-4 flex items-center justify-between gap-3 text-[15px] font-medium">
              {showDetail ? "Ver menos" : "Ver detalle"}
              <ChevronDown className={`w-[18px] h-[18px] transition-transform ${showDetail ? "rotate-180" : ""}`} />
            </button>
            {showDetail && (
              <div className="px-4 pb-1 divide-y divide-white/[0.18] border-t border-white/[0.18] text-[15px]">
                {[
                  ["Tipo", LOAN_TYPE_LABELS[summary.loan.loan_type] ?? summary.loan.loan_type],
                  ["Primera cuota", fmtDate(summary.loan.first_payment_date)],
                  ["Día de pago", summary.loan.payment_day != null ? `Día ${summary.loan.payment_day}` : "Primer día hábil"],
                  summary.cuota_pesos_calculado ? ["Cuota exacta", formatARS(summary.cuota_pesos_calculado)] : null,
                  summary.latest_uva_value && isUvaLoan
                    ? [`UVA al ${summary.latest_uva_date ? fmtDate(summary.latest_uva_date) : "último dato"}`, formatARS(summary.latest_uva_value)]
                    : null,
                  summary.loan.tna != null ? ["TNA", `${fmtDecimal(summary.loan.tna)}%`] : null,
                  summary.loan.loan_number ? ["N° de préstamo", summary.loan.loan_number] : null,
                ].filter((row): row is string[] => !!row).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 py-2">
                    <span className="min-w-0">{label}</span>
                    <span className="tabular-nums text-right">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </MotionList>
        </section>
      )}

      {records.length > 0 && (
        <section className="px-2">
          <h2 className="mb-1 text-[22px] font-medium tracking-[-0.03em] text-foreground">Cuotas registradas</h2>
          <div>
            {records.map(r => {
              const bits = [
                r.uva_units ? `${fmtDecimal(r.uva_units)} UVAs` : null,
                !r.mortgage_loan_id ? "Cargada a mano" : null,
              ].filter(Boolean).join(" · ");
              return (
                <LedgerRow key={r.id}
                  date={paidOn(r)}
                  title={`Cuota de ${format(parseISO(r.period_date), "MMMM", { locale: es })}`}
                  sub={bits || undefined}
                  amount={ledgerAmount(r.payment_amount)}
                  onOpen={() => setViewing(r)}
                />
              );
            })}
          </div>
        </section>
      )}

      {viewing && (
        <RecordSheet record={viewing} date={paidOn(viewing)}
          onClose={() => setViewing(null)} />
      )}

      {showConfig && (
        <LoanConfigModal
          editLoan={editLoan}
          onClose={() => { setShowConfig(false); setEditLoan(null); }}
          onSaved={() => { reload(); reaccionar("guardado", "Hipoteca guardada"); }}
        />
      )}

      {showDelete && activeLoan && (
        <DeleteLoanModal
          loanId={activeLoan.id}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { reload(); reaccionar("borrado", "Hipoteca eliminada"); }}
        />
      )}
    </div>
  );
}

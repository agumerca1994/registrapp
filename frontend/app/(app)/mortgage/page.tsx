"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { formatARS, formatDate } from "@/lib/utils";
import { Settings2, X, Loader2, Home, Trash2, CalendarDays } from "lucide-react";

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
  uva_frances:   "Cuota fija en UVAs, el monto en pesos varía con el índice UVA",
  uva_aleman:    "Capital fijo en UVAs por cuota, interés decrece cada mes",
  tasa_fija:     "Cuota fija en pesos, sin ajuste por inflación",
  tasa_variable: "Sin auto-registro (tipo sin monto predecible)",
};

const EMPTY_FORM = {
  loan_type: "",
  description: "",
  loan_number: "",
  total_cuotas: "",
  first_payment_date: "",
  payment_day_mode: "biz" as "biz" | "fixed",
  payment_day: "",
  cuota_uva: "",
  cuota_pesos: "",
  tna: "",
  original_capital_uva: "",
};

function fmtDate(iso: string) {
  try { return format(parseISO(iso), "d MMM yyyy", { locale: es }); }
  catch { return iso; }
}

function fmtDecimal(v: number | null | undefined): string {
  if (v == null) return "";
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function parseDecimalInput(v: string): number | null {
  if (!v.trim()) return null;
  const n = v.includes(",")
    ? parseFloat(v.replace(/\./g, "").replace(",", "."))
    : parseFloat(v);
  return isNaN(n) ? null : n;
}

// ── Config Modal ───────────────────────────────────────────────────────────────

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
    total_cuotas: editLoan?.total_cuotas != null ? String(editLoan.total_cuotas) : "",
    // type="month" needs YYYY-MM, strip the day part if coming from API
    first_payment_date: editLoan?.first_payment_date?.substring(0, 7) ?? "",
    payment_day_mode: (editLoan?.payment_day != null ? "fixed" : "biz") as "biz" | "fixed",
    payment_day: editLoan?.payment_day != null ? String(editLoan.payment_day) : "",
    cuota_uva: fmtDecimal(editLoan?.cuota_uva ?? null),
    cuota_pesos: fmtDecimal(editLoan?.cuota_pesos ?? null),
    tna: fmtDecimal(editLoan?.tna ?? null),
    original_capital_uva: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const isUva = form.loan_type === "uva_frances" || form.loan_type === "uva_aleman";
  const paymentDay = form.payment_day_mode === "fixed" && form.payment_day ? parseInt(form.payment_day) : null;

  const handleSave = async () => {
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
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "mt-1 w-full border rounded-lg px-3 py-2 text-[16px] sm:text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      {/* Modal: flex-col with fixed header + scrollable body + fixed footer */}
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md flex flex-col max-h-[90dvh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fijo */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b shrink-0">
          <h3 className="font-semibold text-gray-900">
            {editLoan ? "Editar hipoteca" : step === 1 ? "Tipo de hipoteca" : "Configurar hipoteca"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrolleable, sin overflow horizontal */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
          {step === 1 && (
            <div className="space-y-2">
              {Object.entries(LOAN_TYPE_LABELS).map(([type, label]) => (
                <button
                  key={type}
                  onClick={() => { setForm(p => ({ ...p, loan_type: type })); setStep(2); }}
                  className="w-full text-left border rounded-xl p-3.5 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{LOAN_TYPE_DESC[type]}</p>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {!editLoan && (
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                    {LOAN_TYPE_LABELS[form.loan_type]}
                  </span>
                  <button onClick={() => setStep(1)} className="text-xs text-blue-600 hover:underline">
                    Cambiar
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!editLoan && (
                  <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">Primera cuota *</label>
                      <div className="relative mt-1">
                        <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <input
                          type="month" required
                          value={form.first_payment_date} onChange={f("first_payment_date")}
                          className="w-full min-w-0 border rounded-lg pl-9 pr-2 py-2 text-[16px] sm:text-sm bg-white text-gray-900"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Cant. cuotas *</label>
                      <input
                        type="number" min={1} required
                        value={form.total_cuotas} onChange={f("total_cuotas")}
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-600">Fecha de pago de la cuota</label>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setForm(p => ({ ...p, payment_day_mode: "biz", payment_day: "" }))}
                      className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${form.payment_day_mode === "biz" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                    >
                      Primer día hábil
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(p => ({ ...p, payment_day_mode: "fixed" }))}
                      className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${form.payment_day_mode === "fixed" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                    >
                      Día específico
                    </button>
                  </div>
                  {form.payment_day_mode === "fixed" ? (
                    <input
                      type="number" min={1} max={28}
                      value={form.payment_day} onChange={f("payment_day")}
                      className={inputCls + " mt-2"}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Si el 1° cae sábado o domingo, se usa el lunes siguiente.
                    </p>
                  )}
                </div>

                {isUva && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Cuota en UVAs *</label>
                    <input
                      type="text" inputMode="decimal" required
                      value={form.cuota_uva} onChange={f("cuota_uva")}
                      className={inputCls}
                    />
                  </div>
                )}

                {form.loan_type === "tasa_fija" && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Cuota mensual ($) *</label>
                    <input
                      type="text" inputMode="decimal" required
                      value={form.cuota_pesos} onChange={f("cuota_pesos")}
                      className={inputCls}
                    />
                  </div>
                )}

                {isUva && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-gray-600">TNA % (opcional)</label>
                      <input
                        type="text" inputMode="decimal"
                        value={form.tna} onChange={f("tna")}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Capital original en UVAs (opcional)</label>
                      <input
                        type="text" inputMode="decimal"
                        value={form.original_capital_uva} onChange={f("original_capital_uva")}
                        className={inputCls}
                      />
                    </div>
                  </>
                )}

                <div className={isUva ? "sm:col-span-2" : ""}>
                  <label className="text-xs font-medium text-gray-600">Banco (opcional)</label>
                  <input
                    type="text"
                    value={form.description} onChange={f("description")}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600">N° de préstamo (opcional)</label>
                  <input
                    type="text"
                    value={form.loan_number} onChange={f("loan_number")}
                    className={inputCls}
                  />
                </div>
              </div>

              {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full mt-2 bg-gray-900 text-white px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editLoan ? "Guardar cambios" : "Activar hipoteca"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation modal ──────────────────────────────────────────────────

function DeleteLoanModal({ loanId, onClose, onDeleted }: {
  loanId: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (keepHistory: boolean) => {
    setDeleting(true);
    try {
      await api.delete(`/mortgage/loans/${loanId}?keep_history=${keepHistory}`);
      onDeleted();
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Eliminar hipoteca</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-600">¿Qué querés hacer con el historial de cuotas pagadas?</p>
        <div className="space-y-2">
          <button
            disabled={deleting}
            onClick={() => handleDelete(true)}
            className="w-full text-left border rounded-xl p-3.5 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <p className="text-sm font-medium text-gray-900">Mantener el historial</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Se eliminan los datos de la hipoteca pero se conservan los egresos y el historial de pagos.
            </p>
          </button>
          <button
            disabled={deleting}
            onClick={() => handleDelete(false)}
            className="w-full text-left border border-red-200 rounded-xl p-3.5 hover:border-red-400 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <p className="text-sm font-medium text-red-700">Eliminar todo</p>
            <p className="text-xs text-red-500 mt-0.5">
              Se eliminan la hipoteca, todos los registros de cuotas y los egresos generados automáticamente.
            </p>
          </button>
        </div>
        {deleting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Eliminando...
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MortgagePage() {
  const [loans, setLoans] = useState<MortgageLoan[]>([]);
  const [summary, setSummary] = useState<MortgageSummary | null>(null);
  const [records, setRecords] = useState<MortgageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [editLoan, setEditLoan] = useState<MortgageLoan | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const activeLoan = loans.find(l => l.is_active) ?? null;

  const load = async () => {
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
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []);

  const handleDeleteRecord = async (id: number) => {
    if (!confirm("¿Eliminar este registro? También se eliminará el egreso generado.")) return;
    await api.delete(`/mortgage/${id}`);
    await load();
  };

  if (loading) {
    return <div className="max-w-3xl p-6 text-muted-foreground text-sm">Cargando...</div>;
  }

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">Hipoteca</h2>
          {activeLoan?.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{activeLoan.description}</p>
          )}
        </div>
        {activeLoan && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDelete(true)}
              className="border p-1.5 rounded-lg hover:bg-red-50 hover:border-red-200 transition-colors"
              title="Eliminar hipoteca"
            >
              <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" />
            </button>
            <button
              onClick={() => { setEditLoan(activeLoan); setShowConfig(true); }}
              className="border p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              title="Editar configuración"
            >
              <Settings2 className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {!activeLoan && (
        <div className="bg-white rounded-xl border p-8 flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <Home className="w-6 h-6 text-gray-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">No tenés ninguna hipoteca configurada</p>
            <p className="text-xs text-muted-foreground mt-1">
              Configurá tu hipoteca y el sistema registrará las cuotas automáticamente cada mes.
            </p>
          </div>
          <button
            onClick={() => { setEditLoan(null); setShowConfig(true); }}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Configurar hipoteca
          </button>
        </div>
      )}

      {/* Active loan hero card */}
      {summary && (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          {/* Progress */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-900">
                Cuota {summary.cuota_numero} de {summary.loan.total_cuotas}
              </span>
              <span className="text-xs text-muted-foreground">
                {summary.cuotas_restantes} restantes · {summary.pct_completado}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className="bg-gray-900 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(summary.pct_completado, 100)}%` }}
              />
            </div>
          </div>

          {/* Amount */}
          <div>
            {summary.cuota_uva != null && (
              <p className="text-2xl font-bold text-gray-900">
                {Number(summary.cuota_uva).toFixed(2)} UVAs
              </p>
            )}
            {summary.cuota_pesos_calculado ? (
              <p className="text-base text-gray-600 mt-0.5">
                = {formatARS(summary.cuota_pesos_calculado)}
                {summary.latest_uva_value && summary.latest_uva_date && (
                  <span className="text-xs text-muted-foreground ml-1.5">
                    (UVA {formatARS(summary.latest_uva_value)} · {fmtDate(summary.latest_uva_date)})
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">Sin valor UVA disponible aún</p>
            )}
          </div>

          {/* Chips */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
              {LOAN_TYPE_LABELS[summary.loan.loan_type] ?? summary.loan.loan_type}
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
              {summary.loan.total_cuotas} cuotas
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
              desde {fmtDate(summary.loan.first_payment_date)}
            </span>
            {summary.loan.tna != null && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                TNA {Number(summary.loan.tna).toFixed(2)}%
              </span>
            )}
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
              Pago: {summary.loan.payment_day != null ? `día ${summary.loan.payment_day}` : "1er día hábil"}
            </span>
          </div>

          {/* Next payment status */}
          <div className={`rounded-lg p-3 text-sm ${summary.paid_this_month ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}`}>
            {summary.paid_this_month ? (
              <p className="font-medium">✓ Cuota de {format(new Date(), "MMMM yyyy", { locale: es })} registrada</p>
            ) : (
              <p>Próxima cuota: <strong>{fmtDate(summary.next_payment_date)}</strong> — se registrará automáticamente</p>
            )}
            {summary.paid_this_month && (
              <p className="text-xs mt-0.5 text-green-600">
                Próxima: {fmtDate(summary.next_payment_date)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Payment history */}
      {records.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Historial de cuotas</p>
          <div className="bg-white rounded-xl border divide-y">
            {records.map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {format(parseISO(r.period_date), "MMMM yyyy", { locale: es })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.uva_units ? `${Number(r.uva_units).toFixed(2)} UVAs` : ""}
                    {r.capital ? ` · Capital ${formatARS(r.capital)}` : ""}
                    {r.interest ? ` · Interés ${formatARS(r.interest)}` : ""}
                    {!r.mortgage_loan_id && " · manual"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-gray-900">{formatARS(r.payment_amount)}</span>
                  <button
                    onClick={() => handleDeleteRecord(r.id)}
                    className="text-xs text-gray-300 hover:text-red-500 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showConfig && (
        <LoanConfigModal
          editLoan={editLoan}
          onClose={() => { setShowConfig(false); setEditLoan(null); }}
          onSaved={() => { setLoading(true); load().finally(() => setLoading(false)); }}
        />
      )}

      {showDelete && activeLoan && (
        <DeleteLoanModal
          loanId={activeLoan.id}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { setLoading(true); load().finally(() => setLoading(false)); }}
        />
      )}
    </div>
  );
}

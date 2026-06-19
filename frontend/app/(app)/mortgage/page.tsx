"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS, formatDate } from "@/lib/utils";
import { Settings2, X, Loader2, ChevronRight, CheckCircle2, Home } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MortgageLoan {
  id: number;
  loan_type: string;
  description: string | null;
  loan_number: string | null;
  total_cuotas: number;
  first_payment_date: string;
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
  tasa_variable: "Registrás el monto de la cuota manualmente cada mes",
};

const EMPTY_FORM = {
  loan_type: "",
  description: "",
  loan_number: "",
  total_cuotas: "240",
  first_payment_date: "",
  cuota_uva: "",
  cuota_pesos: "",
  tna: "",
  original_capital_uva: "",
};

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
    total_cuotas: String(editLoan?.total_cuotas ?? 240),
    first_payment_date: editLoan?.first_payment_date ?? "",
    cuota_uva: editLoan?.cuota_uva != null ? String(editLoan.cuota_uva) : "",
    cuota_pesos: editLoan?.cuota_pesos != null ? String(editLoan.cuota_pesos) : "",
    tna: editLoan?.tna != null ? String(editLoan.tna) : "",
    original_capital_uva: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const isUva = form.loan_type === "uva_frances" || form.loan_type === "uva_aleman";

  const handleSave = async () => {
    setError("");
    setSaving(true);
    try {
      if (editLoan) {
        await api.patch(`/mortgage/loans/${editLoan.id}`, {
          description: form.description || null,
          loan_number: form.loan_number || null,
          cuota_uva: isUva && form.cuota_uva ? parseFloat(form.cuota_uva) : null,
          cuota_pesos: form.loan_type === "tasa_fija" && form.cuota_pesos ? parseFloat(form.cuota_pesos) : null,
          tna: form.tna ? parseFloat(form.tna) : null,
          original_capital_uva: form.original_capital_uva ? parseFloat(form.original_capital_uva) : null,
        });
      } else {
        await api.post("/mortgage/loans", {
          loan_type: form.loan_type,
          description: form.description || null,
          loan_number: form.loan_number || null,
          total_cuotas: parseInt(form.total_cuotas),
          first_payment_date: form.first_payment_date,
          cuota_uva: isUva && form.cuota_uva ? parseFloat(form.cuota_uva) : null,
          cuota_pesos: form.loan_type === "tasa_fija" && form.cuota_pesos ? parseFloat(form.cuota_pesos) : null,
          tna: form.tna ? parseFloat(form.tna) : null,
          original_capital_uva: form.original_capital_uva ? parseFloat(form.original_capital_uva) : null,
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            {editLoan ? "Editar hipoteca" : step === 1 ? "Tipo de hipoteca" : "Configurar hipoteca"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

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
                <>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-gray-600">Primera cuota *</label>
                    <input
                      type="date" required
                      value={form.first_payment_date} onChange={f("first_payment_date")}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Cantidad de cuotas *</label>
                    <input
                      type="number" min={1} required
                      value={form.total_cuotas} onChange={f("total_cuotas")}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}

              {isUva && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Cuota en UVAs *</label>
                  <input
                    type="number" step="0.000001" required
                    placeholder="ej: 750.740000"
                    value={form.cuota_uva} onChange={f("cuota_uva")}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              )}

              {form.loan_type === "tasa_fija" && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Cuota mensual ($) *</label>
                  <input
                    type="number" step="0.01" required
                    value={form.cuota_pesos} onChange={f("cuota_pesos")}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              )}

              {isUva && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-600">TNA % (opcional)</label>
                    <input
                      type="number" step="0.01"
                      placeholder="ej: 8.50"
                      value={form.tna} onChange={f("tna")}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Capital original en UVAs (opcional)</label>
                    <input
                      type="number" step="0.000001"
                      placeholder="para desglose capital/interés"
                      value={form.original_capital_uva} onChange={f("original_capital_uva")}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}

              <div className={isUva ? "sm:col-span-2" : ""}>
                <label className="text-xs font-medium text-gray-600">Descripción (opcional)</label>
                <input
                  type="text"
                  placeholder="ej: Hipoteca Banco Nación"
                  value={form.description} onChange={f("description")}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">N° de préstamo (opcional)</label>
                <input
                  type="text"
                  value={form.loan_number} onChange={f("loan_number")}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="border px-4 py-2 rounded-lg text-sm">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editLoan ? "Guardar cambios" : "Activar hipoteca"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Variable amount modal ──────────────────────────────────────────────────────

function PayVariableModal({ onConfirm, onClose }: {
  onConfirm: (amount: number) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xs p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Monto de la cuota</h3>
        <input
          type="number" step="0.01" autoFocus
          placeholder="$0,00"
          value={amount} onChange={e => setAmount(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
          <button
            onClick={() => amount && onConfirm(parseFloat(amount))}
            disabled={!amount}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            Registrar
          </button>
        </div>
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
  const [paying, setPaying] = useState(false);
  const [showVariableModal, setShowVariableModal] = useState(false);

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

  const handlePay = async (amountPesos?: number) => {
    if (!activeLoan) return;
    setPaying(true);
    try {
      const params = amountPesos != null ? `?amount_pesos=${amountPesos}` : "";
      await api.post(`/mortgage/loans/${activeLoan.id}/pay${params}`);
      await load();
    } catch (e: any) {
      alert(e.response?.data?.detail ?? "Error al registrar la cuota");
    } finally {
      setPaying(false);
    }
  };

  const handleDeleteRecord = async (id: number) => {
    if (!confirm("¿Eliminar este registro? También se eliminará el egreso generado.")) return;
    await api.delete(`/mortgage/${id}`);
    await load();
  };

  const today = new Date();
  const monthName = today.toLocaleString("es-AR", { month: "long", year: "numeric" });

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
          <button
            onClick={() => { setEditLoan(activeLoan); setShowConfig(true); }}
            className="border p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            title="Editar configuración"
          >
            <Settings2 className="w-4 h-4 text-gray-600" />
          </button>
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
              Configurá tu hipoteca para que el sistema calcule y registre la cuota mensual automáticamente.
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
                    (UVA {formatARS(summary.latest_uva_value)} · {formatDate(summary.latest_uva_date)})
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
              desde {formatDate(summary.loan.first_payment_date)}
            </span>
            {summary.loan.tna != null && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                TNA {Number(summary.loan.tna).toFixed(2)}%
              </span>
            )}
          </div>

          {/* Pay button */}
          {summary.paid_this_month ? (
            <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Cuota de {monthName} registrada
            </div>
          ) : (
            <button
              onClick={() => {
                if (activeLoan?.loan_type === "tasa_variable") {
                  setShowVariableModal(true);
                } else {
                  handlePay();
                }
              }}
              disabled={paying}
              className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white text-sm py-2.5 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {paying && <Loader2 className="w-4 h-4 animate-spin" />}
              Registrar cuota de {monthName}
            </button>
          )}
        </div>
      )}

      {/* Payment history */}
      {records.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Historial de pagos</p>
          <div className="bg-white rounded-xl border divide-y">
            {records.map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{formatDate(r.period_date)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.uva_units ? `${Number(r.uva_units).toFixed(2)} UVAs` : ""}
                    {r.capital ? ` · Capital ${formatARS(r.capital)}` : ""}
                    {r.interest ? ` · Interés ${formatARS(r.interest)}` : ""}
                    {r.expense_entry_id ? " · egreso registrado" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-gray-900">{formatARS(r.payment_amount)}</span>
                  <button
                    onClick={() => handleDeleteRecord(r.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
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

      {showVariableModal && (
        <PayVariableModal
          onConfirm={(amount) => { setShowVariableModal(false); handlePay(amount); }}
          onClose={() => setShowVariableModal(false)}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { formatARS, formatDate, parseAmount, getErrorMessage } from "@/lib/utils";
import { Plus, Trash2, Pencil, Upload, X, CheckCircle2, AlertCircle, ChevronRight, CalendarDays, ChevronLeft } from "lucide-react";
import ProductTour from "@/components/ProductTour";
import type { Step } from "react-joyride";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const INCOME_TOUR_STEPS: Step[] = [
  {
    target: "[data-tour='income-add']",
    content: "Con este botón registrás un nuevo ingreso: sueldo u otra entrada, con bruto/deducciones/neto.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: "[data-tour='income-import']",
    content: "Si tenés varios ingresos para cargar, podés importarlos de una desde un Excel o CSV.",
    placement: "bottom",
  },
];

interface IncomeSource { id: number; name: string; income_type: string; }
interface IncomeEntry {
  id: number; source_id: number;
  bruto: number | null; deducciones: number | null; amount: number;
  period_date: string; notes?: string; currency?: string;
  source: IncomeSource;
}

const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "Sueldo", bonus: "Bono", aguinaldo: "Aguinaldo",
  investment: "Inversión", other: "Otro",
};

const EMPTY_FORM = {
  source_id: "", bruto: "", deducciones: "", amount: "",
  period_date: "", notes: "", currency: "ARS" as "ARS" | "USD",
};

// ── Entry detail modal ─────────────────────────────────────────────────────────

function EntryDetailModal({
  entry, onEdit, onDelete, onClose,
}: {
  entry: IncomeEntry; onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">{entry.source.name}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="divide-y text-sm">
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Fecha</span>
            <span className="font-medium">{formatDate(entry.period_date)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Tipo</span>
            <span className="font-medium">{INCOME_TYPE_LABELS[entry.source.income_type]}</span>
          </div>
          {entry.bruto != null && (
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Bruto</span>
              <span className="font-medium">{formatARS(entry.bruto)}</span>
            </div>
          )}
          {entry.deducciones != null && (
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Deducciones</span>
              <span className="font-medium text-rose-600">− {formatARS(entry.deducciones)}</span>
            </div>
          )}
          <div className="flex justify-between py-2">
            <span className="font-medium text-foreground">Neto</span>
            <span className="font-bold text-emerald-600 text-base">{formatARS(entry.amount)}</span>
          </div>
          {entry.notes && (
            <div className="flex justify-between py-2 gap-4">
              <span className="text-muted-foreground shrink-0">Notas</span>
              <span className="font-medium text-right">{entry.notes}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="destructive" onClick={onDelete} className="flex-1">
            <Trash2 className="w-4 h-4" /> Eliminar
          </Button>
          <Button onClick={onEdit} className="flex-1">
            <Pencil className="w-4 h-4" /> Editar
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ── Import modal ───────────────────────────────────────────────────────────────

interface PreviewData { columns: string[]; sample: string[][]; row_count: number; }
interface ImportResult { imported: number; skipped: number; errors: string[]; }

function ImportModal({ sources, onClose }: { sources: IncomeSource[]; onClose: () => void }) {
  type Step = "upload" | "map" | "importing" | "done";
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [mapping, setMapping] = useState({
    date_col: "", amount_col: "", bruto_col: "", deducciones_col: "",
    notes_col: "", source_id: "", new_source_name: "", new_source_type: "salary",
  });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setLoadingPreview(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post<PreviewData>("/income/import/preview", fd);
      setPreview(data);
      const cols = data.columns;
      setMapping(m => ({ ...m, date_col: cols[0] ?? "", amount_col: cols[cols.length - 1] ?? "" }));
      setStep("map");
    } catch {
      setError("No se pudo leer el archivo. Verificá que sea .xlsx o .csv");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!file || !preview) return;
    if (!mapping.date_col || !mapping.amount_col) {
      setError("Seleccioná las columnas de fecha y monto"); return;
    }
    if (!mapping.source_id && !mapping.new_source_name.trim()) {
      setError("Seleccioná o creá una fuente de ingreso"); return;
    }
    setError("");
    setStep("importing");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("date_col", mapping.date_col);
      fd.append("amount_col", mapping.amount_col);
      if (mapping.bruto_col) fd.append("bruto_col", mapping.bruto_col);
      if (mapping.deducciones_col) fd.append("deducciones_col", mapping.deducciones_col);
      if (mapping.notes_col) fd.append("notes_col", mapping.notes_col);
      if (mapping.source_id) fd.append("source_id", mapping.source_id);
      else {
        fd.append("new_source_name", mapping.new_source_name.trim());
        fd.append("new_source_type", mapping.new_source_type);
      }
      const { data } = await api.post<ImportResult>("/income/import/run", fd);
      setResult(data);
      setStep("done");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Error al importar"));
      setStep("map");
    }
  };

  const NO_COL = "— sin mapear —";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <Card className="p-0 md:p-0 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-foreground">Importar ingresos</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {(["Archivo", "Mapeo", "Procesando", "Resultado"]).map((label, i) => (
              <span key={label} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground/40">›</span>}
                <span className={i === ["upload","map","importing","done"].indexOf(step) ? "text-primary font-medium" : ""}>{label}</span>
              </span>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}

          {step === "upload" && (
            <div
              className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:bg-accent"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-10 h-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">Seleccioná un archivo</p>
              <p className="text-xs text-muted-foreground">Excel (.xlsx) o CSV (.csv)</p>
              {loadingPreview && <p className="text-xs text-primary mt-2">Leyendo archivo...</p>}
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {step === "map" && preview && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Vista previa · {preview.row_count} filas</p>
                <div className="overflow-x-auto rounded-lg border text-xs">
                  <table className="w-full">
                    <thead className="bg-muted">
                      <tr>{preview.columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium text-muted-foreground">{c}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.sample.map((row, i) => (
                        <tr key={i}>{row.map((cell, j) => <td key={j} className="px-3 py-1.5 text-foreground max-w-[120px] truncate">{cell}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ["date_col", "Columna de fecha *", true],
                  ["amount_col", "Columna de neto *", true],
                  ["bruto_col", "Columna de bruto"],
                  ["deducciones_col", "Columna de deducciones"],
                  ["notes_col", "Columna de notas"],
                ].map(([key, label, required]) => (
                  <div key={key as string}>
                    <label className="text-xs font-medium text-muted-foreground">{label as string}</label>
                    <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                      value={mapping[key as keyof typeof mapping]}
                      onChange={e => setMapping(m => ({ ...m, [key as string]: e.target.value }))}>
                      {!required && <option value="">{NO_COL}</option>}
                      {required && <option value="">— elegir —</option>}
                      {preview.columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Fuente de ingreso *</label>
                  <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={mapping.source_id} onChange={e => setMapping(m => ({ ...m, source_id: e.target.value }))}>
                    <option value="">+ Crear nueva fuente</option>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {!mapping.source_id && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted rounded-xl p-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
                    <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card"
                      placeholder="Ej: Sueldo Empresa"
                      value={mapping.new_source_name}
                      onChange={e => setMapping(m => ({ ...m, new_source_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                    <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card"
                      value={mapping.new_source_type}
                      onChange={e => setMapping(m => ({ ...m, new_source_type: e.target.value }))}>
                      {Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "importing" && (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Importando registros...</p>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
                <div>
                  <p className="font-semibold text-foreground">Importación completada</p>
                  <p className="text-sm text-muted-foreground">{result.imported + result.skipped} registros procesados</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{result.imported}</p>
                  <p className="text-xs text-emerald-700 mt-0.5">Importados</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{result.skipped}</p>
                  <p className="text-xs text-amber-700 mt-0.5">Duplicados</p>
                </div>
                <div className="bg-rose-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-rose-600">{result.errors.length}</p>
                  <p className="text-xs text-rose-700 mt-0.5">Errores</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-destructive/10 rounded-lg p-3 space-y-1">
                  {result.errors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-between items-center">
          {step === "upload" && <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Cancelar</button>}
          {step === "map" && (
            <>
              <Button variant="outline" onClick={() => { setStep("upload"); setPreview(null); setFile(null); }}>
                ← Atrás
              </Button>
              <Button onClick={handleImport}>
                Importar {preview?.row_count} filas →
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={onClose} className="ml-auto">
              Cerrar
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}


// ── Main page ──────────────────────────────────────────────────────────────────

export default function IncomePage() {
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newSource, setNewSource] = useState({ name: "", income_type: "salary" });
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [detailEntry, setDetailEntry] = useState<IncomeEntry | null>(null);
  const netoManual = useRef(false);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es });

  const load = async () => {
    const [e, s] = await Promise.all([
      api.get("/income/entries", { params: { year, month } }),
      api.get("/income/sources"),
    ]);
    setEntries(e.data);
    setSources(s.data);
  };

  useEffect(() => { load(); }, [year, month]);
  const updateBrutoOrDed = (key: "bruto" | "deducciones", value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (!netoManual.current) {
        const b = parseAmount(key === "bruto" ? value : prev.bruto);
        const d = parseAmount(key === "deducciones" ? value : prev.deducciones);
        next.amount = b > 0 || d > 0 ? String(Math.max(0, b - d)) : "";
      }
      return next;
    });
  };

  const openEdit = (entry: IncomeEntry) => {
    netoManual.current = true;
    setEditId(entry.id);
    setForm({
      source_id: String(entry.source_id),
      bruto: entry.bruto != null ? String(entry.bruto) : "",
      deducciones: entry.deducciones != null ? String(entry.deducciones) : "",
      amount: String(entry.amount),
      period_date: entry.period_date,
      notes: entry.notes || "",
      currency: (entry.currency as "ARS" | "USD") || "ARS",
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    netoManual.current = false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload = {
      source_id: parseInt(form.source_id),
      bruto: form.bruto ? parseAmount(form.bruto) : null,
      deducciones: form.deducciones ? parseAmount(form.deducciones) : null,
      amount: parseAmount(form.amount),
      currency: form.currency,
      period_date: form.period_date,
      notes: form.notes || null,
    };
    if (editId) await api.patch(`/income/entries/${editId}`, payload);
    else await api.post("/income/entries", payload);
    closeForm();
    await load();
    setLoading(false);
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/income/sources", newSource);
    setNewSource({ name: "", income_type: "salary" });
    setShowSourceForm(false);
    await load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este ingreso?")) return;
    await api.delete(`/income/entries/${id}`);
    setSelected(s => { const n = new Set(s); n.delete(id); return n; });
    setDetailEntry(null);
    await load();
  };

  const toggleSelect = (id: number) =>
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const toggleAll = () =>
    setSelected(s => s.size === entries.length ? new Set() : new Set(entries.map(e => e.id)));

  const handleBulkDelete = async () => {
    if (!confirm(`¿Eliminar ${selected.size} ingreso${selected.size !== 1 ? "s" : ""}?`)) return;
    setBulkDeleting(true);
    await Promise.all([...selected].map(id => api.delete(`/income/entries/${id}`)));
    setSelected(new Set());
    await load();
    setBulkDeleting(false);
  };

  const allSelected = entries.length > 0 && selected.size === entries.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <ProductTour tourId="income-intro" steps={INCOME_TOUR_STEPS} />
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Ingresos</h2>
        <div className="flex gap-1 md:gap-2 shrink-0">
          <Button variant="outline" onClick={() => setShowSourceForm(true)}>
            + Fuente
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)} data-tour="income-import">
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Importar</span>
          </Button>
          <Button onClick={() => { setEditId(null); setForm(EMPTY_FORM); netoManual.current = false; setShowForm(true); }} data-tour="income-add">
            <Plus className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Registrar</span>
          </Button>
        </div>
      </div>

      {/* Source form */}
      {showSourceForm && (
        <Card className="p-4">
          <form onSubmit={handleAddSource}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Nombre de la fuente"
              value={newSource.name} onChange={e => setNewSource(p => ({ ...p, name: e.target.value }))} required />
            <select className="w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
              value={newSource.income_type} onChange={e => setNewSource(p => ({ ...p, income_type: e.target.value }))}>
              {Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button type="button" variant="outline" onClick={() => setShowSourceForm(false)}>Cancelar</Button>
            <Button type="submit">Guardar</Button>
          </div>
          </form>
        </Card>
      )}

      {/* Entry form */}
      {showForm && (
        <Card className="p-4 md:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm font-medium text-foreground">{editId ? "Editar ingreso" : "Nuevo ingreso"}</p>
          {/* Same ARS/USD toggle position as the expense form. A USD income
              also adds to the dollar holding, not just to the USD balance. */}
          <div className="flex gap-2 mb-1">
            {(["ARS", "USD"] as const).map(cur => (
              <button key={cur} type="button"
                onClick={() => setForm(p => ({ ...p, currency: cur }))}
                className={`flex-1 py-1.5 text-xs rounded-full border-2 font-medium transition-colors ${form.currency === cur ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent"}`}>
                {cur === "ARS" ? "$ ARS" : "U$D"}
              </button>
            ))}
          </div>
          {form.currency === "USD" && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              Se suma a tu <strong>tenencia en dólares</strong> y al balance en USD, no al balance en pesos.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fuente</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.source_id} onChange={e => setForm(p => ({ ...p, source_id: e.target.value }))} required>
                <option value="">Seleccioná una fuente</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name} ({INCOME_TYPE_LABELS[s.income_type]})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Período</label>
              <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.period_date} onChange={e => setForm(p => ({ ...p, period_date: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Sueldo bruto ($)</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.bruto} onChange={e => updateBrutoOrDed("bruto", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Deducciones ($)</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.deducciones} onChange={e => updateBrutoOrDed("deducciones", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">
                Sueldo neto ($)
                {!netoManual.current && form.bruto && (
                  <span className="text-muted-foreground font-normal ml-1">— calculado automáticamente</span>
                )}
              </label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.amount}
                onFocus={() => { netoManual.current = true; }}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                required />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Notas (opcional)</label>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
          </form>
        </Card>
      )}

      <div className="flex justify-end">
        <div className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card shadow-chip pl-3 pr-1.5 py-1.5">
          <CalendarDays className="w-4 h-4 text-primary shrink-0" />
          <button onClick={prev} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-foreground capitalize px-0.5 min-w-[100px] text-center">{periodLabel}</span>
          <button onClick={next} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <Card className="p-0 md:p-0 divide-y">
        {entries.length > 0 && (
          <div className="flex items-center gap-3 px-3 md:px-5 py-2 bg-muted rounded-t-2xl">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              className="w-4 h-4 rounded cursor-pointer"
            />
            {selected.size > 0 ? (
              <div className="flex items-center gap-3 flex-1">
                <span className="text-sm text-muted-foreground">{selected.size} seleccionado{selected.size !== 1 ? "s" : ""}</span>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1 text-sm text-destructive hover:opacity-80 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {bulkDeleting ? "Eliminando..." : "Eliminar seleccionados"}
                </button>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Seleccionar todos</span>
            )}
          </div>
        )}

        {entries.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">No hay ingresos registrados en {periodLabel}.</p>
        ) : entries.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 px-3 md:px-4 py-3">
            <input
              type="checkbox"
              checked={selected.has(entry.id)}
              onChange={() => toggleSelect(entry.id)}
              className="w-4 h-4 rounded cursor-pointer shrink-0"
            />
            <button
              className="flex-1 flex items-center gap-2 min-w-0 text-left hover:opacity-80 active:opacity-60"
              onClick={() => setDetailEntry(entry)}
            >
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-foreground truncate">{entry.source.name}</span>
                <span className="block sm:hidden text-xs text-muted-foreground">{formatDate(entry.period_date)}</span>
              </div>
              <span className="hidden sm:block w-[10ch] shrink-0 text-xs text-muted-foreground text-right truncate">{formatDate(entry.period_date)}</span>
              <span className="w-[16ch] shrink-0 text-sm font-semibold text-emerald-600 text-right truncate">{formatARS(entry.amount)}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </button>
          </div>
        ))}
      </Card>

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          onEdit={() => { setDetailEntry(null); openEdit(detailEntry); }}
          onDelete={() => handleDelete(detailEntry.id)}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {showImport && (
        <ImportModal sources={sources} onClose={() => { setShowImport(false); load(); }} />
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { formatARS, formatDate } from "@/lib/utils";
import { Plus, Trash2, Pencil, Upload, X, CheckCircle2, AlertCircle } from "lucide-react";

interface IncomeSource { id: number; name: string; income_type: string; }
interface IncomeEntry {
  id: number; source_id: number;
  bruto: number | null; deducciones: number | null; amount: number;
  period_date: string; notes?: string;
  source: IncomeSource;
}

const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "Sueldo", bonus: "Bono", aguinaldo: "Aguinaldo",
  investment: "Inversión", other: "Otro",
};

const EMPTY_FORM = {
  source_id: "", bruto: "", deducciones: "", amount: "",
  period_date: "", notes: "",
};

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
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Error al importar");
      setStep("map");
    }
  };

  const NO_COL = "— sin mapear —";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Importar ingresos</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {(["Archivo", "Mapeo", "Procesando", "Resultado"]).map((label, i) => (
              <span key={label} className="flex items-center gap-1">
                {i > 0 && <span className="text-gray-300">›</span>}
                <span className={i === ["upload","map","importing","done"].indexOf(step) ? "text-primary font-medium" : ""}>{label}</span>
              </span>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}

          {step === "upload" && (
            <div
              className="border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:bg-gray-50"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-10 h-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-700">Seleccioná un archivo</p>
              <p className="text-xs text-muted-foreground">Excel (.xlsx) o CSV (.csv)</p>
              {loadingPreview && <p className="text-xs text-primary mt-2">Leyendo archivo...</p>}
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {step === "map" && preview && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Vista previa · {preview.row_count} filas</p>
                <div className="overflow-x-auto rounded-lg border text-xs">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>{preview.columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium text-gray-600">{c}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.sample.map((row, i) => (
                        <tr key={i}>{row.map((cell, j) => <td key={j} className="px-3 py-1.5 text-gray-700 max-w-[120px] truncate">{cell}</td>)}</tr>
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
                    <label className="text-xs font-medium text-gray-600">{label as string}</label>
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
                  <label className="text-xs font-medium text-gray-600">Fuente de ingreso *</label>
                  <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={mapping.source_id} onChange={e => setMapping(m => ({ ...m, source_id: e.target.value }))}>
                    <option value="">+ Crear nueva fuente</option>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {!mapping.source_id && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50 rounded-xl p-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600">Nombre *</label>
                    <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="Ej: Sueldo Empresa"
                      value={mapping.new_source_name}
                      onChange={e => setMapping(m => ({ ...m, new_source_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Tipo</label>
                    <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
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
              <p className="text-sm text-gray-600">Importando registros...</p>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-green-500 shrink-0" />
                <div>
                  <p className="font-semibold text-gray-900">Importación completada</p>
                  <p className="text-sm text-muted-foreground">{result.imported + result.skipped} registros procesados</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.imported}</p>
                  <p className="text-xs text-green-700 mt-0.5">Importados</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{result.skipped}</p>
                  <p className="text-xs text-amber-700 mt-0.5">Duplicados</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{result.errors.length}</p>
                  <p className="text-xs text-red-700 mt-0.5">Errores</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-red-50 rounded-lg p-3 space-y-1">
                  {result.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-between items-center">
          {step === "upload" && <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>}
          {step === "map" && (
            <>
              <button onClick={() => { setStep("upload"); setPreview(null); setFile(null); }}
                className="text-sm border px-4 py-2 rounded-lg hover:bg-gray-50">← Atrás</button>
              <button onClick={handleImport}
                className="bg-primary text-white text-sm px-5 py-2 rounded-lg hover:opacity-90 font-medium">
                Importar {preview?.row_count} filas →
              </button>
            </>
          )}
          {step === "done" && (
            <button onClick={onClose} className="ml-auto bg-primary text-white text-sm px-5 py-2 rounded-lg hover:opacity-90">
              Cerrar
            </button>
          )}
        </div>
      </div>
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
  const netoManual = useRef(false);

  const load = async () => {
    const [e, s] = await Promise.all([api.get("/income/entries"), api.get("/income/sources")]);
    setEntries(e.data);
    setSources(s.data);
  };

  useEffect(() => { load(); }, []);

  // Auto-calc neto from bruto - deducciones unless user edited neto manually
  const updateBrutoOrDed = (key: "bruto" | "deducciones", value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (!netoManual.current) {
        const b = parseFloat(key === "bruto" ? value : prev.bruto) || 0;
        const d = parseFloat(key === "deducciones" ? value : prev.deducciones) || 0;
        next.amount = b > 0 || d > 0 ? String(Math.max(0, b - d)) : "";
      }
      return next;
    });
  };

  const openEdit = (entry: IncomeEntry) => {
    netoManual.current = true; // editing existing: neto is already known
    setEditId(entry.id);
    setForm({
      source_id: String(entry.source_id),
      bruto: entry.bruto != null ? String(entry.bruto) : "",
      deducciones: entry.deducciones != null ? String(entry.deducciones) : "",
      amount: String(entry.amount),
      period_date: entry.period_date,
      notes: entry.notes || "",
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
      bruto: form.bruto ? parseFloat(form.bruto) : null,
      deducciones: form.deducciones ? parseFloat(form.deducciones) : null,
      amount: parseFloat(form.amount),
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
    await load();
  };

  const toggleSelect = (id: number) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
    <div className="max-w-3xl space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900">Ingresos</h2>
        <div className="flex gap-1 md:gap-2 shrink-0">
          <button onClick={() => setShowSourceForm(true)}
            className="text-sm border px-2 md:px-3 py-1.5 rounded-lg hover:bg-gray-50">
            + Fuente
          </button>
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1 text-sm border px-2 md:px-3 py-1.5 rounded-lg hover:bg-gray-50">
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Importar</span>
          </button>
          <button onClick={() => { setEditId(null); setForm(EMPTY_FORM); netoManual.current = false; setShowForm(true); }}
            className="flex items-center gap-1 bg-primary text-white text-sm px-3 py-1.5 rounded-lg hover:opacity-90">
            <Plus className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Registrar</span>
          </button>
        </div>
      </div>

      {/* Source form */}
      {showSourceForm && (
        <form onSubmit={handleAddSource} className="bg-white rounded-xl border p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Nombre de la fuente"
              value={newSource.name} onChange={e => setNewSource(p => ({ ...p, name: e.target.value }))} required />
            <select className="border rounded-lg px-3 py-2 text-sm"
              value={newSource.income_type} onChange={e => setNewSource(p => ({ ...p, income_type: e.target.value }))}>
              {Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setShowSourceForm(false)} className="border px-3 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" className="bg-primary text-white px-4 py-2 rounded-lg text-sm">Guardar</button>
          </div>
        </form>
      )}

      {/* Entry form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 md:p-5 space-y-3">
          <p className="text-sm font-medium text-gray-700">{editId ? "Editar ingreso" : "Nuevo ingreso"}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Fuente</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.source_id} onChange={e => setForm(p => ({ ...p, source_id: e.target.value }))} required>
                <option value="">Seleccioná una fuente</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name} ({INCOME_TYPE_LABELS[s.income_type]})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Período</label>
              <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.period_date} onChange={e => setForm(p => ({ ...p, period_date: e.target.value }))} required />
            </div>

            {/* Bruto */}
            <div>
              <label className="text-xs font-medium text-gray-600">Sueldo bruto ($)</label>
              <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.bruto}
                onChange={e => updateBrutoOrDed("bruto", e.target.value)} />
            </div>

            {/* Deducciones */}
            <div>
              <label className="text-xs font-medium text-gray-600">Deducciones ($)</label>
              <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.deducciones}
                onChange={e => updateBrutoOrDed("deducciones", e.target.value)} />
            </div>

            {/* Neto — auto-calc, editable */}
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">
                Sueldo neto ($)
                {!netoManual.current && form.bruto && (
                  <span className="text-muted-foreground font-normal ml-1">— calculado automáticamente</span>
                )}
              </label>
              <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.amount}
                onFocus={() => { netoManual.current = true; }}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                required />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Notas (opcional)</label>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={loading} className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border divide-y">
        {/* Select-all / bulk action header */}
        {entries.length > 0 && (
          <div className="flex items-center gap-3 px-3 md:px-5 py-2 bg-gray-50 rounded-t-xl">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              className="w-4 h-4 rounded cursor-pointer"
            />
            {selected.size > 0 ? (
              <div className="flex items-center gap-3 flex-1">
                <span className="text-sm text-gray-600">{selected.size} seleccionado{selected.size !== 1 ? "s" : ""}</span>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
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
          <p className="p-6 text-muted-foreground text-sm">No hay ingresos registrados aún.</p>
        ) : entries.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 px-3 md:px-5 py-3 md:py-4">
            <input
              type="checkbox"
              checked={selected.has(entry.id)}
              onChange={() => toggleSelect(entry.id)}
              className="w-4 h-4 rounded cursor-pointer shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{entry.source.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(entry.period_date)} · {INCOME_TYPE_LABELS[entry.source.income_type]}
                {entry.bruto != null && (
                  <> · Bruto {formatARS(entry.bruto)}{entry.deducciones != null ? ` − Ded. ${formatARS(entry.deducciones)}` : ""}</>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-semibold text-green-600">{formatARS(entry.amount)}</span>
              <button onClick={() => openEdit(entry)} className="text-gray-400 hover:text-primary p-1">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(entry.id)} className="text-gray-400 hover:text-destructive p-1">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showImport && (
        <ImportModal sources={sources} onClose={() => { setShowImport(false); load(); }} />
      )}
    </div>
  );
}

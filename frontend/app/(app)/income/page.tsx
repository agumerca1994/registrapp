"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD, formatDate, parseAmount, getErrorMessage } from "@/lib/utils";
import { Trash2, Pencil, Upload, X, CheckCircle2, AlertCircle, ChevronRight, CalendarDays, ChevronLeft, Search, SlidersHorizontal, MoreVertical, Settings2, ListTree } from "lucide-react";
import {
  FilterBar, FilterRow, FilterPanel, SortChip, FilterChip, PillSelect,
  PillDateRange, ClearFilters, CollapsibleSearch,
} from "@/components/ui/filters";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import ProductTour from "@/components/ProductTour";
import type { Step } from "react-joyride";
import { Card } from "@/components/ui/card";
import { Fab } from "@/components/ui/fab";
import { Button } from "@/components/ui/button";
import { CurrencyToggle, FIELD, FormGrid, SelectField, DateField } from "@/components/ui/form";
import {
  INCOME_TYPE_LABELS, KIND_LABELS, detailNet,
  type IncomeSource, type IncomeEntry, type SourceField, type EntryItem,
} from "@/components/income/types";
import { SourceFormModal, SourcesListModal } from "@/components/income/SourceFormModal";

const INCOME_TOUR_STEPS: Step[] = [
  {
    target: "[data-tour='income-add']",
    content: "Con este botón registrás un nuevo ingreso: sueldo u otra entrada. Si la fuente tiene campos de detalle (bruto, ganancias, bonos…), el neto se calcula solo.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: "[data-tour='income-import']",
    content: "Si tenés varios ingresos para cargar, podés importarlos de una desde un Excel o CSV.",
    placement: "bottom",
  },
];

// `items` es field_id → monto tal como se tipeó; sólo viajan los que tienen valor.
const EMPTY_FORM = {
  source_id: "", amount: "", items: {} as Record<string, string>,
  period_date: "", notes: "", currency: "ARS" as "ARS" | "USD",
};

/** Los campos que el formulario ofrece para una fuente: los activos, más los
 *  archivados que este ingreso ya tiene cargados — editar un ingreso viejo no
 *  puede hacerle perder montos de un campo que la fuente ya no usa. */
function fieldsForForm(source: IncomeSource | undefined, items: Record<string, string>): SourceField[] {
  return (source?.fields ?? [])
    .filter(f => f.is_active || (items[f.id] ?? "") !== "")
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.position - b.position);
}

const KIND_SIGN: Record<string, string> = { add: "+", subtract: "−", info: "·" };

// A new entry defaults to today — the overwhelmingly common case, and it saves
// the user a trip through the calendar to pick the date they're standing on.
const newEntryForm = () => ({ ...EMPTY_FORM, period_date: format(new Date(), "yyyy-MM-dd") });

type SortKey = "date" | "source" | "amount";
const SORT_LABELS: Record<SortKey, string> = {
  date: "Fecha", source: "Fuente", amount: "Monto",
};

// ── Entry detail modal ─────────────────────────────────────────────────────────

function EntryDetailModal({
  entry, fieldOrder, onEdit, onDelete, onClose,
}: {
  entry: IncomeEntry; fieldOrder: Map<number, number>;
  onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const fmt = entry.currency === "USD" ? formatUSD : formatARS;
  const items = [...(entry.items ?? [])].sort(
    (a, b) => (fieldOrder.get(a.field_id) ?? 0) - (fieldOrder.get(b.field_id) ?? 0),
  );
  const groups: { label: string; rows: EntryItem[] }[] = [
    { label: "Suma", rows: items.filter(i => i.kind === "add") },
    { label: "Resta", rows: items.filter(i => i.kind === "subtract") },
    { label: "Informativo", rows: items.filter(i => i.kind === "info") },
  ];
  // Lo que el detalle no explica del neto: un campo que no se cargó, un
  // redondeo del recibo… Se muestra en vez de esconderlo, así el desglose
  // nunca aparenta cerrar cuando no cierra.
  const hasMath = items.some(i => i.kind !== "info");
  const gap = hasMath ? Math.round((Number(entry.amount) - detailNet(items)) * 100) / 100 : 0;
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
          {groups.filter(g => g.rows.length > 0).map(g => (
            <div key={g.label} className="py-2 space-y-1" data-testid={`detail-group-${g.label}`}>
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{g.label}</span>
              {g.rows.map(i => (
                <div key={i.field_id} className="flex justify-between gap-4">
                  <span className="text-muted-foreground truncate">
                    {i.name}
                    {!i.field_active && <span className="text-[11px] ml-1">(quitado de la fuente)</span>}
                  </span>
                  <span className={`font-medium shrink-0 ${i.kind === "subtract" ? "text-rose-600" : ""}`}>
                    {i.kind === "subtract" ? "− " : ""}{fmt(i.amount)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {gap !== 0 && (
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Sin detallar</span>
              <span className="font-medium text-amber-600">{gap < 0 ? "− " : ""}{fmt(Math.abs(gap))}</span>
            </div>
          )}
          <div className="flex justify-between py-2">
            <span className="font-medium text-foreground">Neto</span>
            <span className="font-bold text-emerald-600 text-base">{fmt(entry.amount)}</span>
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

              <FormGrid>
                {[
                  ["date_col", "Columna de fecha *", true],
                  ["amount_col", "Columna de neto *", true],
                  ["bruto_col", "Columna de bruto"],
                  ["deducciones_col", "Columna de deducciones"],
                  ["notes_col", "Columna de notas"],
                ].map(([key, label, required]) => (
                  <div key={key as string}>
                    <label className="text-xs font-medium text-muted-foreground">{label as string}</label>
                    <SelectField
                      value={mapping[key as keyof typeof mapping]}
                      onChange={v => setMapping(m => ({ ...m, [key as string]: v }))}
                      placeholder={required ? "— elegir —" : NO_COL}
                      options={preview.columns.map(c => ({ value: c, label: c }))} />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Fuente de ingreso *</label>
                  <SelectField
                    value={mapping.source_id}
                    onChange={v => setMapping(m => ({ ...m, source_id: v }))}
                    placeholder="+ Crear nueva fuente"
                    options={sources.map(s => ({ value: String(s.id), label: s.name }))} />
                </div>
              </FormGrid>

              {!mapping.source_id && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted rounded-xl p-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
                    <input className={FIELD}
                      placeholder="Ej: Sueldo Empresa"
                      value={mapping.new_source_name}
                      onChange={e => setMapping(m => ({ ...m, new_source_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                    <SelectField
                      value={mapping.new_source_type}
                      onChange={v => setMapping(m => ({ ...m, new_source_type: v }))}
                      options={Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
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
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // `source` ausente = alta. `fromForm`: se abrió desde el formulario de
  // ingreso, así que al guardar la fuente queda elegida ahí.
  const [sourceModal, setSourceModal] = useState<{ source?: IncomeSource; fromForm: boolean } | null>(null);
  const [showSourcesList, setShowSourcesList] = useState(false);
  const [formError, setFormError] = useState("");
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

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showCustomFilter, setShowCustomFilter] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Null = no chip active, which the backend reads as its own default (most
  // recent first). Same tri-state cycle as /tarjetas.
  const [sort, setSort] = useState<SortKey | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  // One request when the user stops typing, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const panelFilterActive = !!(sourceFilter || dateFrom || dateTo);
  // Any active filter takes the list out of the month view and into the whole
  // history: a search that only looks inside the month currently on screen
  // would miss what the user is looking for and give no hint that it did.
  const filtering = !!debouncedSearch || panelFilterActive;

  const load = async () => {
    // No chip active → the endpoint's own default ordering.
    const ordering = { sort: sort ?? "date", order: sort ? order : "desc" };
    const params = filtering
      ? {
          q: debouncedSearch || undefined,
          source_id: sourceFilter || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          ...ordering,
        }
      : { year, month, ...ordering };
    const [e, s] = await Promise.all([
      api.get("/income/entries", { params }),
      api.get("/income/sources"),
    ]);
    setEntries(e.data);
    setSources(s.data);
    setSelected(new Set());
  };

  useEffect(() => { load(); },
    [year, month, debouncedSearch, sourceFilter, dateFrom, dateTo, sort, order]);

  // Tap cycle: inactive -> asc -> desc -> inactive (back to the default).
  const toggleSort = (key: SortKey) => {
    if (sort !== key) { setSort(key); setOrder("asc"); return; }
    if (order === "asc") { setOrder("desc"); return; }
    setSort(null);
  };
  const formSource = sources.find(s => String(s.id) === form.source_id);
  const formFields = fieldsForForm(formSource, form.items);
  const filledRows = formFields
    .filter(f => (form.items[f.id] ?? "").trim() !== "")
    .map(f => ({ kind: f.kind, amount: form.items[f.id] }));
  const hasMath = filledRows.some(r => r.kind !== "info");
  const computedNet = detailNet(filledRows);
  // Neto pisado a mano que no coincide con el detalle: se avisa, no se bloquea
  // — el recibo puede traer un concepto que no está entre los campos.
  const netGap = hasMath && form.amount.trim() !== ""
    ? Math.round((parseAmount(form.amount) - computedNet) * 100) / 100
    : 0;

  const fmtForm = form.currency === "USD" ? formatUSD : formatARS;

  const recalc = (items: Record<string, string>, fields: SourceField[]) => {
    const rows = fields
      .filter(f => (items[f.id] ?? "").trim() !== "")
      .map(f => ({ kind: f.kind, amount: items[f.id] }));
    if (!rows.some(r => r.kind !== "info")) return "";
    return Math.max(0, detailNet(rows)).toFixed(2);
  };

  const updateItem = (fieldId: number, value: string) => {
    setForm(prev => {
      const items = { ...prev.items, [fieldId]: value };
      const next = { ...prev, items };
      if (!netoManual.current) next.amount = recalc(items, fieldsForForm(formSource, items));
      return next;
    });
  };

  // Cambiar de fuente descarta el detalle: sus campos son de la otra.
  const changeSource = (id: string) =>
    setForm(prev => ({
      ...prev, source_id: id, items: {},
      amount: netoManual.current ? prev.amount : "",
    }));

  const openEdit = (entry: IncomeEntry) => {
    netoManual.current = true;
    setEditId(entry.id);
    setFormError("");
    setForm({
      source_id: String(entry.source_id),
      items: Object.fromEntries((entry.items ?? []).map(i => [String(i.field_id), String(i.amount)])),
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
    setFormError("");
    netoManual.current = false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    const payload = {
      source_id: parseInt(form.source_id),
      amount: parseAmount(form.amount),
      currency: form.currency,
      period_date: form.period_date,
      notes: form.notes || null,
      items: formFields
        .filter(f => (form.items[f.id] ?? "").trim() !== "")
        .map(f => ({ field_id: f.id, amount: parseAmount(form.items[f.id]) })),
    };
    try {
      if (editId) await api.patch(`/income/entries/${editId}`, payload);
      else await api.post("/income/entries", payload);
      closeForm();
      await load();
    } catch (err) {
      // El formulario queda abierto con lo cargado: perderlo por un error del
      // servidor obliga a tipear de nuevo un recibo entero.
      setFormError(getErrorMessage(err, "No se pudo guardar el ingreso"));
    } finally {
      setLoading(false);
    }
  };

  // Al crear desde el formulario de ingreso, la fuente nueva queda elegida, así
  // el usuario sigue donde estaba en vez de buscarla en el combo. Al editar la
  // que está elegida, el detalle ya cargado se conserva para los campos que
  // siguen existiendo.
  const handleSourceSaved = async (src: IncomeSource) => {
    const ctx = sourceModal;
    setSourceModal(null);
    await load();
    if (ctx?.fromForm) {
      setForm(p => {
        if (p.source_id === String(src.id)) {
          const keep = new Set((src.fields ?? []).map(f => String(f.id)));
          const items = Object.fromEntries(Object.entries(p.items).filter(([k]) => keep.has(k)));
          return { ...p, items };
        }
        return { ...p, source_id: String(src.id), items: {}, amount: netoManual.current ? p.amount : "" };
      });
    }
  };

  // Orden de los campos para el detalle: el de la fuente, no el de la base.
  const fieldOrder = new Map<number, number>(
    sources.flatMap(s => (s.fields ?? []).map(f => [f.id, f.position] as [number, number])),
  );

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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Ingresos</h2>
        <div className="flex items-center gap-1 shrink-0">
          {filtering ? (
            <div className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-card shadow-chip px-3 py-1.5">
              <Search className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-bold text-foreground">
                {entries.length} resultado{entries.length !== 1 ? "s" : ""}
                <span className="hidden sm:inline"> en todo el historial</span>
              </span>
            </div>
          ) : (
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
          )}
          {/* Importing is a once-in-a-while action; in the header it competed
              with the month, which is the control the user actually reaches
              for on every visit. */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button data-tour="income-import" title="Más acciones"
                className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
                <MoreVertical className="w-5 h-5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4}
                className="bg-card border rounded-xl shadow-lg p-1 w-44 z-50">
                <DropdownMenu.Item asChild>
                  <PrivacyMenuItem />
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-border my-1" />
                <DropdownMenu.Item asChild>
                  <button onClick={() => setShowSourcesList(true)}
                    className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full outline-none cursor-pointer">
                    <ListTree className="w-4 h-4 text-muted-foreground" /> Fuentes
                  </button>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <button onClick={() => setShowImport(true)}
                    className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full outline-none cursor-pointer">
                    <Upload className="w-4 h-4 text-muted-foreground" /> Importar
                  </button>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Entry form — a modal, so registering doesn't push the list down the
          page and the form keeps the focus while it's open. */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={closeForm}>
          <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">{editId ? "Editar ingreso" : "Nuevo ingreso"}</h3>
            <button type="button" onClick={closeForm} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
          {/* Same ARS/USD toggle position as the expense form. A USD income
              also adds to the dollar holding, not just to the USD balance. */}
          <CurrencyToggle className="mb-1"
            value={form.currency}
            onChange={cur => setForm(p => ({ ...p, currency: cur }))} />
          {form.currency === "USD" && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              Se suma a tu <strong>tenencia en dólares</strong> y al balance en USD, no al balance en pesos.
            </p>
          )}
          <FormGrid>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fuente</label>
              <div className="flex gap-1.5">
                <SelectField className="flex-1" required
                  value={form.source_id}
                  onChange={changeSource}
                  placeholder="Fuente de ingreso"
                  options={sources.map(s => ({ value: String(s.id), label: `${s.name} (${INCOME_TYPE_LABELS[s.income_type]})` }))} />
                {formSource && (
                  <button type="button" onClick={() => setSourceModal({ source: formSource, fromForm: true })}
                    title="Configurar campos de la fuente" aria-label="Configurar campos de la fuente"
                    className="mt-1 px-2 border rounded-lg text-muted-foreground hover:bg-accent shrink-0">
                    <Settings2 className="w-4 h-4" />
                  </button>
                )}
                <button type="button" onClick={() => setSourceModal({ fromForm: true })} title="Nueva fuente"
                  className="mt-1 px-2.5 border rounded-lg text-muted-foreground hover:bg-accent shrink-0 text-lg leading-none">+</button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Período</label>
              <DateField required
                value={form.period_date} onChange={v => setForm(p => ({ ...p, period_date: v }))} />
            </div>
            {/* Los campos de detalle son de la fuente (se configuran con el
                engranaje); una fuente sin campos es Fuente + Neto y nada más. */}
            {formFields.map(f => (
              <div key={f.id}>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 min-w-0">
                  <span className={`shrink-0 font-bold ${f.kind === "subtract" ? "text-rose-600" : f.kind === "add" ? "text-emerald-600" : ""}`}
                    title={KIND_LABELS[f.kind]}>{KIND_SIGN[f.kind]}</span>
                  <span className="truncate">{f.name}</span>
                  {!f.is_active && <span className="shrink-0 font-normal">(quitado)</span>}
                  <span className="shrink-0 font-normal">(opcional)</span>
                </label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                  aria-label={f.name}
                  value={form.items[f.id] ?? ""} onChange={e => updateItem(f.id, e.target.value)} />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">
                Neto
                {!netoManual.current && hasMath && (
                  <span className="text-muted-foreground font-normal ml-1">— calculado automáticamente</span>
                )}
              </label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                aria-label="Neto"
                value={form.amount}
                onFocus={() => { netoManual.current = true; }}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                required />
              {netoManual.current && netGap !== 0 && (
                <p className="mt-1 text-xs text-amber-700" data-testid="net-gap">
                  El detalle da {fmtForm(computedNet)}; el neto difiere en {netGap < 0 ? "− " : ""}{fmtForm(Math.abs(netGap))}.{" "}
                  <button type="button" className="underline"
                    onClick={() => { netoManual.current = false; setForm(p => ({ ...p, amount: Math.max(0, computedNet).toFixed(2) })); }}>
                    Usar el del detalle
                  </button>
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Notas (opcional)</label>
              <input className={FIELD} aria-label="Notas"
                value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </FormGrid>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
          </form>
          </Card>
        </div>
      )}

      {/* List */}

      {/* Same bar as /tarjetas — see components/ui/filters.tsx. The one box
          searches fuente and notas together: income has no "categoría"/
          "descripción" column, and which of the two the user means depends on
          how they filled the entry in. */}
      <FilterBar>
        <FilterRow>
          <CollapsibleSearch
            open={searchOpen}
            onOpen={() => setSearchOpen(true)}
            onClose={() => { setSearch(""); setSearchOpen(false); }}
            value={search}
            onChange={setSearch}
            placeholder="Buscar por fuente o notas..."
          />
          {!searchOpen && (
            <>
              {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                <SortChip key={key} label={SORT_LABELS[key]}
                  active={sort === key} dir={order} onClick={() => toggleSort(key)} />
              ))}
              <FilterChip
                label="Personalizado" icon={SlidersHorizontal}
                active={panelFilterActive}
                onClick={() => setShowCustomFilter(v => !v)}
              />
            </>
          )}
        </FilterRow>
        {showCustomFilter && !searchOpen && (
          <FilterPanel>
            <PillSelect value={sourceFilter} onChange={setSourceFilter} placeholder="Fuente"
              options={sources.map(s => ({ value: String(s.id), label: `${s.name} (${INCOME_TYPE_LABELS[s.income_type]})` }))} />
            <PillDateRange
              from={dateFrom} to={dateTo}
              onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
            />
            {panelFilterActive && (
              <ClearFilters onClick={() => { setSourceFilter(""); setDateFrom(""); setDateTo(""); }} />
            )}
          </FilterPanel>
        )}
      </FilterBar>

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
          <p className="p-6 text-muted-foreground text-sm">
            {filtering
              ? "Ningún ingreso coincide con la búsqueda."
              : `No hay ingresos registrados en ${periodLabel}.`}
          </p>
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
                {/* Only while searching: a hit on the notes is otherwise
                    invisible in the row, so the result looks unrelated to
                    what was typed. */}
                {filtering && entry.notes && (
                  <span className="block text-xs text-muted-foreground truncate">{entry.notes}</span>
                )}
                <span className="block sm:hidden text-xs text-muted-foreground">{formatDate(entry.period_date)}</span>
              </div>
              <span className="hidden sm:block w-[10ch] shrink-0 text-xs text-muted-foreground text-right truncate">{formatDate(entry.period_date)}</span>
              <span className="w-[16ch] shrink-0 text-sm font-semibold text-emerald-600 text-right truncate">{formatARS(entry.amount)}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </button>
          </div>
        ))}
      </Card>

      <Fab label="Registrar ingreso" data-tour="income-add"
        onClick={() => { setEditId(null); setForm(newEntryForm()); setFormError(""); netoManual.current = false; setShowForm(true); }} />

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          fieldOrder={fieldOrder}
          onEdit={() => { setDetailEntry(null); openEdit(detailEntry); }}
          onDelete={() => handleDelete(detailEntry.id)}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {showSourcesList && (
        <SourcesListModal
          sources={sources}
          onEdit={src => setSourceModal({ source: src, fromForm: false })}
          onNew={() => setSourceModal({ fromForm: false })}
          onClose={() => setShowSourcesList(false)}
        />
      )}

      {sourceModal && (
        <SourceFormModal
          key={sourceModal.source?.id ?? "new"}
          source={sourceModal.source}
          onSaved={handleSourceSaved}
          onClose={() => setSourceModal(null)}
        />
      )}

      {showImport && (
        <ImportModal sources={sources} onClose={() => { setShowImport(false); load(); }} />
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD, parseAmount, getErrorMessage } from "@/lib/utils";
import { Upload, X, CheckCircle2, AlertCircle, ListChecks, Search, SlidersHorizontal, MoreVertical, Settings2, ListTree } from "lucide-react";
import {
  FilterBar, FilterRow, FilterPanel, SortChip, FilterChip, PillSelect,
  PillDateRange, ClearFilters, CollapsibleSearch,
} from "@/components/ui/filters";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import ProductTour from "@/components/ProductTour";
import { MovimientosTabs } from "@/components/MovimientosTabs";
import { BreakdownStrip } from "@/components/movimientos/BreakdownStrip";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { EntrySheet, SheetActions, SheetRow } from "@/components/movimientos/EntrySheet";
import { LedgerRow, LedgerTotal, SelectionBar, ledgerAmount } from "@/components/movimientos/Ledger";
import { useMovimientos } from "@/components/movimientos/MovimientosContext";
import { useNuevo } from "@/lib/nuevo";
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
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { useExitGhost } from "@/lib/motion";
import { LoadedByTag, useLoadedBy } from "@/components/LoadedBy";

const INCOME_TOUR_STEPS: Step[] = [
  {
    // En el celular es el + de la barra; en la compu, el botón flotante.
    target: "[data-tour='nav-add'], [data-tour='income-add']",
    title: "Cargá un ingreso",
    content: "Sueldo u otra entrada. Si la fuente tiene campos de detalle (bruto, ganancias, bonos), el neto se calcula solo.",
  },
  {
    target: "[data-tour='income-import']",
    title: "Fuentes e importar",
    content: "En este menú editás los campos de cada fuente y cargás varios ingresos de una desde un Excel o CSV.",
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

// Un monto en un campo se ve como se escribe acá: "4.069.000,00". El backend manda "4069000.00".
const amountText = (n: number | string) =>
  Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A new entry defaults to today — the overwhelmingly common case, and it saves
// the user a trip through the calendar to pick the date they're standing on.
const newEntryForm = () => ({ ...EMPTY_FORM, period_date: format(new Date(), "yyyy-MM-dd") });

type SortKey = "date" | "source" | "amount";
const SORT_LABELS: Record<SortKey, string> = {
  date: "Fecha", source: "Fuente", amount: "Monto",
};

// ── Entry detail modal ─────────────────────────────────────────────────────────

function EntryDetailModal({
  entry, fieldOrder, loadedBy, onEdit, onDelete, onClose,
}: {
  entry: IncomeEntry; fieldOrder: Map<number, number>; loadedBy?: string;
  onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const fmt = entry.currency === "USD" ? formatUSD : formatARS;
  const items = [...(entry.items ?? [])].sort(
    (a, b) => (fieldOrder.get(a.field_id) ?? 0) - (fieldOrder.get(b.field_id) ?? 0),
  );
  // Primero lo que suma, después lo que resta, al final lo informativo; el
  // signo y el color dicen cuál es cuál.
  const KIND_ORDER: Record<string, number> = { add: 0, subtract: 1, info: 2 };
  const rows: EntryItem[] = [...items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  // Lo que el detalle no explica del neto: un campo que no se cargó, un
  // redondeo del recibo… Se muestra en vez de esconderlo, así el desglose
  // nunca aparenta cerrar cuando no cierra.
  const hasMath = items.some(i => i.kind !== "info");
  const gap = hasMath ? Math.round((Number(entry.amount) - detailNet(items)) * 100) / 100 : 0;
  return (
    <EntrySheet
      date={entry.period_date}
      title={entry.source.name}
      badge={{ label: INCOME_TYPE_LABELS[entry.source.income_type] }}
      amount={fmt(entry.amount)}
      positive
      onClose={onClose}
      footer={<SheetActions noun="ingreso" onEdit={onEdit} onDelete={onDelete} />}
    >
      {rows.map(i => (
        <SheetRow key={i.field_id}
          label={<>{i.name}{!i.field_active && <span className="text-[11px] ml-1">(quitado de la fuente)</span>}</>}>
          <span className={`tabular-nums ${i.kind === "add" ? "text-emerald-800" : i.kind === "subtract" ? "text-rose-700" : ""}`}>
            {i.kind === "add" ? "+ " : i.kind === "subtract" ? "− " : ""}{fmt(i.amount)}
          </span>
        </SheetRow>
      ))}
      {gap !== 0 && (
        <SheetRow label="Sin detallar">
          <span className="tabular-nums text-amber-800">{gap < 0 ? "− " : ""}{fmt(Math.abs(gap))}</span>
        </SheetRow>
      )}
      {/* El neto ya está arriba: acá sólo cierra la cuenta, si hay una. */}
      {rows.length > 0 && <SheetRow strong label="Neto"><span className="tabular-nums">{fmt(entry.amount)}</span></SheetRow>}
      {entry.notes && <SheetRow label="Notas">{entry.notes}</SheetRow>}
      {loadedBy && <SheetRow label="Lo cargó">{loadedBy}</SheetRow>}
    </EntrySheet>
  );
}

// ── Import modal ───────────────────────────────────────────────────────────────

interface PreviewData { columns: string[]; sample: string[][]; row_count: number; }
interface ImportResult { imported: number; skipped: number; errors: string[]; }

function ImportModal({ sources, onClose }: { sources: IncomeSource[]; onClose: () => void }) {
  type Step = "upload" | "map" | "importing" | "done";
  const ghost = useExitGhost<HTMLDivElement>();
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
      setError("No se pudo leer el archivo. Tiene que ser un Excel (.xlsx) o un CSV.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!file || !preview) return;
    if (!mapping.date_col || !mapping.amount_col) {
      setError("Elegí la columna de fecha y la de neto."); return;
    }
    if (!mapping.source_id && !mapping.new_source_name.trim()) {
      setError("Elegí una fuente o escribí el nombre de la nueva."); return;
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
      setError(getErrorMessage(e, "No se pudo importar el archivo. Probá de nuevo."));
      setStep("map");
    }
  };

  const NO_COL = "Ninguna";

  return (
    <div ref={ghost} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
      <Card className="p-0 md:p-0 w-full max-w-2xl max-h-[90vh] flex flex-col animate-sheet-in">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-foreground">Importar ingresos</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>

        <MotionList className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {(["Archivo", "Columnas", "Importando", "Resultado"]).map((label, i) => (
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
                  ["date_col", "Columna de fecha", true],
                  ["amount_col", "Columna de neto", true],
                  ["bruto_col", "Columna de bruto (opcional)"],
                  ["deducciones_col", "Columna de deducciones (opcional)"],
                  ["notes_col", "Columna de notas (opcional)"],
                ].map(([key, label, required]) => (
                  <div key={key as string}>
                    <label className="text-xs font-medium text-muted-foreground">{label as string}</label>
                    <SelectField
                      value={mapping[key as keyof typeof mapping]}
                      onChange={v => setMapping(m => ({ ...m, [key as string]: v }))}
                      placeholder={required ? "Elegí una columna" : NO_COL}
                      options={preview.columns.map(c => ({ value: c, label: c }))} />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Fuente de ingreso</label>
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
                    <label className="text-xs font-medium text-muted-foreground">Nombre</label>
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
              <p className="text-sm text-muted-foreground">Importando ingresos…</p>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
                <div>
                  <p className="font-semibold text-foreground">Importación terminada</p>
                  <p className="text-sm text-muted-foreground">{result.imported + result.skipped} filas procesadas</p>
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
        </MotionList>

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
  const reaccionar = useReaccion();
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const loadedBy = useLoadedBy();
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

  const { year, month, periodLabel, summary, refresh: refreshMonth, setSearching } = useMovimientos();
  // La fuente tocada en el desglose. Mira adentro del mes, a diferencia de los
  // filtros de abajo, que salen a buscar en todo el historial.
  const [pickedSource, setPickedSource] = useState<string | null>(null);
  // Qué muestra la lista ya cargada: la de otro mes funde entera (ver Egresos).
  const [listKey, setListKey] = useState("");
  // Los casilleros aparecen recién cuando se quiere borrar varios: en cada fila, siempre, son ruido.
  const [selecting, setSelecting] = useState(false);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showCustomFilter, setShowCustomFilter] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("");
  const [loadedByFilter, setLoadedByFilter] = useState("");
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

  const panelFilterActive = !!(sourceFilter || loadedByFilter || dateFrom || dateTo);
  // Any active filter takes the list out of the month view and into the whole
  // history: a search that only looks inside the month currently on screen
  // would miss what the user is looking for and give no hint that it did.
  const filtering = !!debouncedSearch || panelFilterActive;
  useEffect(() => { setSearching(filtering); return () => setSearching(false); }, [filtering, setSearching]);
  // Un mes nuevo tiene otras fuentes.
  useEffect(() => { setPickedSource(null); }, [year, month]);

  const load = async () => {
    // No chip active → the endpoint's own default ordering.
    const ordering = { sort: sort ?? "date", order: sort ? order : "desc" };
    const params = filtering
      ? {
          q: debouncedSearch || undefined,
          source_id: sourceFilter || undefined,
          loaded_by: loadedByFilter || undefined,
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
    setListKey(filtering ? "busqueda" : `${year}-${month}`);
    setSources(s.data);
    setSelected(new Set());
    if (!filtering) refreshMonth();
  };

  useEffect(() => { load(); },
    [year, month, debouncedSearch, sourceFilter, loadedByFilter, dateFrom, dateTo, sort, order]);

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
    return amountText(Math.max(0, detailNet(rows)));
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
      items: Object.fromEntries((entry.items ?? []).map(i => [String(i.field_id), amountText(i.amount)])),
      amount: amountText(entry.amount),
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
      reaccionar("ingreso", editId ? "Ingreso actualizado" : "Ingreso guardado");
      await load();
    } catch (err) {
      // El formulario queda abierto con lo cargado: perderlo por un error del
      // servidor obliga a tipear de nuevo un recibo entero.
      setFormError(getErrorMessage(err, "No se pudo guardar el ingreso"));
      reaccionar("error", "No se pudo guardar");
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
    reaccionar("guardado", "Fuente guardada");
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

  // La confirmación la pide la ficha, ahí mismo (SheetActions).
  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/income/entries/${id}`);
    } catch {
      reaccionar("error", "No se pudo eliminar");
      return;
    }
    reaccionar("borrado", "Ingreso eliminado");
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
    const n = selected.size;
    const results = await Promise.allSettled([...selected].map(id => api.delete(`/income/entries/${id}`)));
    const failed = results.filter(r => r.status === "rejected").length;
    if (failed) reaccionar("error", failed === n ? "No se pudo eliminar" : `No se pudieron eliminar ${failed} de ${n}`);
    else reaccionar("borrado", n === 1 ? "Ingreso eliminado" : `${n} ingresos eliminados`);
    setSelected(new Set());
    await load();
    setBulkDeleting(false);
  };

  const allSelected = entries.length > 0 && selected.size === entries.length;

  const openNewEntry = () => { setEditId(null); setForm(newEntryForm()); setFormError(""); netoManual.current = false; setShowForm(true); };
  useNuevo(openNewEntry, "nuevo");

  const sumOf = (rows: IncomeEntry[], usd: boolean) =>
    rows.filter(e => (e.currency === "USD") === usd).reduce((s, e) => s + Number(e.amount), 0);
  const shown = pickedSource ? entries.filter(e => e.source.name === pickedSource) : entries;
  const usdRate = Number(summary?.usd_rate ?? 0);
  const bySource = !filtering
    ? [...new Set(entries.map(e => e.source.name))].map(name => {
        const own = entries.filter(e => e.source.name === name);
        const total = sumOf(own, false);
        const total_usd = sumOf(own, true);
        return { key: name, label: name, color: "#5B4FE9", total, total_usd, ars_equivalent: total + total_usd * usdRate };
      }).sort((a, b) => b.ars_equivalent - a.ars_equivalent)
    : [];
  const pickSource = (name: string | null) => {
    setPickedSource(name);
    setSelected(new Set());
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <ProductTour tourId="income-intro" steps={INCOME_TOUR_STEPS} />
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <MovimientosTabs title="Ingresos" />
        <div className="flex items-center gap-1 shrink-0">
          {filtering && (
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
              <Search className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-bold text-foreground">
                {entries.length} resultado{entries.length !== 1 ? "s" : ""}
                <span className="hidden sm:inline"> en todo el historial</span>
              </span>
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
                className="rounded-[22px] border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota p-1.5 animate-fade-in w-44 z-50">
                <DropdownMenu.Item asChild>
                  <PrivacyMenuItem />
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <button onClick={() => setSelecting(true)}
                    className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full outline-none cursor-pointer">
                    <ListChecks className="w-4 h-4 text-muted-foreground" /> Seleccionar varios
                  </button>
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
        <FormSheet title={editId ? "Editar ingreso" : "Nuevo ingreso"} onClose={closeForm}>
          <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
          <div className={FORM_SHEET_BODY}>
          {/* El neto arriba, igual que el monto de un egreso. Lo demás lo explica. */}
          <AmountField
            label="Neto"
            hint={!netoManual.current && hasMath ? "(se calcula solo)" : undefined}
            currency={form.currency}
            toggle={<CurrencyToggle className="w-[132px]" value={form.currency}
              onChange={cur => setForm(p => ({ ...p, currency: cur }))} />}
            value={form.amount}
            onFocus={() => { netoManual.current = true; }}
            onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
            required
            footer={netoManual.current && netGap !== 0 ? (
              <p className="mt-1 text-xs text-amber-800" data-testid="net-gap">
                El detalle da {fmtForm(computedNet)}; el neto difiere en {netGap < 0 ? "− " : ""}{fmtForm(Math.abs(netGap))}.{" "}
                <button type="button" className="underline"
                  onClick={() => { netoManual.current = false; setForm(p => ({ ...p, amount: amountText(Math.max(0, computedNet)) })); }}>
                  Usar el del detalle
                </button>
              </p>
            ) : undefined}
          />
          {/* A USD income also adds to the dollar holding, not just to the USD balance. */}
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
                <button type="button" onClick={() => setSourceModal({ fromForm: true })} title="Nueva fuente" aria-label="Nueva fuente"
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
              <label className="text-xs font-medium text-muted-foreground">Notas (opcional)</label>
              <input className={FIELD} aria-label="Notas"
                value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </FormGrid>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          </div>
          <FormSheetActions onCancel={closeForm} saving={loading} label="Guardar ingreso" />
          </form>
        </FormSheet>
      )}

      {/* Con una sola fuente no hay nada que desglosar: la tabla ya lo dice. */}
      {bySource.length > 1 && (
        <BreakdownStrip title="¿De dónde entró?" rows={bySource} picked={pickedSource} onPick={pickSource} />
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
            {loadedBy.active && (
              <PillSelect value={loadedByFilter} onChange={setLoadedByFilter} placeholder="Lo cargó"
                options={loadedBy.options} />
            )}
            <PillDateRange
              from={dateFrom} to={dateTo}
              onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
            />
            {panelFilterActive && (
              <ClearFilters onClick={() => { setSourceFilter(""); setLoadedByFilter(""); setDateFrom(""); setDateTo(""); }} />
            )}
          </FilterPanel>
        )}
      </FilterBar>

      <MotionList as="section" key={listKey} className="px-2 space-y-1 animate-page-in">
        {selecting && (
          <SelectionBar count={selected.size} allSelected={allSelected} deleting={bulkDeleting}
            onToggleAll={toggleAll} onDelete={handleBulkDelete}
            onCancel={() => { setSelecting(false); setSelected(new Set()); }} />
        )}
        {shown.length === 0 ? (
          <p className="py-6 text-muted-foreground text-[15px]">
            {filtering
              ? "Ningún ingreso coincide con la búsqueda."
              : `No hay ingresos registrados en ${periodLabel}.`}
          </p>
        ) : (
          <MotionList>
            {shown.map((entry, i) => (
              <LedgerRow key={entry.id}
                date={entry.period_date}
                showDate={!(!sort || sort === "date") || i === 0 || shown[i - 1].period_date !== entry.period_date}
                title={entry.source.name}
                sub={(entry.notes || loadedBy.nameOf(entry.user_id)) ? <>
                  {entry.notes && <span className="block truncate">{entry.notes}</span>}
                  <LoadedByTag name={loadedBy.nameOf(entry.user_id)} />
                </> : undefined}
                amount={ledgerAmount(entry.amount, entry.currency)}
                positive
                onOpen={() => setDetailEntry(entry)}
                selecting={selecting}
                selected={selected.has(entry.id)}
                onToggle={() => toggleSelect(entry.id)}
              />
            ))}
          </MotionList>
        )}
        {shown.length > 0 && (
          <LedgerTotal positive label={pickedSource ? `Total de ${pickedSource}` : "Total"}
            ars={sumOf(shown, false)} usd={sumOf(shown, true)} />
        )}
      </MotionList>

      <Fab label="Registrar ingreso" data-tour="income-add" onClick={openNewEntry} />

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          fieldOrder={fieldOrder}
          loadedBy={loadedBy.nameOf(detailEntry.user_id)}
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

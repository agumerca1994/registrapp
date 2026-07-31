"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { formatARS, formatDate, formatUSD, parseAmount, pickCategoryColor } from "@/lib/utils";
import { Plus, Trash2, Pencil, X, ChevronRight, CreditCard, ExternalLink } from "lucide-react";
import ProductTour from "@/components/ProductTour";
import type { Step } from "react-joyride";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const EXPENSES_TOUR_STEPS: Step[] = [
  {
    target: "[data-tour='expenses-add']",
    content: "Con este botón registrás un nuevo egreso, eligiendo una categoría.",
    placement: "bottom",
    skipBeacon: true,
  },
];

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }
interface ExpenseEntry {
  id: number; category_id: number; amount: number;
  description?: string; expense_date: string; notes?: string;
  payment_method?: string; entity?: string; currency?: string;
  category: Category;
}

const EMPTY_FORM = { category_id: "", amount: "", description: "", expense_date: "", notes: "", currency: "ARS" as "ARS" | "USD" };

function EntryDetailModal({
  entry, onEdit, onDelete, onViewStatement, onClose,
}: {
  entry: ExpenseEntry;
  onEdit: () => void;
  onDelete: () => void;
  onViewStatement: () => void;
  onClose: () => void;
}) {
  const isCreditCard = entry.payment_method === "tarjeta_credito";
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: entry.category.color || "#6366f1" }} />
            <h3 className="font-semibold text-foreground">{entry.description || entry.category.name}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="divide-y text-sm">
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Fecha</span>
            <span className="font-medium">{formatDate(entry.expense_date)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Categoría</span>
            <span className="font-medium">{entry.category.name}</span>
          </div>
          {entry.description && entry.description !== entry.category.name && (
            <div className="flex justify-between py-2 gap-4">
              <span className="text-muted-foreground shrink-0">Descripción</span>
              <span className="font-medium text-right">{entry.description}</span>
            </div>
          )}
          <div className="flex justify-between py-2">
            <span className="font-medium text-foreground">Monto</span>
            <span className="font-bold text-rose-600 text-base">{formatARS(entry.amount)}</span>
          </div>
          {isCreditCard && (
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Tarjeta</span>
              <span className="flex items-center gap-1 font-medium text-primary">
                <CreditCard className="w-3.5 h-3.5" />{entry.entity}
              </span>
            </div>
          )}
          {entry.notes && (
            <div className="flex justify-between py-2 gap-4">
              <span className="text-muted-foreground shrink-0">Notas</span>
              <span className="font-medium text-right">{entry.notes}</span>
            </div>
          )}
        </div>
        {isCreditCard ? (
          <div className="pt-1">
            <p className="text-xs text-muted-foreground mb-2 text-center">Este gasto es de tarjeta. Para editar o eliminar, ir al resumen.</p>
            <Button onClick={onViewStatement} className="w-full">
              <ExternalLink className="w-4 h-4" /> Ver en resumen
            </Button>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <Button variant="destructive" onClick={onDelete} className="flex-1">
              <Trash2 className="w-4 h-4" /> Eliminar
            </Button>
            <Button onClick={onEdit} className="flex-1">
              <Pencil className="w-4 h-4" /> Editar
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ExpensesPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [catForm, setCatForm] = useState({ name: "", color: "#6366f1", is_fixed: false });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [detailEntry, setDetailEntry] = useState<ExpenseEntry | null>(null);

  const load = async () => {
    const [e, c] = await Promise.all([api.get("/expenses/entries"), api.get("/expenses/categories")]);
    setEntries(e.data);
    setCategories(c.data);
  };

  useEffect(() => { load(); }, []);

  const openEdit = (entry: ExpenseEntry) => {
    setEditId(entry.id);
    setForm({
      category_id: String(entry.category_id), amount: String(entry.amount),
      description: entry.description || "", expense_date: entry.expense_date, notes: entry.notes || "",
      currency: (entry.currency as "ARS" | "USD") || "ARS",
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload: Record<string, unknown> = {
      amount: parseAmount(form.amount),
      description: form.description,
      expense_date: form.expense_date,
      notes: form.notes,
      currency: form.currency,
    };
    if (form.currency === "ARS") payload.category_id = parseInt(form.category_id);
    if (editId) await api.patch(`/expenses/entries/${editId}`, payload);
    else await api.post("/expenses/entries", payload);
    closeForm();
    await load();
    setLoading(false);
  };

  const handleAddCat = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/expenses/categories", catForm);
    setCatForm({ name: "", color: "#6366f1", is_fixed: false });
    setShowCatForm(false);
    await load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminar este egreso?")) return;
    await api.delete(`/expenses/entries/${id}`);
    setSelected(s => { const n = new Set(s); n.delete(id); return n; });
    setDetailEntry(null);
    await load();
  };

  const handleViewStatement = async (entryId: number) => {
    try {
      const res = await api.get(`/credit-cards/for-expense/${entryId}`);
      const { card_id, statement_id } = res.data;
      setDetailEntry(null);
      router.push(`/tarjetas/${card_id}/${statement_id}`);
    } catch {
      alert("No se encontro el resumen de tarjeta.");
    }
  };

  const selectableEntries = entries.filter(e => e.payment_method !== "tarjeta_credito");

  const toggleSelect = (id: number) => {
    const entry = entries.find(e => e.id === id);
    if (entry?.payment_method === "tarjeta_credito") return;
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const toggleAll = () =>
    setSelected(s => s.size === selectableEntries.length ? new Set() : new Set(selectableEntries.map(e => e.id)));

  const handleBulkDelete = async () => {
    if (!confirm(`Eliminar ${selected.size} egreso${selected.size !== 1 ? "s" : ""}?`)) return;
    setBulkDeleting(true);
    await Promise.all([...selected].map(id => api.delete(`/expenses/entries/${id}`)));
    setSelected(new Set());
    await load();
    setBulkDeleting(false);
  };

  const allSelected = selectableEntries.length > 0 && selected.size === selectableEntries.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <ProductTour tourId="expenses-intro" steps={EXPENSES_TOUR_STEPS} />
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Egresos</h2>
        <div className="flex gap-1 md:gap-2 shrink-0">
          <Button variant="outline" onClick={() => {
            setCatForm(p => ({ ...p, color: pickCategoryColor(categories.map(c => c.color)) }));
            setShowCatForm(true);
          }}>
            + Categoría
          </Button>
          <Button onClick={() => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); }} data-tour="expenses-add">
            <Plus className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Registrar</span>
          </Button>
        </div>
      </div>

      {showCatForm && (
        <Card className="p-4">
          <form onSubmit={handleAddCat}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Supermercado"
                value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} required />
            </div>
            <div className="flex items-end gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Color</label>
                <input type="color" className="mt-1 block h-9 w-12 border rounded-lg cursor-pointer"
                  value={catForm.color} onChange={e => setCatForm(p => ({ ...p, color: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={catForm.is_fixed}
                  onChange={e => setCatForm(p => ({ ...p, is_fixed: e.target.checked }))} />
                Fijo
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button type="button" variant="outline" onClick={() => setShowCatForm(false)}>Cancelar</Button>
            <Button type="submit">Guardar</Button>
          </div>
          </form>
        </Card>
      )}

      {showForm && (
        <Card className="p-4 md:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm font-medium text-foreground">{editId ? "Editar egreso" : "Nuevo egreso"}</p>
          <div className="flex gap-2 mb-1">
            {(["ARS", "USD"] as const).map(cur => (
              <button key={cur} type="button"
                onClick={() => setForm(p => ({ ...p, currency: cur, category_id: cur === "USD" ? "" : p.category_id }))}
                className={`flex-1 py-1.5 text-xs rounded-full border-2 font-medium transition-colors ${form.currency === cur ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent"}`}>
                {cur === "ARS" ? "$ ARS" : "U$D"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {form.currency === "USD" ? (
              <div className="sm:col-span-2">
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  Se agrega automáticamente a la categoría <strong>Consumo en dólares</strong>
                </p>
              </div>
            ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))} required={form.currency === "ARS"}>
                <option value="">Selecciona una categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha</label>
              <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.expense_date} onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Monto ($)</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
                value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Descripción</label>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
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
          <p className="p-6 text-muted-foreground text-sm">No hay egresos registrados.</p>
        ) : entries.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 px-3 md:px-4 py-3">
            {entry.payment_method === "tarjeta_credito" ? (
                <div className="w-4 h-4 shrink-0" />
              ) : (
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  onChange={() => toggleSelect(entry.id)}
                  className="w-4 h-4 rounded cursor-pointer shrink-0"
                />
              )}
            <button
              className="flex-1 flex items-center gap-2 min-w-0 text-left hover:opacity-80 active:opacity-60"
              onClick={() => setDetailEntry(entry)}
            >
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.category.color || "#6366f1" }} />
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-foreground truncate">
                  {entry.description || entry.category.name}
                </span>
                {entry.payment_method === "tarjeta_credito" && (
                  <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                    <CreditCard className="w-3 h-3" />{entry.entity}
                  </span>
                )}
                <span className="block sm:hidden text-xs text-muted-foreground">{formatDate(entry.expense_date)}</span>
              </div>
              <span className="hidden sm:block w-[10ch] shrink-0 text-xs text-muted-foreground text-right truncate">{formatDate(entry.expense_date)}</span>
              <span className="w-[18ch] shrink-0 text-sm font-semibold text-rose-600 text-right truncate">{entry.currency === "USD" ? formatUSD(entry.amount) : formatARS(entry.amount)}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </button>
          </div>
        ))}
        {entries.length > 0 && (() => {
          const arsTotal = entries.filter(e => e.currency !== "USD").reduce((s, e) => s + Number(e.amount), 0);
          const usdTotal = entries.filter(e => e.currency === "USD").reduce((s, e) => s + Number(e.amount), 0);
          return (
            <div className="flex items-center justify-between px-4 py-3 bg-muted border-t rounded-b-2xl flex-wrap gap-1">
              <span className="text-sm font-medium text-foreground">Total</span>
              <div className="flex flex-col items-end gap-0.5">
                {arsTotal > 0 && <span className="text-base font-bold text-rose-600">{formatARS(arsTotal)}</span>}
                {usdTotal > 0 && <span className="text-sm font-bold text-emerald-600">U$D {usdTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>}
              </div>
            </div>
          );
        })()}
      </Card>

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          onEdit={() => { setDetailEntry(null); openEdit(detailEntry); }}
          onDelete={() => handleDelete(detailEntry.id)}
          onViewStatement={() => handleViewStatement(detailEntry.id)}
          onClose={() => setDetailEntry(null)}
        />
      )}
    </div>
  );
}

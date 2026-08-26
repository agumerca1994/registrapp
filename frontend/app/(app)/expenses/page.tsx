"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatDate, formatUSD, parseAmount, pickCategoryColor } from "@/lib/utils";
import { Trash2, Pencil, X, ChevronRight, CreditCard, ExternalLink, CalendarDays, ChevronLeft, Search, SlidersHorizontal, MoreVertical } from "lucide-react";
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
import { CurrencyToggle, FIELD, FormGrid, SelectField, DateField } from "@/components/ui/form";
import NewCategoryModal from "@/components/NewCategoryModal";
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

// A new entry defaults to today — the overwhelmingly common case, and it saves
// the user a trip through the calendar to pick the date they're standing on.
const newEntryForm = () => ({ ...EMPTY_FORM, expense_date: format(new Date(), "yyyy-MM-dd") });

type SortKey = "date" | "category" | "amount";
const SORT_LABELS: Record<SortKey, string> = {
  date: "Fecha", category: "Categoría", amount: "Monto",
};

// Opened from the `+` next to the Categoría combo inside the entry form, the
// way a card statement offers "nueva categoría" next to its own combo:
// creating what you're missing shouldn't cost you the form you already began.

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
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [detailEntry, setDetailEntry] = useState<ExpenseEntry | null>(null);

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
  const [categoryFilter, setCategoryFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<SortKey | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  // One request when the user stops typing, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const panelFilterActive = !!(categoryFilter || currencyFilter || dateFrom || dateTo);
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
          category_id: categoryFilter || undefined,
          currency: currencyFilter || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          ...ordering,
        }
      : { year, month, ...ordering };
    const [e, c] = await Promise.all([
      api.get("/expenses/entries", { params }),
      api.get("/expenses/categories"),
    ]);
    setEntries(e.data);
    setCategories(c.data);
    setSelected(new Set());
  };

  useEffect(() => { load(); },
    [year, month, debouncedSearch, categoryFilter, currencyFilter, dateFrom, dateTo, sort, order]);

  // Tap cycle: inactive -> asc -> desc -> inactive (back to the default).
  const toggleSort = (key: SortKey) => {
    if (sort !== key) { setSort(key); setOrder("asc"); return; }
    if (order === "asc") { setOrder("desc"); return; }
    setSort(null);
  };

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
    if (form.category_id) payload.category_id = parseInt(form.category_id);
    if (editId) await api.patch(`/expenses/entries/${editId}`, payload);
    else await api.post("/expenses/entries", payload);
    closeForm();
    await load();
    setLoading(false);
  };

  // Selects the category it just created, so the form the user was filling
  // picks up where they left off instead of making them find it in the combo.
  const handleAddCat = async (cat: { name: string; color: string; is_fixed: boolean }) => {
    const { data } = await api.post("/expenses/categories", cat);
    setShowCatForm(false);
    await load();
    setForm(p => ({ ...p, category_id: String(data.id) }));
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Egresos</h2>
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button title="Más acciones"
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
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={closeForm}>
          <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">{editId ? "Editar egreso" : "Nuevo egreso"}</h3>
            <button type="button" onClick={closeForm} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
          <CurrencyToggle className="mb-1"
            value={form.currency}
            onChange={cur => setForm(p => ({ ...p, currency: cur }))} />
          <FormGrid>
            {/* USD expenses get a real category too — a trip paid in dollars
                belongs in "Viajes", not in a currency bucket. Leaving it empty
                falls back to "Consumo en dólares". */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Categoría
                {form.currency === "USD" && (
                  <span className="font-normal text-muted-foreground/80"> — opcional</span>
                )}
              </label>
              <div className="flex gap-1.5">
                <SelectField className="flex-1" required={form.currency === "ARS"}
                  value={form.category_id}
                  onChange={v => setForm(p => ({ ...p, category_id: v }))}
                  placeholder={form.currency === "USD" ? "Consumo en dólares" : "Categoría"}
                  options={categories.map(c => ({ value: String(c.id), label: c.name }))} />
                <button type="button" title="Nueva categoría"
                  onClick={() => setShowCatForm(true)}
                  className="mt-1 px-2.5 border-2 border-ink rounded-lg text-muted-foreground hover:bg-accent shrink-0 text-lg leading-none">+</button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha</label>
              <DateField required
                value={form.expense_date} onChange={v => setForm(p => ({ ...p, expense_date: v }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Monto</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Descripción (opcional)</label>
              <input className={FIELD}
                value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
          </FormGrid>
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

      {/* Same bar as /tarjetas and /ingresos — see components/ui/filters.tsx.
          One box searches description, category, card alias and notes: a row
          shows `description || category`, so any of them is what the user
          remembers about the expense they're looking for. */}
      <FilterBar>
        <FilterRow>
          <CollapsibleSearch
            open={searchOpen}
            onOpen={() => setSearchOpen(true)}
            onClose={() => { setSearch(""); setSearchOpen(false); }}
            value={search}
            onChange={setSearch}
            placeholder="Buscar por descripción, categoría o tarjeta..."
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
            <PillSelect value={categoryFilter} onChange={setCategoryFilter} placeholder="Categoría"
              options={categories.map(c => ({ value: String(c.id), label: c.name }))} />
            <PillSelect value={currencyFilter} onChange={setCurrencyFilter} placeholder="Moneda"
              options={[{ value: "ARS", label: "Pesos" }, { value: "USD", label: "Dólares" }]} />
            <PillDateRange
              from={dateFrom} to={dateTo}
              onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
            />
            {panelFilterActive && (
              <ClearFilters onClick={() => {
                setCategoryFilter(""); setCurrencyFilter(""); setDateFrom(""); setDateTo("");
              }} />
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
              ? "Ningún egreso coincide con la búsqueda."
              : `No hay egresos registrados en ${periodLabel}.`}
          </p>
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
                {/* Only while searching, and only when the title is the
                    description: a hit on the category is otherwise invisible
                    and the row looks unrelated to what was typed. */}
                {filtering && entry.description && (
                  <span className="block text-xs text-muted-foreground truncate">{entry.category.name}</span>
                )}
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
                {usdTotal > 0 && <span className="text-sm font-bold text-emerald-600">{formatUSD(usdTotal)}</span>}
              </div>
            </div>
          );
        })()}
      </Card>

      <Fab label="Registrar egreso" data-tour="expenses-add"
        onClick={() => { setEditId(null); setForm(newEntryForm()); setShowForm(true); }} />

      {showCatForm && (
        <NewCategoryModal
          initialColor={pickCategoryColor(categories.map(c => c.color))}
          onSave={handleAddCat}
          onClose={() => setShowCatForm(false)}
        />
      )}

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

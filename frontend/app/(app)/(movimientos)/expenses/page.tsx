"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { MonthPill } from "@/components/dashboard/MonthPill";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD } from "@/lib/utils";
import { X, ChevronRight, ListChecks, Search, SlidersHorizontal, MoreVertical } from "lucide-react";
import {
  FilterBar, FilterRow, FilterPanel, SortChip, FilterChip, PillSelect,
  PillDateRange, ClearFilters, CollapsibleSearch,
} from "@/components/ui/filters";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import ProductTour from "@/components/ProductTour";
import { MovimientosTabs } from "@/components/MovimientosTabs";
import { BreakdownStrip } from "@/components/movimientos/BreakdownStrip";
import { EntrySheet, SheetActions, SheetLink, SheetRow } from "@/components/movimientos/EntrySheet";
import { LedgerRow, LedgerTotal, SelectionBar, ledgerAmount } from "@/components/movimientos/Ledger";
import { PendingChip, RecurrencePanel, type RecurrenceStatus } from "@/components/recurrences/RecurrencePanel";
import { useMovimientos } from "@/components/movimientos/MovimientosContext";
import { useNuevo } from "@/lib/nuevo";
import type { Step } from "react-joyride";
import { Card } from "@/components/ui/card";
import { Fab } from "@/components/ui/fab";
import ExpenseFormModal, { type ExpenseSaved } from "@/components/expense/ExpenseFormModal";
import { draftFromParams, newDraft, type ExpenseDraft } from "@/components/expense/submit";
import { useAuth } from "@/contexts/AuthContext";
import { isBusiness } from "@/lib/account";
import type { Payee } from "@/components/business/types";
import BusinessTour from "@/components/business/BusinessTour";
import { LoadedByTag, useLoadedBy } from "@/components/LoadedBy";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { EXPENSES_BUSINESS_INTRO_STEPS } from "@/components/business/tours";

const EXPENSES_TOUR_STEPS: Step[] = [
  {
    target: "[data-tour='month-card']",
    title: "Cómo viene el mes",
    content: "Lo que te queda en pesos y en dólares. En Ver detalle están las cuentas.",
  },
  {
    target: "[data-tour='expenses-breakdown']",
    title: "¿En qué se fue la plata?",
    content: "Tocá una categoría y la lista de abajo muestra sólo sus gastos. Los que no entran se ven deslizando.",
  },
  {
    target: "[data-tour='expenses-list']",
    title: "Lo que salió este mes",
    content: "Una compra con tarjeta aparece el mes en que se paga, con la fecha en que la hiciste. Tocá una fila para ver el detalle o editarla.",
  },
  {
    // En el celular es el + de la barra; en la compu, el botón flotante.
    target: "[data-tour='nav-add'], [data-tour='expenses-add']",
    title: "Cargá un gasto",
    content: "En efectivo, con tarjeta o compartido, con el mismo formulario.",
  },
];

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }
interface ExpenseEntry {
  id: number; category_id: number; amount: number;
  description?: string; expense_date: string; notes?: string;
  payment_method?: string; entity?: string; currency?: string;
  payee_id?: number | null;
  user_id?: number | null; source?: string | null;
  recurrence_id?: number | null; recurrence_status?: RecurrenceStatus | null;
  category: Category;
}

// La cuota de un crédito la genera la sincronización: nadie la cargó.
const loaderId = (entry: ExpenseEntry) => (entry.source === "mortgage" ? null : entry.user_id);

/** "Incluye $ 9.500 a confirmar": lo recurrente que todavía no se confirmó ya suma en el total. */
function pendingNote(rows: ExpenseEntry[]): string | undefined {
  const pending = rows.filter(e => e.recurrence_status === "pending");
  if (!pending.length) return undefined;
  const ars = pending.filter(e => e.currency !== "USD").reduce((s, e) => s + Number(e.amount), 0);
  const usd = pending.filter(e => e.currency === "USD").reduce((s, e) => s + Number(e.amount), 0);
  const parts = [ars > 0 ? ledgerAmount(ars) : null, usd > 0 ? ledgerAmount(usd, "USD") : null].filter(Boolean);
  return `Incluye ${parts.join(" y ")} a confirmar`;
}

type SortKey = "date" | "category" | "amount";
const SORT_LABELS: Record<SortKey, string> = {
  date: "Fecha", category: "Categoría", amount: "Monto",
};

// Opened from the `+` next to the Categoría combo inside the entry form, the
// way a card statement offers "nueva categoría" next to its own combo:
// creating what you're missing shouldn't cost you the form you already began.

function EntryDetailModal({
  entry, payeeName, loadedBy, onEdit, onDelete, onViewStatement, onViewMortgage, onRecurrenceChanged, onClose,
}: {
  entry: ExpenseEntry;
  payeeName?: string;
  loadedBy?: string;
  onEdit: () => void;
  onDelete: () => void;
  onViewStatement: () => void;
  onViewMortgage: () => void;
  onRecurrenceChanged: () => void;
  onClose: () => void;
}) {
  const isCreditCard = entry.payment_method === "tarjeta_credito";
  const actions = isCreditCard ? (
    <SheetLink note="Es de tarjeta: se edita o se elimina desde su resumen." label="Ver en resumen" onClick={onViewStatement} />
  ) : entry.source === "mortgage" ? (
    <SheetLink note="Es la cuota de un crédito: la registra la app y se maneja desde Créditos." label="Ver créditos" onClick={onViewMortgage} />
  ) : (
    // Un mes a confirmar no se elimina suelto: cortaría la cadena sin decidir el
    // siguiente. Para eso está "Este mes no", que pregunta.
    <SheetActions noun="egreso" onEdit={onEdit} onDelete={entry.recurrence_status === "pending" ? undefined : onDelete} />
  );
  return (
    <EntrySheet
      date={entry.expense_date}
      title={entry.description || entry.category.name}
      badge={{ label: entry.category.name, color: entry.category.color || "#6366f1" }}
      amount={entry.currency === "USD" ? formatUSD(entry.amount) : formatARS(entry.amount)}
      onClose={onClose}
      footer={entry.recurrence_id && entry.recurrence_status ? (
        // Confirmar también un recurrente de tarjeta desde acá: es el mismo mes.
        <div className="space-y-2.5">
          <RecurrencePanel entryId={entry.id} recurrenceId={entry.recurrence_id} status={entry.recurrence_status}
            amount={entry.amount} currency={entry.currency} date={entry.expense_date} onChanged={onRecurrenceChanged} />
          {actions}
        </div>
      ) : actions}
    >
      {isCreditCard && <SheetRow label="Tarjeta">{entry.entity}</SheetRow>}
      {payeeName && <SheetRow label="Pagado a">{payeeName}</SheetRow>}
      {entry.notes && <SheetRow label="Notas">{entry.notes}</SheetRow>}
      {loadedBy && <SheetRow label="Lo cargó">{loadedBy}</SheetRow>}
    </EntrySheet>
  );
}

export default function ExpensesPage() {
  const reaccionar = useReaccion();
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const { appUser } = useAuth();
  const business = isBusiness(appUser);
  const loadedBy = useLoadedBy();
  const [payees, setPayees] = useState<Payee[]>([]);
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // El formulario unificado (components/expense). `key` cambia en cada
  // apertura para que siempre arranque limpio: fecha de hoy, efectivo, sin
  // compartir.
  const [formState, setFormState] = useState<null | { mode: "create"; initial?: ExpenseDraft } | { mode: "edit"; entry: ExpenseEntry }>(null);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<ExpenseSaved | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [detailEntry, setDetailEntry] = useState<ExpenseEntry | null>(null);

  const { year, month, prev, next, goTo, periodLabel, summary, refresh: refreshMonth, setSearching } = useMovimientos();
  // `?abrir=<id>` (un recurrente a confirmar, desde Inicio o el calendario):
  // se abre su ficha apenas el gasto aparece en la lista de su mes.
  const [openId, setOpenId] = useState<number | null>(null);
  // Lo comprado este mes que todavía no salió: la tabla cuenta por fecha de pago,
  // y sin esto una compra con tarjeta recién cargada no se ve por ningún lado.
  const [later, setLater] = useState<ExpenseEntry[]>([]);
  // Qué muestra la lista ya cargada. Cambia junto con las filas, no al tocar el mes: la
  // lista de otro mes funde entera en vez de sacar y meter todas sus filas una por una.
  const [listKey, setListKey] = useState("");
  const [laterOpen, setLaterOpen] = useState(false);
  // La categoría tocada en el desglose. Mira adentro del mes, a diferencia de los
  // filtros de abajo, que salen a buscar en todo el historial.
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  // Los casilleros aparecen recién cuando se quiere borrar varios: en cada fila, siempre, son ruido.
  const [selecting, setSelecting] = useState(false);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showCustomFilter, setShowCustomFilter] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [payeeFilter, setPayeeFilter] = useState("");
  const [loadedByFilter, setLoadedByFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<SortKey | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  // One request when the user stops typing, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const panelFilterActive = !!(categoryFilter || currencyFilter || payeeFilter || loadedByFilter || dateFrom || dateTo);
  // Any active filter takes the list out of the month view and into the whole
  // history: a search that only looks inside the month currently on screen
  // would miss what the user is looking for and give no hint that it did.
  const filtering = !!debouncedSearch || panelFilterActive;
  useEffect(() => { setSearching(filtering); return () => setSearching(false); }, [filtering, setSearching]);
  // Un mes nuevo tiene otras categorías.
  useEffect(() => { setPickedCategory(null); }, [year, month]);

  const load = async () => {
    // Un negocio sigue viendo su libro por fecha de compra: no tiene la tarjeta
    // del mes arriba con la que tenga que coincidir.
    const monthView = !filtering && !business;
    // No chip active → the endpoint's own default ordering.
    const ordering = { sort: sort ?? "date", order: sort ? order : "desc" };
    const params = filtering
      ? {
          q: debouncedSearch || undefined,
          category_id: categoryFilter || undefined,
          currency: currencyFilter || undefined,
          payee_id: payeeFilter || undefined,
          loaded_by: loadedByFilter || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          ...ordering,
        }
      : { year, month, ...(monthView ? { basis: "payment" } : {}), ...ordering };
    const [e, c, bought] = await Promise.all([
      api.get<ExpenseEntry[]>("/expenses/entries", { params }),
      api.get("/expenses/categories"),
      monthView ? api.get<ExpenseEntry[]>("/expenses/entries", { params: { year, month, ...ordering } }) : null,
    ]);
    setEntries(e.data);
    setListKey(filtering ? "busqueda" : `${year}-${month}`);
    setCategories(c.data);
    const paying = new Set(e.data.map(x => x.id));
    setLater(bought ? bought.data.filter(x => !paying.has(x.id)) : []);
    setSelected(new Set());
    if (monthView) refreshMonth();
  };

  useEffect(() => { load(); },
    [year, month, debouncedSearch, categoryFilter, currencyFilter, payeeFilter, loadedByFilter, dateFrom, dateTo, sort, order]);

  // Los nombres de proveedores y empleados: para el filtro, las filas y el
  // detalle (el egreso trae sólo el id).
  useEffect(() => {
    if (!business) return;
    api.get<Payee[]>("/payees?include_inactive=true").then(({ data }) => setPayees(data)).catch(() => {});
  }, [business]);
  const payeeName = (id?: number | null) => (id ? payees.find(p => p.id === id)?.name : undefined);

  // `?nuevo=1` abre "Nuevo egreso" al llegar. Es la puerta del `+` del
  // dashboard: cargar un gasto desde el inicio usa este mismo formulario, no una
  // segunda pantalla de alta. La marca se borra de la URL enseguida para que
  // recargar o volver atrás no reabra el modal.
  //
  // Se lee `window.location` en vez de `useSearchParams` a propósito: este
  // último obliga a envolver la página entera en un límite de Suspense para
  // que el build pueda prerenderizarla, y acá sólo hace falta mirar una vez.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // `?payee_id=` viene de Proveedores y empleados ("ver sus gastos"): entra
    // con el filtro puesto y el panel abierto, así se ve por qué la lista es esa.
    const mes = params.get("mes");
    const abrir = Number(params.get("abrir"));
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      const [y, m] = mes.split("-").map(Number);
      goTo(y, m);
    }
    if (abrir > 0) setOpenId(abrir);
    if (mes || abrir) router.replace("/expenses");
    const payee = params.get("payee_id");
    if (payee) {
      setPayeeFilter(payee);
      setShowCustomFilter(true);
      router.replace("/expenses");
    }
    if (params.get("nuevo") !== "1") return;
    // Los links del bot traen el formulario lleno (una factura que se debita
    // de una tarjeta): se abre con eso y la persona elige lo que falta.
    openCreate(draftFromParams(params, format(new Date(), "yyyy-MM-dd")));
    router.replace("/expenses");
    // Sólo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tap cycle: inactive -> asc -> desc -> inactive (back to the default).
  const toggleSort = (key: SortKey) => {
    if (sort !== key) { setSort(key); setOrder("asc"); return; }
    if (order === "asc") { setOrder("desc"); return; }
    setSort(null);
  };

  const openCreate = (initial?: ExpenseDraft) => { setFormKey(k => k + 1); setFormState({ mode: "create", initial }); };
  const openEdit = (entry: ExpenseEntry) => { setFormKey(k => k + 1); setFormState({ mode: "edit", entry }); };
  useNuevo(() => openCreate());
  const closeForm = () => setFormState(null);

  const handleSaved = async (result: ExpenseSaved) => {
    closeForm();
    reaccionar("guardado", result.kind === "shared" ? "Gasto compartido guardado"
      : result.kind === "card" ? "Compra con tarjeta guardada" : "Egreso guardado");
    // Un egreso simple se ve en la lista; los de tarjeta y los compartidos
    // además tienen otra casa, y el aviso dice dónde quedaron.
    setNotice(result.kind === "simple" ? null : result);
    // Se paga más adelante: abierto, para que se vea que quedó cargada.
    if (result.kind === "card") setLaterOpen(true);
    await load();
  };

  // La confirmación la pide la ficha, ahí mismo (SheetActions).
  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/expenses/entries/${id}`);
    } catch {
      reaccionar("error", "No se pudo eliminar");
      return;
    }
    reaccionar("borrado", "Egreso eliminado");
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
      alert("No se encontró el resumen de tarjeta de este gasto.");
    }
  };

  const shown = pickedCategory ? entries.filter(e => e.category.name === pickedCategory) : entries;

  useEffect(() => {
    if (openId === null) return;
    const hit = entries.find(e => e.id === openId) ?? later.find(e => e.id === openId);
    if (hit) { setDetailEntry(hit); setOpenId(null); }
  }, [openId, entries, later]);
  const selectableEntries = shown.filter(e => e.payment_method !== "tarjeta_credito" && e.source !== "mortgage");

  const pickCategory = (name: string | null) => {
    setPickedCategory(name);
    setSelected(new Set());
  };

  const toggleSelect = (id: number) => {
    const entry = entries.find(e => e.id === id);
    if (entry?.payment_method === "tarjeta_credito" || entry?.source === "mortgage") return;
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const toggleAll = () =>
    setSelected(s => s.size === selectableEntries.length ? new Set() : new Set(selectableEntries.map(e => e.id)));

  const handleBulkDelete = async () => {
    if (!confirm(`¿Eliminar ${selected.size} egreso${selected.size !== 1 ? "s" : ""}?`)) return;
    setBulkDeleting(true);
    const n = selected.size;
    const results = await Promise.allSettled([...selected].map(id => api.delete(`/expenses/entries/${id}`)));
    const failed = results.filter(r => r.status === "rejected").length;
    if (failed) reaccionar("error", failed === n ? "No se pudo eliminar" : `No se pudieron eliminar ${failed} de ${n}`);
    else reaccionar("borrado", n === 1 ? "Egreso eliminado" : `${n} egresos eliminados`);
    setSelected(new Set());
    await load();
    setBulkDeleting(false);
  };

  const allSelected = selectableEntries.length > 0 && selected.size === selectableEntries.length;

  // Ordenada por fecha, el día se escribe una sola vez. Ordenada por otra cosa,
  // cada fila lleva el suyo: los días ya no quedan seguidos.
  const byDate = !sort || sort === "date";
  const renderRows = (rows: ExpenseEntry[], canSelect = true) => rows.map((entry, i) => {
    const card = entry.payment_method === "tarjeta_credito";
    // La fecha de una compra con tarjeta puede ser de otro mes: es la de la compra.
    const detail = [entry.description ? entry.category.name : null, card ? entry.entity : null, payeeName(entry.payee_id)]
      .filter(Boolean).join(" · ");
    return (
      <LedgerRow key={entry.id}
        date={entry.expense_date}
        showDate={!byDate || i === 0 || rows[i - 1].expense_date !== entry.expense_date}
        title={entry.description || entry.category.name}
        sub={<>
          <span className="flex items-center gap-1.5 min-w-0">
            {entry.recurrence_status === "pending" && <PendingChip />}
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.category.color || "#6366f1" }} />
            <span className="truncate">{detail || entry.category.name}</span>
          </span>
          <LoadedByTag name={loadedBy.nameOf(loaderId(entry))} />
        </>}
        amount={ledgerAmount(entry.amount, entry.currency)}
        onOpen={() => setDetailEntry(entry)}
        selecting={selecting && canSelect}
        selectable={!card}
        selected={selected.has(entry.id)}
        onToggle={() => toggleSelect(entry.id)}
      />
    );
  });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const laterArs = later.filter(e => e.currency !== "USD").reduce((s, e) => s + Number(e.amount), 0);
  const laterUsd = later.filter(e => e.currency === "USD").reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4 md:space-y-6">
      {!business && <ProductTour tourId="expenses-intro" steps={EXPENSES_TOUR_STEPS} />}
      <BusinessTour tourId="expenses-business-intro" steps={EXPENSES_BUSINESS_INTRO_STEPS} />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {business
          ? <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Egresos</h1>
          : <MovimientosTabs title="Egresos" />}
        <div className="flex items-center gap-1 shrink-0">
          {filtering ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
              <Search className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-bold text-foreground">
                {entries.length} resultado{entries.length !== 1 ? "s" : ""}
                <span className="hidden sm:inline"> en todo el historial</span>
              </span>
            </div>
          ) : business && (
            <MonthPill compact label={format(new Date(year, month - 1, 1), "MMM yyyy", { locale: es }).replace(".", "")} onPrev={prev} onNext={next} />
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
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        </div>
      </div>

      {formState && (
        <ExpenseFormModal
          key={formKey}
          mode={formState.mode}
          editId={formState.mode === "edit" ? formState.entry.id : undefined}
          initial={formState.mode === "edit" ? {
            ...newDraft(formState.entry.expense_date, null),
            category_id: String(formState.entry.category_id),
            // El backend manda "500.00"; en el campo se ve como se escribe acá.
            amount: Number(formState.entry.amount).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            description: formState.entry.description || "",
            notes: formState.entry.notes || "",
            currency: (formState.entry.currency as "ARS" | "USD") || "ARS",
            payee_id: formState.entry.payee_id ? String(formState.entry.payee_id) : "",
          } : formState.initial}
          categories={categories}
          onCategoriesChanged={load}
          onSaved={handleSaved}
          onClose={closeForm}
        />
      )}

      {notice && notice.kind !== "simple" && (
        <Card className="flex items-start gap-3" role="status">
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="text-sm text-foreground">
              {notice.kind === "card"
                ? <>Cargado en el resumen de <span className="font-medium">{notice.periodName}</span> de <span className="font-medium">{notice.cardName}</span>{notice.shared ? " y compartido." : "."}</>
                : <>Gasto compartido con {notice.people} {notice.people === 1 ? "persona" : "personas"}.</>}
            </p>
            <div className="flex flex-wrap gap-3 text-xs font-medium">
              {notice.kind === "card" && (
                <button type="button" className="text-primary hover:underline"
                  onClick={() => router.push(`/tarjetas/${notice.card_id}/${notice.statement_id}`)}>
                  Ver resumen
                </button>
              )}
              {(notice.kind === "shared" || notice.shared) && (
                <button type="button" className="text-primary hover:underline" onClick={() => router.push("/shared")}>
                  Ver en Compartidos
                </button>
              )}
            </div>
          </div>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"
            className="p-1 text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-4 h-4" />
          </button>
        </Card>
      )}

      {!business && !filtering && summary && summary.expenses_by_category.length > 0 && (
        <div data-tour="expenses-breakdown">
          <BreakdownStrip
            title="¿En qué se fue la plata?"
            picked={pickedCategory}
            onPick={pickCategory}
            rows={summary.expenses_by_category.map(cat => ({
              key: cat.category_name, label: cat.category_name, color: cat.color,
              total: Number(cat.total), total_usd: Number(cat.total_usd), ars_equivalent: Number(cat.ars_equivalent),
            }))}
            footnote={Number(summary.total_expenses_usd) > 0 && summary.usd_rate
              ? `Los porcentajes valúan los dólares a ${formatARS(summary.usd_rate)} (${summary.usd_rate_type}).`
              : null}
          />
        </div>
      )}

      {/* Same bar as /tarjetas and /ingresos — see components/ui/filters.tsx.
          One box searches description, category, card alias and notes: a row
          shows `description || category`, so any of them is what the user
          remembers about the expense they're looking for. */}
      <div data-tour="expenses-filter"><FilterBar>
        <FilterRow>
          <CollapsibleSearch
            open={searchOpen}
            onOpen={() => setSearchOpen(true)}
            onClose={() => { setSearch(""); setSearchOpen(false); }}
            value={search}
            onChange={setSearch}
            placeholder={loadedBy.active ? "Buscar por descripción, categoría, tarjeta o persona..." : "Buscar por descripción, categoría o tarjeta..."}
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
            {business && payees.length > 0 && (
              <PillSelect value={payeeFilter} onChange={setPayeeFilter} placeholder="Proveedor"
                options={payees.map(p => ({ value: String(p.id), label: p.name }))} />
            )}
            {loadedBy.active && (
              <PillSelect value={loadedByFilter} onChange={setLoadedByFilter} placeholder="Lo cargó"
                options={loadedBy.options} />
            )}
            <PillDateRange
              from={dateFrom} to={dateTo}
              onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
            />
            {panelFilterActive && (
              <ClearFilters onClick={() => {
                setCategoryFilter(""); setCurrencyFilter(""); setPayeeFilter(""); setLoadedByFilter(""); setDateFrom(""); setDateTo("");
              }} />
            )}
          </FilterPanel>
        )}
      </FilterBar></div>

      <MotionList as="section" key={listKey} data-tour="expenses-list" className="px-2 space-y-1 animate-page-in">
        {selecting && (
          <SelectionBar count={selected.size} allSelected={allSelected} deleting={bulkDeleting}
            onToggleAll={toggleAll} onDelete={handleBulkDelete} onCancel={stopSelecting} />
        )}
        {shown.length === 0 ? (
          <p className="py-6 text-muted-foreground text-[15px]">
            {filtering
              ? "Ningún egreso coincide con la búsqueda."
              : business
                ? `No hay egresos registrados en ${periodLabel}.`
                : `En ${periodLabel} no salió plata todavía.`}
          </p>
        ) : (
          <MotionList>{renderRows(shown)}</MotionList>
        )}
        {shown.length > 0 && (
          <LedgerTotal
            label={pickedCategory ? `Total de ${pickedCategory}` : "Total"}
            ars={shown.filter(e => e.currency !== "USD").reduce((s, e) => s + Number(e.amount), 0)}
            usd={shown.filter(e => e.currency === "USD").reduce((s, e) => s + Number(e.amount), 0)}
            note={pendingNote(shown)}
          />
        )}
      </MotionList>

      {!filtering && !pickedCategory && later.length > 0 && (
        <MotionList as="section" key={`later-${listKey}`} className="rounded-3xl bg-accent border border-[#CFC9E4] p-2.5 animate-page-in">
          <button type="button" onClick={() => setLaterOpen(v => !v)} aria-expanded={laterOpen}
            className="w-full flex items-center gap-3 px-2 py-1.5 text-left">
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-[15.5px] text-foreground">Comprado en {periodLabel.split(" ")[0]}, se paga después</span>
              <span className="block text-sm text-[#3F3B4B]">
                {later.length} {later.length === 1 ? "compra" : "compras"} con tarjeta. No cuenta todavía en este mes.
              </span>
            </span>
            <span className="font-medium tabular-nums shrink-0 text-right">
              {laterArs > 0 && <span className="block">{ledgerAmount(laterArs)}</span>}
              {laterUsd > 0 && <span className="block">{ledgerAmount(laterUsd, "USD")}</span>}
            </span>
            <ChevronRight className={`w-4 h-4 text-[#3F3B4B] shrink-0 transition-transform ${laterOpen ? "rotate-90" : ""}`} />
          </button>
          {laterOpen && <MotionList className="mt-2 rounded-2xl bg-white px-3">{renderRows(later, false)}</MotionList>}
        </MotionList>
      )}

      <Fab label="Registrar egreso" data-tour="expenses-add" onClick={() => openCreate()} />

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          payeeName={payeeName(detailEntry.payee_id)}
          loadedBy={loadedBy.nameOf(loaderId(detailEntry))}
          onEdit={() => { setDetailEntry(null); openEdit(detailEntry); }}
          onDelete={() => handleDelete(detailEntry.id)}
          onViewStatement={() => handleViewStatement(detailEntry.id)}
          onViewMortgage={() => router.push("/creditos")}
          onRecurrenceChanged={() => { setDetailEntry(null); load(); }}
          onClose={() => setDetailEntry(null)}
        />
      )}
    </div>
  );
}

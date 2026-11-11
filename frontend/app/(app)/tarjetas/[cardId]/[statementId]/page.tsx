"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD, parseAmount, getErrorMessage, pickCategoryColor, foldText } from "@/lib/utils";
import NewCategoryModal from "@/components/NewCategoryModal";
import { useAuth } from "@/contexts/AuthContext";
import { LoadedByTag, useLoadedBy } from "@/components/LoadedBy";
import { Plus, SlidersHorizontal, Users2, X } from "lucide-react";
import { features } from "@/lib/features";
import { UploadStatementButton } from "@/components/UploadStatementButton";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CurrencyToggle, DateField, FIELD, FieldLabel, FormGrid, SegmentedToggle, SelectField } from "@/components/ui/form";
import { ParticipantPicker, type PickedParticipant } from "@/components/ParticipantPicker";
import { equalSplit, remainder, sumMatches, toCents } from "@/lib/split";
import {
  FilterBar, FilterRow, FilterPanel, SortChip, FilterChip, PillSelect,
  PillDateRange, ClearFilters, CollapsibleSearch,
} from "@/components/ui/filters";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { BreakdownStrip } from "@/components/movimientos/BreakdownStrip";
import { EntrySheet, SheetActions, SheetLink, SheetRow } from "@/components/movimientos/EntrySheet";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { LedgerRow, ledgerAmount } from "@/components/movimientos/Ledger";
import { ErrorNote, shortDate, SubHeader, totalsByCurrency } from "@/components/tarjetas/parts";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }
interface CardItem {
  id: number; description: string; category_id: number; item_date: string; item_type: string;
  amount: number; installment_count?: number; installment_number?: number;
  purchase_total?: number; installment_group_id?: number; installment_root_statement_id?: number; shared_expense_id?: number; expense_entry_id?: number; currency?: string; user_id?: number | null;
  category: { id: number; name: string; color?: string };
}
interface Statement {
  id: number; card_id: number; year: number; month: number;
  closing_date?: string; due_date?: string; due_date_effective?: string; due_date_is_estimated?: boolean;
  total: number; items: CardItem[];
}
interface Card {
  id: number; bank: string; alias: string; closing_day: number; due_day: number;
}

type ItemType = "single" | "installment" | "recurring";

type SortKey = "date" | "category" | "amount";
const SORT_LABELS: Record<SortKey, string> = {
  date: "Fecha", category: "Categoría", amount: "Monto",
};

// Same wording as the row, so a filter names what the user sees.
const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  single: "Único", installment: "Cuotas", recurring: "Recurrente",
};

const money = (amount: number | string, currency?: string) =>
  currency === "USD" ? formatUSD(amount) : formatARS(amount);

// En un campo, un monto se ve como se escribe acá: "4.069.000,00".
const asTyped = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Lo que cambia cómo hay que leer el gasto. Un pago único no dice nada: marcar lo
// normal sólo llena la fila de ruido.
function itemMarks(item: CardItem): string[] {
  const marks: string[] = [];
  if (item.item_type === "recurring") marks.push("Recurrente");
  else if (item.item_type === "installment") marks.push(`Cuota ${item.installment_number}/${item.installment_count}`);
  if (item.shared_expense_id) marks.push("Compartido");
  return marks;
}

/**
 * Lo que se abre al tocar un gasto. Una cuota 2..N no se edita ni se borra desde
 * acá (el backend responde 400: "ve al resumen de la cuota 1"), así que en vez de
 * las acciones lleva hasta la original.
 */
function ItemSheet({ item, loadedBy, onEdit, onDelete, onShare, onOriginal, onShared, onClose }: {
  item: CardItem;
  loadedBy?: string;
  onEdit: () => void;
  onDelete: () => void;
  onShare: () => void;
  onOriginal: () => void;
  onShared: () => void;
  onClose: () => void;
}) {
  const isChild = !!item.installment_group_id;
  const isPlan = item.item_type === "installment";
  // Un plan puede haber entrado a mitad de camino (cuota 8/12): se borran las que hay.
  const planCuotas = (item.installment_count ?? 1) - (item.installment_number ?? 1) + 1;
  return (
    <EntrySheet
      date={item.item_date}
      title={item.description}
      badge={{ label: item.category.name, color: item.category.color || "#6366f1" }}
      amount={money(item.amount, item.currency)}
      onClose={onClose}
      footer={isChild ? (
        <SheetLink note="Es una cuota de un plan: se edita o se elimina desde la cuota 1." label="Ver original" onClick={onOriginal} />
      ) : (
        <div className="space-y-2">
          {!item.shared_expense_id && (
            <button type="button" onClick={onShare}
              className="w-full h-[52px] rounded-full bg-white/70 border border-white/80 font-semibold text-[15px] text-foreground inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform duration-100">
              <Users2 className="w-4 h-4" /> Compartir gasto
            </button>
          )}
          {item.shared_expense_id && (
            <p className="px-1.5 text-sm leading-snug text-[#4A4658]">Está compartido: se elimina desde Gastos compartidos.</p>
          )}
          <SheetActions noun={isPlan ? `plan y sus ${planCuotas} cuotas` : "gasto"} onEdit={onEdit}
            onDelete={item.shared_expense_id ? undefined : onDelete} />
        </div>
      )}
    >
      {isPlan && <SheetRow label="Cuota">{item.installment_number} de {item.installment_count}</SheetRow>}
      {isPlan && Number(item.purchase_total) > 0 && <SheetRow label="Total de la compra">{money(item.purchase_total!, item.currency)}</SheetRow>}
      {item.item_type === "recurring" && <SheetRow label="Tipo">Recurrente</SheetRow>}
      {item.shared_expense_id && (
        <SheetRow label="Compartido">
          <button type="button" onClick={onShared} className="font-semibold text-[#3B2FB3] min-h-[28px]">Ver en Compartidos</button>
        </SheetRow>
      )}
      {loadedBy && <SheetRow label="Lo cargó">{loadedBy}</SheetRow>}
    </EntrySheet>
  );
}

interface ShareParticipantRow {
  type: "self" | "member" | "external";
  user_id: number | null;
  member_name: string;
  contact: string;
  amount: string;
}

function ShareItemModal({ item, onClose, onDone, currentUser }: { item: CardItem; onClose: () => void; onDone: () => void; currentUser: { id: number; display_name: string | null; email: string } | null }) {
  const [participants, setParticipants] = useState<ShareParticipantRow[]>([]);
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  // Traduce lo que devuelve el selector a la fila de este modal. El selector no
  // sabe de montos ni de redondeo del resto: eso es de acá.
  function applyPick(idx: number, picked: PickedParticipant) {
    if (picked.kind === "member" || picked.kind === "user") {
      updateParticipant(idx, { type: "member", user_id: picked.user_id, member_name: picked.member_name, contact: "" });
    } else if (picked.kind === "invite") {
      updateParticipant(idx, { type: "external", user_id: null, member_name: picked.member_name, contact: picked.contact });
    } else {
      updateParticipant(idx, { type: "external", user_id: null, member_name: picked.member_name, contact: "" });
    }
  }

  const totalAmount = Number(item.amount);
  const fmt = (n: number) => money(n, item.currency);

  useEffect(() => {
    if (!currentUser || participants.length > 0) return;
    setParticipants([{
      type: "self",
      user_id: currentUser.id,
      member_name: currentUser.display_name || currentUser.email,
      contact: "",
      amount: "",
    }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const cuotasRestantes = item.item_type === "installment" && !item.installment_group_id
    ? (item.installment_count || 1) - (item.installment_number || 1) + 1
    : 0;

  // `equalSplit` reparte en centavos y le deja el resto a la última fila, así
  // que la suma da exactamente el total. Acá vivía el redondeo a mano, que
  // llegaba al mismo resultado por otro camino; ahora es el mismo código que
  // usa el formulario unificado.
  const equalShares = equalSplit(totalAmount, participants.length);
  const customTotal = participants.reduce((s, p) => s + parseAmount(p.amount || "0"), 0);
  const overBudget = splitType === "custom" && toCents(customTotal) > toCents(totalAmount);

  function updateParticipant(idx: number, patch: Partial<ShareParticipantRow>) {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function addParticipant() {
    setParticipants(prev => [...prev, { type: "member", user_id: null, member_name: "", contact: "", amount: "" }]);
  }

  function removeParticipant(idx: number) {
    setParticipants(prev => prev.filter((_, i) => i !== idx));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (participants.length < 2) { setError("Agregá al menos una persona más"); return; }
    if (participants.some(p => p.type !== "self" && !p.member_name.trim())) {
      setError("Hay un participante sin elegir"); return;
    }
    setSharing(true);
    setError("");
    try {
      const splits = participants.map((p, i) => {
        const amount = splitType === "equal" ? equalShares[i] : parseAmount(p.amount || "0");
        return {
          user_id: p.type === "external" ? null : p.user_id,
          member_name: p.member_name,
          amount,
          ...(p.type === "external" && p.contact.trim() ? { invite_contact: p.contact.trim() } : {}),
        };
      });
      // Exacto, no ±0,02: el backend rechaza cualquier división que no cierre
      // dentro de ±0,01, así que la tolerancia vieja dejaba pasar al servidor
      // divisiones que él iba a rebotar con un 422 genérico.
      if (splitType === "custom" && !sumMatches(totalAmount, splits.map(sp => sp.amount))) {
        const left = remainder(totalAmount, splits.map(sp => sp.amount));
        setError(left > 0
          ? `Faltan ${fmt(left)} por asignar`
          : `Sobran ${fmt(-left)}: la división supera el total`);
        setSharing(false); return;
      }
      await api.post("/credit-cards/items/" + item.id + "/share", { splits, split_type: splitType });
      onDone();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "No se pudo compartir el gasto"));
    }
    setSharing(false);
  };

  return (
    <>
      <FormSheet title="Compartir gasto" onClose={onClose}>
        <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
          <div className={FORM_SHEET_BODY}>
            <div className="rounded-[22px] bg-white/70 border border-white/80 px-4 py-3">
              <p className="font-semibold text-[15.5px] text-foreground truncate">{item.description}</p>
              <p className="text-[26px] font-medium tracking-[-0.03em] tabular-nums text-foreground">
                {fmt(totalAmount)}
                {item.item_type === "installment" && <span className="ml-1.5 text-sm font-normal tracking-normal text-muted-foreground">por cuota</span>}
              </p>
              {cuotasRestantes > 1 && (
                <p className="mt-0.5 text-sm text-[#3F3B4B]">Se comparten las {cuotasRestantes} cuotas del plan.</p>
              )}
              {item.item_type === "recurring" && (
                <p className="mt-0.5 text-sm text-[#3F3B4B]">Sólo se comparte este mes.</p>
              )}
            </div>

            <SegmentedToggle
              ariaLabel="Cómo se divide"
              value={splitType}
              onChange={setSplitType}
              options={[{ value: "equal", label: "División igual" }, { value: "custom", label: "Personalizado" }]} />

            <div>
              <div className="flex items-center justify-between gap-2 px-1 min-h-[44px]">
                <p className="text-sm text-[#4A4658]">Participantes</p>
                <button type="button" onClick={addParticipant}
                  className="min-h-[44px] text-sm font-semibold text-[#3B2FB3] flex items-center gap-1">
                  <Plus className="w-4 h-4" /> Agregar persona
                </button>
              </div>

              <MotionList className="rounded-[22px] bg-white/70 border border-white/80 px-3.5 divide-y divide-ink/[0.08]">
                {participants.map((p, idx) => (
                  <div key={idx} className="py-2 space-y-1.5">
                    <div className="flex items-center gap-2 min-h-[44px]">
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold text-foreground truncate">
                          {p.member_name || <span className="text-muted-foreground font-normal">Sin elegir</span>}
                        </span>
                        <span className="block text-sm text-muted-foreground truncate">
                          {p.type === "self" ? "Vos" : p.user_id ? "Usuario de tood"
                            : p.contact ? `Se le invita a ${p.contact}`
                            : p.member_name ? "Sin cuenta, sólo para anotar tu parte" : ""}
                        </span>
                      </span>
                      {splitType === "equal" && totalAmount > 0 && (
                        <span className="text-[15px] font-medium tabular-nums text-foreground shrink-0">{ledgerAmount(equalShares[idx] ?? 0, item.currency)}</span>
                      )}
                      {p.type !== "self" && (
                        <>
                          <button type="button" onClick={() => setPickerFor(idx)}
                            className="min-h-[44px] px-1 text-sm font-semibold text-[#3B2FB3] shrink-0">
                            {p.member_name ? "Cambiar" : "Elegir"}
                          </button>
                          <button type="button" onClick={() => removeParticipant(idx)}
                            aria-label="Quitar participante"
                            className="w-9 h-11 -mr-1.5 flex items-center justify-center text-muted-foreground shrink-0">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>

                    {splitType === "custom" && (
                      <input
                        required
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9.,]*"
                        placeholder="0,00"
                        aria-label={`Monto de ${p.member_name || "este participante"}`}
                        value={p.amount}
                        onChange={e => updateParticipant(idx, { amount: e.target.value })}
                        className={`${FIELD} !mt-0 tabular-nums`}
                      />
                    )}
                  </div>
                ))}
              </MotionList>
            </div>

            {splitType === "custom" && totalAmount > 0 && (
              <p className={`px-1 text-sm ${overBudget ? "font-medium text-rose-800" : "text-[#3F3B4B]"}`}>
                {overBudget
                  ? `La división supera el total: ${fmt(customTotal)} de ${fmt(totalAmount)}`
                  : `Repartido: ${fmt(customTotal)} · Falta repartir: ${fmt(totalAmount - customTotal)}`}
              </p>
            )}

            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
          <FormSheetActions onCancel={onClose} saving={sharing} disabled={participants.length < 2 || overBudget} label="Compartir" />
        </form>
      </FormSheet>
      {/* Hermano de la hoja y no adentro: el vidrio encierra a los `fixed`. */}
      <ParticipantPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={picked => { if (pickerFor !== null) applyPick(pickerFor, picked); }}
        excludeUserIds={participants.map(x => x.user_id).filter((x): x is number => x !== null)}
      />
    </>
  );
}

function EditItemModal({
  item,
  categories,
  onSave,
  onClose,
}: {
  item: CardItem;
  categories: Category[];
  onSave: (data: { description: string; category_id: number; item_date: string; amount: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    description: item.description,
    category_id: String(item.category_id),
    item_date: item.item_date,
    amount: asTyped(Number(item.amount)),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        description: form.description,
        category_id: parseInt(form.category_id),
        item_date: form.item_date,
        amount: parseAmount(form.amount),
      });
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar el gasto"));
      setSaving(false);
    }
  };

  return (
    <FormSheet title="Editar gasto" onClose={onClose}>
      <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <AmountField
            label={item.item_type === "installment" ? "Monto por cuota" : "Monto"}
            currency={item.currency === "USD" ? "USD" : "ARS"}
            required
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
          <div>
            <FieldLabel>Descripción</FieldLabel>
            <input className={FIELD} aria-label="Descripción" required
              value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <FormGrid>
            <div>
              <FieldLabel>Categoría</FieldLabel>
              <SelectField value={form.category_id}
                onChange={v => setForm((p) => ({ ...p, category_id: v }))}
                options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
            </div>
            <div>
              <FieldLabel>Fecha</FieldLabel>
              <DateField required value={form.item_date}
                onChange={v => setForm((p) => ({ ...p, item_date: v }))} />
            </div>
          </FormGrid>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
      </form>
    </FormSheet>
  );
}

function AddItemSheet({ statementId, categories, onCategoriesChanged, onSaved, onClose }: {
  statementId: number;
  categories: Category[];
  onCategoriesChanged: () => Promise<void>;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    description: "", category_id: "", item_date: format(new Date(), "yyyy-MM-dd"), item_type: "single" as ItemType,
    amount: "", installment_count: "2", purchase_total: "", currency: "ARS" as "ARS" | "USD",
  });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewCat, setShowNewCat] = useState(false);
  const installments = form.item_type === "installment";

  // Si cambiás uno, el otro se calcula solo.
  const handleAmountChange = (field: "amount" | "purchase_total", value: string) => {
    if (!installments) {
      setForm((p) => ({ ...p, amount: value }));
      return;
    }
    const count = parseInt(form.installment_count) || 1;
    if (field === "amount") {
      setForm((p) => ({ ...p, amount: value, purchase_total: value.trim() ? asTyped(parseAmount(value) * count) : "" }));
    } else {
      setForm((p) => ({ ...p, purchase_total: value, amount: value.trim() ? asTyped(parseAmount(value) / count) : "" }));
    }
  };

  const handleInstallmentCountChange = (raw: string) => {
    const value = raw.replace(/[^0-9]/g, "");
    const count = parseInt(value) || 1;
    setForm((p) => ({
      ...p,
      installment_count: value,
      purchase_total: p.amount.trim() ? asTyped(parseAmount(p.amount) * count) : "",
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (installments && (parseInt(form.installment_count) || 0) < 2) {
      setError("Un plan en cuotas tiene al menos 2 cuotas.");
      return;
    }
    setAdding(true);
    setError(null);
    const payload: Record<string, unknown> = {
      description: form.description,
      item_date: form.item_date,
      item_type: form.item_type,
      amount: parseAmount(form.amount),
      currency: form.currency,
    };
    if (form.currency === "ARS") payload.category_id = parseInt(form.category_id);
    if (installments) {
      payload.installment_count = parseInt(form.installment_count);
      payload.installment_number = 1;
      payload.purchase_total = parseAmount(form.purchase_total);
    }
    try {
      await api.post(`/credit-cards/statements/${statementId}/items`, payload);
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo agregar el gasto"));
      setAdding(false);
    }
  };

  const handleCreateCategory = async (cat: { name: string; color: string; is_fixed: boolean }) => {
    const res = await api.post("/expenses/categories", cat);
    await onCategoriesChanged();
    setForm((p) => ({ ...p, category_id: String(res.data.id) }));
    setShowNewCat(false);
  };

  const isUsd = form.currency === "USD";

  return (
    <>
      <FormSheet title="Nuevo gasto" onClose={onClose}>
        <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
          <div className={FORM_SHEET_BODY}>
            <AmountField
              label={installments ? "Monto por cuota" : "Monto"}
              currency={form.currency}
              required
              toggle={
                <CurrencyToggle className="w-[132px]" value={form.currency}
                  onChange={cur => setForm(p => ({ ...p, currency: cur, category_id: cur === "USD" ? "" : p.category_id, item_type: cur === "USD" ? "single" : p.item_type }))} />
              }
              value={form.amount}
              onChange={(e) => handleAmountChange("amount", e.target.value)} />

            <div>
              <FieldLabel>Descripción</FieldLabel>
              <input className={FIELD} placeholder="TV Samsung" aria-label="Descripción" required
                value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </div>

            <FormGrid>
              {!isUsd && (
                <div>
                  <FieldLabel>Categoría</FieldLabel>
                  <div className="flex gap-1.5">
                    <SelectField className="flex-1" required
                      value={form.category_id}
                      onChange={v => setForm((p) => ({ ...p, category_id: v }))}
                      placeholder="Categoría"
                      options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
                    <button type="button" onClick={() => setShowNewCat(true)} title="Nueva categoría" aria-label="Nueva categoría"
                      className="mt-1 w-11 shrink-0 rounded-lg border border-border bg-card text-foreground flex items-center justify-center active:scale-[0.97] transition-transform duration-100">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <FieldLabel>Fecha</FieldLabel>
                <DateField required value={form.item_date}
                  onChange={v => setForm((p) => ({ ...p, item_date: v }))} />
              </div>
            </FormGrid>

            {/* En dólares no hay cuotas ni recurrentes: se ven apagados, y se dice por qué. */}
            <div>
              <FieldLabel>Tipo</FieldLabel>
              <SegmentedToggle
                ariaLabel="Tipo de gasto"
                className="mt-1"
                value={form.item_type}
                onChange={t => setForm((p) => ({ ...p, item_type: t }))}
                options={(Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map(t => ({
                  value: t, label: ITEM_TYPE_LABELS[t], disabled: isUsd && t !== "single",
                }))} />
              {isUsd && (
                <p className="mt-1.5 px-1 text-xs leading-snug text-muted-foreground">
                  En dólares va en un solo pago, y queda en la categoría Consumo en dólares.
                </p>
              )}
            </div>

            {installments && (
              <FormGrid>
                <div>
                  <FieldLabel>Cantidad de cuotas</FieldLabel>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" className={FIELD} aria-label="Cantidad de cuotas" required
                    value={form.installment_count} onChange={(e) => handleInstallmentCountChange(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>Monto total</FieldLabel>
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={`${FIELD} tabular-nums`} aria-label="Monto total"
                    value={form.purchase_total} onChange={(e) => handleAmountChange("purchase_total", e.target.value)} />
                </div>
                <p className="sm:col-span-2 px-1 text-xs text-muted-foreground">Si cambiás el monto por cuota o el total, el otro se calcula solo. Las cuotas siguientes se cargan en sus resúmenes.</p>
              </FormGrid>
            )}

            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
          <FormSheetActions onCancel={onClose} saving={adding} label="Agregar gasto" />
        </form>
      </FormSheet>
      {showNewCat && (
        <NewCategoryModal
          initialColor={pickCategoryColor(categories.map(c => c.color))}
          onSave={handleCreateCategory}
          onClose={() => setShowNewCat(false)}
        />
      )}
    </>
  );
}


export default function StatementDetailPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const { appUser } = useAuth();
  const params = useParams();
  const router = useRouter();
  const reaccionar = useReaccion();
  const cardId = Number(params.cardId);
  const statementId = Number(params.statementId);

  const [card, setCard] = useState<Card | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed" | "missing">("loading");
  const [showAddForm, setShowAddForm] = useState(false);
  const [detailItem, setDetailItem] = useState<CardItem | null>(null);
  const [shareItem, setShareItem] = useState<CardItem | null>(null);
  const [editItem, setEditItem] = useState<CardItem | null>(null);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [showCustomFilter, setShowCustomFilter] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const loadedBy = useLoadedBy();
  const [loadedByFilter, setLoadedByFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    try {
      const [cardRes, stmtRes, catRes] = await Promise.all([
        api.get("/credit-cards"),
        api.get(`/credit-cards/${cardId}/statements`),
        api.get("/expenses/categories"),
      ]);
      const found = (cardRes.data as Card[]).find((c) => c.id === cardId);
      setCard(found || null);
      const foundStmt = (stmtRes.data as Statement[]).find((s) => s.id === statementId);
      setStatement(foundStmt || null);
      setCategories(catRes.data);
      setLoadState(found && foundStmt ? "ready" : "missing");
    } catch {
      setLoadState("failed");
    }
  }, [cardId, statementId]);

  useEffect(() => { setLoadState("loading"); load(); }, [load]);

  const handleDeleteItem = async (item: CardItem) => {
    try {
      await api.delete(`/credit-cards/items/${item.id}?delete_group=${item.item_type === "installment"}`);
    } catch {
      reaccionar("error", "No se pudo eliminar");
      return;
    }
    reaccionar("borrado", item.item_type === "installment" ? "Cuotas eliminadas" : "Gasto eliminado");
    setDetailItem(null);
    await load();
  };

  const handleEditItem = async (data: { description: string; category_id: number; item_date: string; amount: number }) => {
    if (!editItem) return;
    await api.patch(`/credit-cards/items/${editItem.id}`, data);
    reaccionar("guardado", "Gasto guardado");
    setEditItem(null);
    await load();
  };

  const panelFilterActive = !!(categoryFilter || typeFilter || loadedByFilter || currencyFilter || dateFrom || dateTo);
  const clearPanelFilters = () => {
    setCategoryFilter(""); setTypeFilter(""); setLoadedByFilter(""); setCurrencyFilter("");
    setDateFrom(""); setDateTo("");
  };

  // Tap cycle: inactive -> asc -> desc -> inactive, where inactive is the most
  // recent first, like the rest of the money lists. The endpoint's own order isn't
  // by date, and a list that skips repeated days has to be.
  function toggleSort(key: SortKey) {
    if (sort !== key) { setSort(key); setOrder("asc"); return; }
    if (order === "asc") { setOrder("desc"); return; }
    setSort(null);
  }

  // Only offer values this statement actually contains — a pill option that
  // matches nothing here reads as "no hay nada" when it means "no existe".
  const items = useMemo(() => statement?.items ?? [], [statement]);

  // `?item=<id>` llega desde "Subir resumen" para los ítems que hay que
  // corregir acá (compartidos y cuotas 2..N): abre ese ítem, o la cuota 1 de
  // su plan, que es donde se edita. Una vez por resumen (ir a la cuota 1 de
  // otro resumen reusa esta misma pantalla), y se saca de la URL.
  const [itemParamFor, setItemParamFor] = useState<number | null>(null);
  useEffect(() => {
    if (itemParamFor === statementId || !statement || statement.id !== statementId) return;
    setItemParamFor(statementId);
    const wanted = Number(new URLSearchParams(window.location.search).get("item"));
    if (!wanted) return;
    window.history.replaceState(null, "", window.location.pathname);
    const target = statement.items.find(i => i.id === wanted);
    if (!target) return;
    if (target.installment_group_id && target.installment_root_statement_id) {
      router.push(`/tarjetas/${cardId}/${target.installment_root_statement_id}?item=${target.installment_group_id}`);
    } else {
      setDetailItem(target);
    }
  }, [statement, statementId, itemParamFor, router, cardId]);
  const presentCategories = useMemo(() => {
    const seen = new Map<number, string>();
    items.forEach(i => seen.set(i.category.id, i.category.name));
    return Array.from(seen, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [items]);
  const presentLoaders = useMemo(
    () => loadedBy.options.filter(o => items.some(i => String(i.user_id) === o.value)),
    [loadedBy, items],
  );
  const presentTypes = useMemo(
    () => (Object.keys(ITEM_TYPE_LABELS) as ItemType[]).filter(t => items.some(i => i.item_type === t)),
    [items],
  );
  const presentCurrencies = useMemo(
    () => ["ARS", "USD"].filter(c => items.some(i => (i.currency || "ARS") === c)),
    [items],
  );

  // Todo lo que filtra menos la categoría: es lo que muestra el desglose, que tiene
  // que seguir ofreciendo las demás categorías aunque una esté elegida.
  const matchesExceptCategory = useCallback((i: CardItem) => {
    const q = foldText(search.trim());
    // Match every field the row shows: its description and its category.
    if (q && !foldText(`${i.description} ${i.category.name} ${loadedBy.nameOf(i.user_id) ?? ""}`).includes(q)) return false;
    if (loadedByFilter && String(i.user_id) !== loadedByFilter) return false;
    if (typeFilter && i.item_type !== typeFilter) return false;
    if (currencyFilter && (i.currency || "ARS") !== currencyFilter) return false;
    // item_date is ISO yyyy-MM-dd, so a string compare is a date compare.
    if (dateFrom && i.item_date < dateFrom) return false;
    if (dateTo && i.item_date > dateTo) return false;
    return true;
  }, [search, loadedBy, loadedByFilter, typeFilter, currencyFilter, dateFrom, dateTo]);

  const visibleItems = useMemo(() => {
    const out = items.filter(i => matchesExceptCategory(i) && (!categoryFilter || String(i.category.id) === categoryFilter));
    const dir = order === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (!sort) return b.item_date.localeCompare(a.item_date) || b.id - a.id;
      if (sort === "date") return dir * a.item_date.localeCompare(b.item_date);
      if (sort === "category") return dir * a.category.name.localeCompare(b.category.name, "es");
      // Amount orders by (currency, amount), never by amount alone: a statement
      // mixes both, and interleaving would sit U$D 500 next to $500.
      const ca = a.currency || "ARS", cb = b.currency || "ARS";
      if (ca !== cb) return ca.localeCompare(cb);
      return dir * (Number(a.amount) - Number(b.amount));
    });
  }, [items, matchesExceptCategory, categoryFilter, sort, order]);

  const breakdown = useMemo(() => {
    const byCat = new Map<number, { key: string; label: string; color: string | null; total: number; total_usd: number; ars_equivalent: number }>();
    items.filter(matchesExceptCategory).forEach(item => {
      const row = byCat.get(item.category.id)
        ?? { key: String(item.category.id), label: item.category.name, color: item.category.color ?? null, total: 0, total_usd: 0, ars_equivalent: 0 };
      if (item.currency === "USD") {
        row.total_usd += Number(item.amount);
      } else {
        row.total += Number(item.amount);
        row.ars_equivalent += Number(item.amount);
      }
      byCat.set(item.category.id, row);
    });
    return Array.from(byCat.values()).sort((a, b) => b.total - a.total || b.total_usd - a.total_usd);
  }, [items, matchesExceptCategory]);

  if (loadState === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-11 w-48 rounded-2xl bg-ink/[0.06] animate-pulse" />
        <div className="h-[116px] rounded-3xl bg-ink/[0.06] animate-pulse" />
        <span className="sr-only">Cargando el resumen</span>
      </div>
    );
  }

  if (loadState !== "ready" || !card || !statement) {
    return (
      <div className="px-2 py-6">
        <p className="text-[19px] font-medium tracking-[-0.02em] text-foreground">
          {loadState === "missing" ? "Este resumen ya no está." : "No pudimos traer este resumen."}
        </p>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {loadState === "missing" ? "Puede que lo hayan eliminado." : "Tus datos están bien. Fijate si tenés conexión y probá de nuevo."}
        </p>
        <div className="mt-3 flex gap-2">
          {loadState === "failed" && <Button className="h-11" onClick={() => { setLoadState("loading"); load(); }}>Probar de nuevo</Button>}
          <Button variant="outline" className="h-11" onClick={() => router.push(`/tarjetas/${cardId}`)}>Ver la tarjeta</Button>
        </div>
      </div>
    );
  }

  // Lo que debita el banco: siempre el resumen entero, con filtros o sin ellos.
  const full = totalsByCurrency(statement.items);
  const shown = totalsByCurrency(visibleItems);
  const filtering = visibleItems.length !== statement.items.length;
  const due = statement.due_date || statement.due_date_effective;
  const byDate = !sort || sort === "date";
  const hasUsdInBreakdown = breakdown.some(r => r.total_usd > 0) && breakdown.some(r => r.total > 0);
  const openOriginal = (item: CardItem) => {
    setDetailItem(null);
    router.push(`/tarjetas/${cardId}/${item.installment_root_statement_id}?item=${item.installment_group_id}`);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <SubHeader
        title={`${MONTH_NAMES[statement.month - 1]} ${statement.year}`}
        sub={card.alias === card.bank ? card.alias : `${card.alias} · ${card.bank}`}
        backLabel="Volver a la tarjeta" backHref={`/tarjetas/${cardId}`}>
        {features.reconcile && <UploadStatementButton cardId={cardId} />}
        <Button onClick={() => setShowAddForm(true)} aria-label="Agregar gasto" className="w-11 h-11 p-0 sm:w-auto sm:px-4">
          <Plus className="w-[18px] h-[18px] shrink-0" />
          <span className="hidden sm:inline">Agregar gasto</span>
        </Button>
      </SubHeader>

      {statement.items.length > 0 && (
        <section className="rounded-3xl border border-border bg-card px-4 py-3.5 md:px-5 md:py-4">
          <p className="text-sm text-muted-foreground">Total del resumen</p>
          <p className="mt-0.5 font-medium tracking-[-0.03em] tabular-nums text-foreground">
            {full.ars > 0 && <span className="block text-[32px] leading-tight">{ledgerAmount(full.ars)}</span>}
            {full.usd > 0 && <span className={`block leading-tight ${full.ars > 0 ? "text-lg tracking-[-0.01em]" : "text-[32px]"}`}>{ledgerAmount(full.usd, "USD")}</span>}
          </p>
          {(due || statement.closing_date) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              {due && <span>Vence el {shortDate(due)}</span>}
              {due && statement.due_date_is_estimated && <Chip locked className="px-2 py-0 text-[11px]">estimado</Chip>}
              {statement.closing_date && <span>{due ? "· " : ""}cierre {shortDate(statement.closing_date)}</span>}
            </p>
          )}
        </section>
      )}

      {/* Sigue a lo filtrado, igual que la lista: un resumen que no coincide con las
          filas de abajo se lee como un error. Con una sola categoría no agrega nada. */}
      {breakdown.length > 1 && (
        <BreakdownStrip
          title="Por categoría"
          rows={breakdown}
          picked={categoryFilter || null}
          onPick={key => setCategoryFilter(key ?? "")}
          footnote={hasUsdInBreakdown ? "La barra compara sólo los pesos: los dólares no se suman." : null}
        />
      )}

      {statement.items.length > 0 && (
        <FilterBar>
          <FilterRow>
            <CollapsibleSearch
              open={searchOpen}
              onOpen={() => setSearchOpen(true)}
              onClose={() => { setSearch(""); setSearchOpen(false); }}
              value={search}
              onChange={setSearch}
              placeholder="Buscar por descripción o categoría..."
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
                options={presentCategories.map(c => ({ value: String(c.id), label: c.name }))} />
              {presentTypes.length > 1 && (
                <PillSelect value={typeFilter} onChange={setTypeFilter} placeholder="Tipo"
                  options={presentTypes.map(t => ({ value: t, label: ITEM_TYPE_LABELS[t] }))} />
              )}
              {presentCurrencies.length > 1 && (
                <PillSelect value={currencyFilter} onChange={setCurrencyFilter} placeholder="Moneda"
                  options={presentCurrencies.map(c => ({ value: c, label: c === "ARS" ? "Pesos" : "Dólares" }))} />
              )}
              {presentLoaders.length > 1 && (
                <PillSelect value={loadedByFilter} onChange={setLoadedByFilter} placeholder="Lo cargó"
                  options={presentLoaders} />
              )}
              <PillDateRange
                from={dateFrom} to={dateTo}
                onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
                placeholder="Fecha de compra"
              />
              {panelFilterActive && <ClearFilters onClick={clearPanelFilters} />}
            </FilterPanel>
          )}
        </FilterBar>
      )}

      <MotionList as="section" className="px-2">
        {statement.items.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[19px] font-medium tracking-[-0.02em] text-foreground">Este resumen todavía no tiene gastos.</p>
            <p className="mt-1 text-[15px] text-muted-foreground">{features.reconcile ? "Cargá el primero, o subí el PDF del banco si ya lo tenés." : "Cargá el primero."}</p>
            <Button className="mt-4 h-11" onClick={() => setShowAddForm(true)}>Agregar gasto</Button>
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="py-6 text-[15px] text-muted-foreground">Ningún gasto coincide con la búsqueda o los filtros.</p>
        ) : (
          <MotionList>
            {visibleItems.map((item, i) => {
              const marks = itemMarks(item);
              return (
                <LedgerRow key={item.id}
                  date={item.item_date}
                  showDate={!byDate || i === 0 || visibleItems[i - 1].item_date !== item.item_date}
                  title={item.description}
                  sub={<>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.category.color || "#6366f1" }} />
                      <span className="truncate">{[item.category.name, ...marks].join(" · ")}</span>
                    </span>
                    <LoadedByTag name={loadedBy.nameOf(item.user_id)} />
                  </>}
                  amount={ledgerAmount(item.amount, item.currency)}
                  onOpen={() => setDetailItem(item)}
                />
              );
            })}
          </MotionList>
        )}
        {/* A resumen's "Total" is what the bank debits, so a filtered sum can't
            wear that label unqualified — and the real total has to stay on screen
            next to it. Sin filtros no va: ya está arriba. */}
        {filtering && visibleItems.length > 0 && (
          <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 border-t-2 border-foreground/80">
            <span className="min-w-0">
              <span className="block text-[15.5px] font-semibold text-foreground">
                Total filtrado ({visibleItems.length} de {statement.items.length})
              </span>
              <span className="block text-sm text-muted-foreground tabular-nums">
                Total del resumen: {full.ars > 0 && ledgerAmount(full.ars)}
                {full.ars > 0 && full.usd > 0 && " y "}
                {full.usd > 0 && ledgerAmount(full.usd, "USD")}
              </span>
            </span>
            <span className="shrink-0 text-right font-semibold tabular-nums text-foreground">
              {shown.ars > 0 && <span className="block text-lg">{ledgerAmount(shown.ars)}</span>}
              {shown.usd > 0 && <span className="block text-sm">{ledgerAmount(shown.usd, "USD")}</span>}
            </span>
          </div>
        )}
      </MotionList>

      {detailItem && (
        <ItemSheet
          item={detailItem}
          loadedBy={loadedBy.nameOf(detailItem.user_id)}
          onEdit={() => { setEditItem(detailItem); setDetailItem(null); }}
          onDelete={() => handleDeleteItem(detailItem)}
          onShare={() => { setShareItem(detailItem); setDetailItem(null); }}
          onOriginal={() => openOriginal(detailItem)}
          onShared={() => { setDetailItem(null); router.push("/shared"); }}
          onClose={() => setDetailItem(null)}
        />
      )}
      {showAddForm && (
        <AddItemSheet
          statementId={statementId}
          categories={categories}
          onCategoriesChanged={load}
          onSaved={async () => {
            reaccionar("guardado", "Gasto agregado");
            setShowAddForm(false);
            await load();
          }}
          onClose={() => setShowAddForm(false)}
        />
      )}
      {editItem && (
        <EditItemModal item={editItem} categories={categories} onSave={handleEditItem} onClose={() => setEditItem(null)} />
      )}
      {shareItem && (
        <ShareItemModal item={shareItem} onClose={() => setShareItem(null)}
          onDone={() => { reaccionar("guardado", "Gasto compartido"); setShareItem(null); load(); }}
          currentUser={appUser} />
      )}
    </div>
  );
}

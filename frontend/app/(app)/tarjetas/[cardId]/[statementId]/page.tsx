"use client";

import { useEffect, useState, useCallback, useMemo, Fragment, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatDate, formatUSD, parseAmount, getErrorMessage, pickCategoryColor, foldText, cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ChevronLeft, X, ExternalLink, Users2, SlidersHorizontal, MoreVertical, Trash2 } from "lucide-react";
import { Card as UiCard } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Button } from "@/components/ui/button";
import { FIELD, SelectField, DateField } from "@/components/ui/form";
import { ParticipantPicker, type PickedParticipant } from "@/components/ParticipantPicker";
import {
  FilterBar, FilterRow, FilterPanel, SortChip, FilterChip, PillSelect,
  PillDateRange, ClearFilters, CollapsibleSearch,
} from "@/components/ui/filters";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }
interface CardItem {
  id: number; description: string; category_id: number; item_date: string; item_type: string;
  amount: number; installment_count?: number; installment_number?: number;
  purchase_total?: number; installment_group_id?: number; installment_root_statement_id?: number; shared_expense_id?: number; expense_entry_id?: number; currency?: string;
  category: { id: number; name: string; color?: string };
}
interface Statement {
  id: number; card_id: number; year: number; month: number;
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

// Same wording as the row badges, so a filter names what the user sees.
const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  single: "Único", installment: "Cuotas", recurring: "Recurrente",
};
type AmountMode = "per_installment" | "total";

const EMPTY_ITEM = {
  description: "", category_id: "", item_date: "", item_type: "single" as ItemType,
  amount: "", installment_count: "2", purchase_total: "", amount_mode: "per_installment" as AmountMode,
  currency: "ARS" as "ARS" | "USD",
};

// Los chips de una fila. Un pago unico no lleva ninguno: marcar lo normal no
// informa nada y deja la columna llena de ruido; el chip se reserva para lo
// que cambia como hay que leer el gasto (cuotas, recurrencia, reparto).
// `compact` es la version de mobile, donde los chips van dentro de la columna
// de descripcion: al tamano normal dos chips no entran en la misma linea y
// cada fila crecia dos renglones.
function itemChips(item: CardItem, compact = false): ReactNode[] {
  const size = compact ? "px-2 py-0.5 text-[11px]" : "";
  const chips: ReactNode[] = [];
  if (item.item_type === "recurring") {
    chips.push(<Chip key="tipo" tone="violet" className={size}>Recurrente</Chip>);
  } else if (item.item_type === "installment") {
    const isChild = !!item.installment_group_id;
    chips.push(
      <Chip key="tipo" tone={isChild ? "amber" : "violet"} className={size}>
        Cuota {item.installment_number}/{item.installment_count}
      </Chip>
    );
  }
  if (item.shared_expense_id) {
    chips.push(<Chip key="compartido" tone="emerald" className={size}>Compartido</Chip>);
  }
  return chips;
}

const MENU_ITEM =
  "flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full outline-none cursor-pointer";

// Las acciones de la fila viven detras del menu: son tres, dos dependen del
// tipo de item, y sueltas en la fila corrian la columna del monto segun que
// item fuera. "Ver original" y "Eliminar" son excluyentes por el backend: una
// cuota hija responde 400 ("Para eliminar, ve al resumen de la cuota 1").
function ItemActionsMenu({ item, onShare, onDelete, onOriginal }: {
  item: CardItem;
  onShare: () => void;
  onDelete: () => void;
  onOriginal: () => void;
}) {
  const isChild = !!item.installment_group_id;
  const shared = !!item.shared_expense_id;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button title="Acciones" aria-label={`Acciones de ${item.description}`}
          className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors outline-none">
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4}
          className="bg-card border rounded-xl shadow-lg p-1 w-52 z-50">
          {isChild ? (
            <DropdownMenu.Item asChild>
              <button onClick={onOriginal} className={MENU_ITEM}>
                <ExternalLink className="w-4 h-4 text-muted-foreground" /> Ver original
              </button>
            </DropdownMenu.Item>
          ) : (
            <>
              <DropdownMenu.Item asChild disabled={shared}>
                <button onClick={onShare} disabled={shared}
                  className={cn(MENU_ITEM, "disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent")}>
                  <Users2 className={`w-4 h-4 ${shared ? "text-primary" : "text-muted-foreground"}`} />
                  {shared ? "Ya compartido" : "Compartir gasto"}
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item asChild>
                <button onClick={onDelete} className={cn(MENU_ITEM, "text-destructive")}>
                  <Trash2 className="w-4 h-4" /> Eliminar gasto
                </button>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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

  useEffect(() => {
  }, []);

  useEffect(() => {
    if (!currentUser || participants.length > 0) return;
    setParticipants([{
      type: "self",
      user_id: currentUser.id,
      member_name: currentUser.display_name || currentUser.email,
      contact: "",
      amount: "",
    }]);
  }, [currentUser]);

  const cuotasRestantes = item.item_type === "installment" && !item.installment_group_id
    ? (item.installment_count || 1) - (item.installment_number || 1) + 1
    : 0;

  const equalShare = participants.length > 0 ? totalAmount / participants.length : 0;
  const customTotal = participants.reduce((s, p) => s + parseAmount(p.amount || "0"), 0);
  const overBudget = splitType === "custom" && customTotal > totalAmount + 0.01;

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
    if (participants.length < 2) { setError("Agrega al menos 1 persona mas"); return; }
    if (participants.some(p => p.type !== "self" && !p.member_name.trim())) {
      setError("Todos los participantes deben tener nombre"); return;
    }
    setSharing(true);
    setError("");
    try {
      const splits = participants.map((p, i) => {
        const amount = splitType === "equal"
          ? (i === participants.length - 1
            ? parseFloat((totalAmount - parseFloat(equalShare.toFixed(2)) * (participants.length - 1)).toFixed(2))
            : parseFloat(equalShare.toFixed(2)))
          : parseAmount(p.amount || "0");
        return {
          user_id: p.type === "external" ? null : p.user_id,
          member_name: p.member_name,
          amount,
          ...(p.type === "external" && p.contact.trim() ? { invite_contact: p.contact.trim() } : {}),
        };
      });
      if (splitType === "custom") {
        const sum = splits.reduce((s, sp) => s + sp.amount, 0);
        if (Math.abs(sum - totalAmount) > 0.02) {
          setError("La suma no coincide con el total");
          setSharing(false); return;
        }
      }
      await api.post("/credit-cards/items/" + item.id + "/share", { splits, split_type: splitType });
      onDone();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Error al compartir"));
    }
    setSharing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Compartir gasto</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-muted rounded-lg px-3 py-2 text-sm space-y-0.5">
          <p className="font-medium text-foreground">{item.description}</p>
          <p className="text-muted-foreground">{item.currency === "USD" ? formatUSD(item.amount) : formatARS(item.amount)} por cuota</p>
          {cuotasRestantes > 1 && (
            <p className="text-xs text-amber-600 mt-1">Se compartiran las {cuotasRestantes} cuotas del plan</p>
          )}
          {item.item_type === "recurring" && (
            <p className="text-xs text-primary mt-1">Solo se comparte el mes actual</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            {(["equal", "custom"] as const).map(t => (
              <button key={t} type="button" onClick={() => setSplitType(t)}
                className={"flex-1 py-1.5 text-xs rounded-full border-2 font-medium transition-colors " + (splitType === t ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent")}>
                {t === "equal" ? "Division igual" : "Personalizado"}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Participantes</p>
              <button type="button" onClick={addParticipant}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Agregar
              </button>
            </div>

            <ParticipantPicker
              open={pickerFor !== null}
              onClose={() => setPickerFor(null)}
              onPick={picked => { if (pickerFor !== null) applyPick(pickerFor, picked); }}
              excludeUserIds={participants.map(x => x.user_id).filter((x): x is number => x !== null)}
            />

            <div className="space-y-2">
              {participants.map((p, idx) => (
                <div key={idx} className="border rounded-lg p-2.5 bg-muted space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">
                        {p.member_name || <span className="text-muted-foreground font-normal">Sin elegir</span>}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {p.type === "self" ? "Vos" : p.user_id ? "Usuario de RegistrApp"
                          : p.contact ? `Se le invita a ${p.contact}`
                          : p.member_name ? "Sin cuenta — sólo para anotar tu parte" : ""}
                      </span>
                    </span>
                    {p.type !== "self" && (
                      <>
                        <button type="button" onClick={() => setPickerFor(idx)}
                          className="text-xs text-primary hover:underline shrink-0">
                          {p.member_name ? "Cambiar" : "Elegir"}
                        </button>
                        <button type="button" onClick={() => removeParticipant(idx)}
                          aria-label="Quitar participante"
                          className="text-muted-foreground hover:text-destructive px-1 text-base leading-none shrink-0">x</button>
                      </>
                    )}
                  </div>

                  {splitType === "custom" ? (
                    <div>
                      <label className="text-xs text-muted-foreground">Monto</label>
                      <input
                        required
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9.,]*"
                        placeholder="0,00"
                        value={p.amount}
                        onChange={e => updateParticipant(idx, { amount: e.target.value })}
                        className={FIELD}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs text-muted-foreground">Monto</span>
                      <span className="text-sm font-medium text-foreground">
                        {totalAmount > 0 ? formatARS(equalShare) : "-"}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {splitType === "equal" && totalAmount > 0 && participants.length > 1 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {formatARS(totalAmount)} / {participants.length} = {formatARS(equalShare)} por persona
              </p>
            )}

            {splitType === "custom" && totalAmount > 0 && (
              <div className={"mt-2 text-xs rounded-lg px-3 py-2 " + (overBudget ? "bg-destructive/10 text-destructive font-medium" : "bg-accent text-primary")}>
                {overBudget
                  ? "La division supera el total: " + formatARS(customTotal) + " de " + formatARS(totalAmount)
                  : "Distribuido: " + formatARS(customTotal) + " | Restante: " + formatARS(totalAmount - customTotal)
                }
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" disabled={sharing || participants.length < 2 || overBudget} className="flex-1">
              {sharing ? "Compartiendo..." : "Compartir"}
            </Button>
          </div>
        </form>
      </UiCard>
    </div>
  );
}

function DeleteItemModal({
  item,
  onConfirm,
  onClose,
}: {
  item: CardItem;
  onConfirm: (deleteGroup: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const isInstallment = item.item_type === "installment";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Eliminar {isInstallment ? "cuotas" : "item"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        {isInstallment ? (
          <p className="text-sm text-muted-foreground">
            Se eliminarán <strong>todas las {item.installment_count} cuotas</strong> de &quot;{item.description}&quot; y sus gastos en todos los resumenes.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Se eliminara <strong>{item.description}</strong> y su gasto en Egresos.</p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="destructive" onClick={async () => { setDeleting(true); await onConfirm(isInstallment); setDeleting(false); }}
            disabled={deleting} className="flex-1">
            {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </div>
      </UiCard>
    </div>
  );
}

function EditItemModal({
  item,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  item: CardItem;
  categories: Category[];
  onSave: (data: { description: string; category_id: number; item_date: string; amount: number }) => Promise<void>;
  onDelete: (item: CardItem) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    description: item.description,
    category_id: String(item.category_id),
    item_date: item.item_date,
    amount: String(item.amount),
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      description: form.description,
      category_id: parseInt(form.category_id),
      item_date: form.item_date,
      amount: parseAmount(form.amount),
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Editar item</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Descripción</label>
              <input className={FIELD}
                value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <SelectField value={form.category_id}
                onChange={v => setForm((p) => ({ ...p, category_id: v }))}
                options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha</label>
              <DateField required value={form.item_date}
                onChange={v => setForm((p) => ({ ...p, item_date: v }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Monto</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} required />
            </div>
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <button type="button" onClick={() => { onClose(); onDelete(item); }}
              className="px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 border border-destructive/30">
              Eliminar
            </button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </form>
      </UiCard>
    </div>
  );
}


function NewCategoryModal({ existingColors, onSave, onClose }: {
  existingColors: (string | null | undefined)[];
  onSave: (cat: { name: string; color: string; is_fixed: boolean }) => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState({ name: "", color: pickCategoryColor(existingColors), is_fixed: false });
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{background:"rgba(0,0,0,0.4)"}} onClick={onClose}>
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Nueva categoría</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSave(form); setSaving(false); }} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input className={FIELD} placeholder="Supermercado" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Color</label>
              <input type="color" className="mt-1 block h-9 w-12 border-2 border-ink rounded-lg cursor-pointer"
                value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={form.is_fixed} onChange={(e) => setForm((p) => ({ ...p, is_fixed: e.target.checked }))} />
              Fijo
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Crear"}
            </Button>
          </div>
        </form>
      </UiCard>
    </div>
  );
}

export default function StatementDetailPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const { appUser } = useAuth();
  const params = useParams();
  const router = useRouter();
  const cardId = Number(params.cardId);
  const statementId = Number(params.statementId);

  const [card, setCard] = useState<Card | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [adding, setAdding] = useState(false);
  const [deleteItem, setDeleteItem] = useState<CardItem | null>(null);
  const [shareItem, setShareItem] = useState<CardItem | null>(null);
  const [editItem, setEditItem] = useState<CardItem | null>(null);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [showCustomFilter, setShowCustomFilter] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
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
  }, [cardId, statementId]);

  useEffect(() => { load(); }, [load]);

  const handleAmountChange = (field: "amount" | "purchase_total", value: string) => {
    if (form.item_type !== "installment") {
      setForm((p) => ({ ...p, amount: value }));
      return;
    }
    const count = parseInt(form.installment_count) || 1;
    if (field === "amount") {
      const pt = parseAmount(value) * count;
      setForm((p) => ({ ...p, amount: value, purchase_total: isNaN(pt) ? "" : pt.toFixed(2) }));
    } else {
      const amt = parseAmount(value) / count;
      setForm((p) => ({ ...p, purchase_total: value, amount: isNaN(amt) ? "" : amt.toFixed(2) }));
    }
  };

  const handleInstallmentCountChange = (value: string) => {
    const count = parseInt(value) || 1;
    setForm((p) => {
      const amt = parseAmount(p.amount);
      const pt = isNaN(amt) ? "" : (amt * count).toFixed(2);
      return { ...p, installment_count: value, purchase_total: pt };
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    const payload: Record<string, unknown> = {
      description: form.description,
      item_date: form.item_date,
      item_type: form.item_type,
      amount: parseAmount(form.amount),
      currency: form.currency,
    };
    if (form.currency === "ARS") payload.category_id = parseInt(form.category_id);
    if (form.item_type === "installment") {
      payload.installment_count = parseInt(form.installment_count);
      payload.installment_number = 1;
      payload.purchase_total = parseAmount(form.purchase_total);
    }
    await api.post(`/credit-cards/statements/${statementId}/items`, payload);
    setForm(EMPTY_ITEM);
    setShowAddForm(false);
    await load();
    setAdding(false);
  };

  const handleDeleteItem = async (deleteGroup: boolean) => {
    if (!deleteItem) return;
    await api.delete(`/credit-cards/items/${deleteItem.id}?delete_group=${deleteGroup}`);
    setDeleteItem(null);
    await load();
  };

  const handleCreateCategory = async (cat: { name: string; color: string; is_fixed: boolean }) => {
    const res = await api.post("/expenses/categories", cat);
    await load();
    setForm((p) => ({ ...p, category_id: String(res.data.id) }));
    setShowNewCat(false);
  };

    const handleEditItem = async (data: { description: string; category_id: number; item_date: string; amount: number }) => {
    if (!editItem) return;
    await api.patch(`/credit-cards/items/${editItem.id}`, data);
    setEditItem(null);
    await load();
  };

  const panelFilterActive = !!(categoryFilter || typeFilter || currencyFilter || dateFrom || dateTo);
  const clearPanelFilters = () => {
    setCategoryFilter(""); setTypeFilter(""); setCurrencyFilter("");
    setDateFrom(""); setDateTo("");
  };

  // Tap cycle: inactive -> asc -> desc -> inactive, where inactive is the
  // order the endpoint already returns (item_date, id).
  function toggleSort(key: SortKey) {
    if (sort !== key) { setSort(key); setOrder("asc"); return; }
    if (order === "asc") { setOrder("desc"); return; }
    setSort(null);
  }

  // Only offer values this statement actually contains — a pill option that
  // matches nothing here reads as "no hay nada" when it means "no existe".
  const items = useMemo(() => statement?.items ?? [], [statement]);
  const presentCategories = useMemo(() => {
    const seen = new Map<number, string>();
    items.forEach(i => seen.set(i.category.id, i.category.name));
    return Array.from(seen, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [items]);
  const presentTypes = useMemo(
    () => (Object.keys(ITEM_TYPE_LABELS) as ItemType[]).filter(t => items.some(i => i.item_type === t)),
    [items],
  );
  const presentCurrencies = useMemo(
    () => ["ARS", "USD"].filter(c => items.some(i => (i.currency || "ARS") === c)),
    [items],
  );

  const visibleItems = useMemo(() => {
    const q = foldText(search.trim());
    const out = items.filter(i => {
      // Match every field the row shows: its description and its category.
      if (q && !foldText(`${i.description} ${i.category.name}`).includes(q)) return false;
      if (categoryFilter && String(i.category.id) !== categoryFilter) return false;
      if (typeFilter && i.item_type !== typeFilter) return false;
      if (currencyFilter && (i.currency || "ARS") !== currencyFilter) return false;
      // item_date is ISO yyyy-MM-dd, so a string compare is a date compare.
      if (dateFrom && i.item_date < dateFrom) return false;
      if (dateTo && i.item_date > dateTo) return false;
      return true;
    });
    if (!sort) return out;
    const dir = order === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sort === "date") return dir * a.item_date.localeCompare(b.item_date);
      if (sort === "category") return dir * a.category.name.localeCompare(b.category.name, "es");
      // Amount orders by (currency, amount), never by amount alone: a statement
      // mixes both, and interleaving would sit U$D 500 next to $500.
      const ca = a.currency || "ARS", cb = b.currency || "ARS";
      if (ca !== cb) return ca.localeCompare(cb);
      return dir * (Number(a.amount) - Number(b.amount));
    });
  }, [items, search, categoryFilter, typeFilter, currencyFilter, dateFrom, dateTo, sort, order]);

  if (!card || !statement) return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;

  const totalByCategory = visibleItems.reduce<Record<number, { name: string; color?: string; total: number }>>((acc, item) => {
    const cid = item.category.id;
    if (!acc[cid]) acc[cid] = { name: item.category.name, color: item.category.color, total: 0 };
    acc[cid].total += Number(item.amount);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="sticky top-0 z-10 bg-background pt-2 pb-3 -mx-4 px-4 md:-mx-8 md:px-8">
        <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/tarjetas/${cardId}`)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">
            {MONTH_NAMES[statement.month - 1]} {statement.year}
          </h2>
          <p className="text-sm text-muted-foreground">{card.alias} - {card.bank}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Agregar</span>
          </Button>
        </div>
        </div>
      </div>

      {/* Add item form */}
      {showAddForm && (
        <UiCard className="p-4">
          <form onSubmit={handleAddItem} className="space-y-3">
          <p className="text-sm font-medium text-foreground">Nuevo item</p>

          {/* Currency toggle — always at top */}
          <div className="flex gap-2">
            {(["ARS", "USD"] as const).map(cur => (
              <button key={cur} type="button"
                onClick={() => setForm(p => ({ ...p, currency: cur, category_id: cur === "USD" ? "" : p.category_id, item_type: cur === "USD" ? "single" : p.item_type }))}
                className={`flex-1 py-1.5 text-xs rounded-full border-2 font-medium transition-colors ${form.currency === cur ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent"}`}>
                {cur === "ARS" ? "$ ARS" : "U$D"}
              </button>
            ))}
          </div>
          {form.currency === "USD" && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
              Se agrega automáticamente a la categoría <strong>Consumo en dólares</strong>
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Descripción</label>
              <input className={FIELD} placeholder="TV Samsung"
                value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
            </div>
            {form.currency !== "USD" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <div className="flex gap-1.5">
                <SelectField className="flex-1" required={form.currency === "ARS"}
                  value={form.category_id}
                  onChange={v => setForm((p) => ({ ...p, category_id: v }))}
                  placeholder="Categoría"
                  options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
                <button type="button" onClick={() => setShowNewCat(true)} title="Nueva categoría"
                  className="mt-1 px-2.5 border-2 border-ink rounded-lg text-muted-foreground hover:bg-accent shrink-0 text-lg leading-none">+</button>
              </div>
            </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha</label>
              <DateField required value={form.item_date}
                onChange={v => setForm((p) => ({ ...p, item_date: v }))} />
            </div>
            {form.currency !== "USD" && (
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <div className="mt-1 flex gap-2">
                {(["single","installment","recurring"] as ItemType[]).map((t) => (
                  <button key={t} type="button"
                    onClick={() => setForm((p) => ({ ...p, item_type: t }))}
                    className={`flex-1 py-1.5 text-xs rounded-full border-2 font-medium transition-colors ${
                      form.item_type === t ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground hover:bg-accent"
                    }`}>
                    {t === "single" ? "Unico" : t === "installment" ? "Cuotas" : "Recurrente"}
                  </button>
                ))}
              </div>
            </div>
            )}

            {form.item_type === "installment" ? (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Cant. cuotas</label>
                  <input type="number" min="2" className={FIELD}
                    value={form.installment_count} onChange={(e) => handleInstallmentCountChange(e.target.value)} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Monto por cuota ($)</label>
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                    value={form.amount} onChange={(e) => handleAmountChange("amount", e.target.value)} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Monto total ($)</label>
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                    value={form.purchase_total} onChange={(e) => handleAmountChange("purchase_total", e.target.value)} />
                  <p className="text-xs text-muted-foreground/70 mt-0.5">Modificar uno auto-calcula el otro</p>
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Monto</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD}
                  value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} required />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => { setShowAddForm(false); setForm(EMPTY_ITEM); }}>Cancelar</Button>
            <Button type="submit" disabled={adding}>
              {adding ? "Agregando..." : "Agregar"}
            </Button>
          </div>
          </form>
        </UiCard>
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

      {/* Items list — tabla de cuatro columnas: descripcion | chips | monto |
          menu. Las columnas se declaran en la grilla del contenedor y no en
          cada fila, que es lo unico que hace que monto y menu queden
          alineados entre filas aunque los chips de cada una midan distinto.
          En mobile la columna de chips se apaga y los chips bajan dentro de
          la descripcion — el mismo pliegue que usa la fecha en Egresos, sin
          el cual el monto fijo deja la descripcion en dos palabras. */}
      <UiCard className="p-0 md:p-0">
        {statement.items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No hay items en este resumen.</p>
        ) : visibleItems.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Ningún item coincide con la búsqueda/filtro.</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] px-4">
            {visibleItems.map((item, idx) => {
              const chips = itemChips(item);
              // Las celdas se estiran a la altura de la fila (sin items-center
              // en la grilla), asi el borde superior de las cuatro cae en la
              // misma linea y el separador es uno solo.
              const cell = `flex items-center py-3 ${idx > 0 ? "border-t" : ""}`;
              const openOriginal = () => router.push(`/tarjetas/${cardId}/${item.installment_root_statement_id}`);
              return (
                <Fragment key={item.id}>
                  <button
                    onClick={() => item.installment_group_id ? openOriginal() : setEditItem(item)}
                    className={`${cell} gap-2 min-w-0 pr-3 text-left`}
                  >
                    {/* Alineada con el titulo, no con el centro de la celda:
                        con los chips abajo en mobile la fila crece y la
                        pelotita quedaba flotando a la altura de un chip. */}
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 self-start mt-[5px]" style={{ backgroundColor: item.category.color || "#6366f1" }} />
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">{item.description}</span>
                      <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5">
                        <span className="min-w-0 text-xs text-muted-foreground/70 truncate">{item.category.name}</span>
                        <span className="text-xs text-muted-foreground/40">|</span>
                        {/* El anio de dos digitos solo en mobile: con la fecha
                            completa, la categoria se quedaba en tres letras. */}
                        <span className="text-xs text-muted-foreground/70 shrink-0 sm:hidden">{formatDate(item.item_date).replace(/\/\d{2}(\d{2})$/, "/$1")}</span>
                        <span className="text-xs text-muted-foreground/70 shrink-0 hidden sm:inline">{formatDate(item.item_date)}</span>
                      </div>
                      {chips.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1.5 sm:hidden">{itemChips(item, true)}</div>
                      )}
                    </div>
                  </button>
                  {/* Hasta tres chips: crece con el contenido, con el tope
                      puesto para que no se coma la descripcion. */}
                  <div className={`${cell} hidden sm:flex flex-wrap justify-end gap-1 pr-3 max-w-[17rem]`}>{chips}</div>
                  {/* Ancho fijo de 18ch, el mismo de Egresos: a 14px son 166px y
                      "$ 999.999.999.999,99" mide 154, asi que el maximo entra
                      entero. En mobile el cuerpo baja a 12px — 143px de ancho,
                      donde ese mismo maximo mide 132 — porque a 14px la columna
                      se llevaba media pantalla y dejaba la descripcion en 126px. */}
                  <div className={`${cell} justify-end pr-1 sm:pr-2`}>
                    <span className="w-[18ch] text-xs sm:text-sm font-semibold text-rose-600 text-right truncate">{item.currency === "USD" ? formatUSD(item.amount) : formatARS(item.amount)}</span>
                  </div>
                  <div className={`${cell} justify-end`}>
                    <ItemActionsMenu
                      item={item}
                      onShare={() => setShareItem(item)}
                      onDelete={() => setDeleteItem(item)}
                      onOriginal={openOriginal}
                    />
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
        {visibleItems.length > 0 && (() => {
          const arsTotal = visibleItems.filter(i => i.currency !== "USD").reduce((s, i) => s + Number(i.amount), 0);
          const usdTotal = visibleItems.filter(i => i.currency === "USD").reduce((s, i) => s + Number(i.amount), 0);
          // A resumen's "Total" is what the bank debits, so a filtered sum
          // can't wear that label unqualified — and the real total has to stay
          // on screen next to it.
          const filtering = visibleItems.length !== statement.items.length;
          const fullArs = statement.items.filter(i => i.currency !== "USD").reduce((s, i) => s + Number(i.amount), 0);
          const fullUsd = statement.items.filter(i => i.currency === "USD").reduce((s, i) => s + Number(i.amount), 0);
          return (
            <div className="flex items-center justify-between px-4 py-3 bg-muted border-t rounded-b-2xl flex-wrap gap-1">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {filtering ? `Total filtrado (${visibleItems.length} de ${statement.items.length})` : "Total"}
                </span>
                {filtering && (
                  <span className="text-xs text-muted-foreground">
                    Total del resumen: {fullArs > 0 && formatARS(fullArs)}
                    {fullArs > 0 && fullUsd > 0 && " + "}
                    {fullUsd > 0 && formatUSD(fullUsd)}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                {arsTotal > 0 && <span className="text-base font-bold text-rose-600">{formatARS(arsTotal)}</span>}
                {usdTotal > 0 && <span className="text-sm font-bold text-emerald-600">{formatUSD(usdTotal)}</span>}
              </div>
            </div>
          );
        })()}
      </UiCard>

      {/* Category summary */}
      {Object.keys(totalByCategory).length > 0 && (
        <UiCard className="p-4">
          <p className="text-sm font-medium text-foreground mb-3">Por categoría</p>
          <div className="space-y-2">
            {Object.values(totalByCategory).sort((a, b) => b.total - a.total).map((cat) => (
              <div key={cat.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || "#6366f1" }} />
                <span className="flex-1 text-sm text-foreground truncate">{cat.name}</span>
                <span className="text-sm font-semibold text-foreground">{formatARS(cat.total)}</span>
              </div>
            ))}
          </div>
        </UiCard>
      )}

      {deleteItem && (
        <DeleteItemModal item={deleteItem} onConfirm={handleDeleteItem} onClose={() => setDeleteItem(null)} />
      )}
      {editItem && (
        <EditItemModal item={editItem} categories={categories} onSave={handleEditItem} onDelete={setDeleteItem} onClose={() => setEditItem(null)} />
      )}
      {showNewCat && (
        <NewCategoryModal
          existingColors={categories.map(c => c.color)}
          onSave={handleCreateCategory}
          onClose={() => setShowNewCat(false)}
        />
      )}
      {shareItem && (
        <ShareItemModal item={shareItem} onClose={() => setShareItem(null)} onDone={() => { setShareItem(null); load(); }} currentUser={appUser} />
      )}
    </div>
  );
}

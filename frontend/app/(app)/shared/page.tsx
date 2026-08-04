"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, Trash2, CheckCircle, XCircle, Clock, Users, Copy, Link, MessageCircle, Smartphone, Layers, CalendarDays, ChevronLeft, ChevronRight, Share2, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Pencil, X } from "lucide-react";

import api from "@/lib/api";
import { formatARS, formatUSD, normalizePhoneNumber, getErrorMessage, pickCategoryColor } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { COUNTRIES } from "@/lib/countries";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";

function buildPhone(prefix: string, local: string): string {
  const digits = local.replace(/\D/g, "");
  return prefix === "54" ? prefix + "9" + digits : prefix + digits;
}

// Pick a contact from device and normalize phone to prefix + local format
async function pickContactAndNormalize(availablePrefixes: string[]): Promise<{ name: string; phone: string; prefix: string; local: string } | null> {
  if (!("contacts" in navigator) || !navigator.contacts) return null;

  try {
    const contacts = navigator as unknown as { contacts: { select: (f: string[], o: object) => Promise<{ name?: string[]; tel?: string[] }[]> } };
    const [contact] = await contacts.contacts.select(["name", "tel"], { multiple: false });
    if (!contact) return null;

    const name = contact.name?.[0] ?? "";
    const rawPhone = contact.tel?.[0] ?? "";
    if (!name || !rawPhone) return null;

    const { prefix, local, isValid } = normalizePhoneNumber(rawPhone, availablePrefixes);
    if (!isValid) {
      alert(`Número no válido: ${rawPhone}. Por favor, completa manualmente.`);
      return null;
    }

    return { name, phone: buildPhone(prefix, local), prefix, local };
  } catch (err) {
    console.error("Contact picker error:", err);
    return null;
  }
}

interface Split {
  id: number;
  user_id: number | null;
  member_name: string;
  amount: number;
  status: "pending" | "accepted" | "rejected";
  expense_entry_id: number | null;
  invite_email: string | null;
  invite_token: string | null;
  converted_ars_amount: number | null;
  converted_ars_rate: number | null;
  converted_ars_rate_type: RateType | null;
}

const RATE_TYPES = ["blue", "oficial", "mayorista", "mep", "ccl"] as const;
type RateType = (typeof RATE_TYPES)[number];
const RATE_TYPE_LABELS: Record<RateType, string> = {
  blue: "Blue", oficial: "Oficial", mayorista: "Mayorista", mep: "MEP", ccl: "CCL",
};

// Resolve what to actually show/balance for a split: its settlement-time ARS
// conversion if one was set, otherwise its raw amount in the expense's own
// currency. Never mixes converted (ARS) and unconverted (USD) amounts.
function resolveDisplay(split: Split, expenseCurrency: "ARS" | "USD"): { amount: number; currency: "ARS" | "USD" } {
  if (split.converted_ars_amount != null) {
    return { amount: Number(split.converted_ars_amount), currency: "ARS" };
  }
  return { amount: Number(split.amount), currency: expenseCurrency };
}

interface SharedExpense {
  id: number;
  tenant_id: number;
  title: string;
  total_amount: number;
  currency: "ARS" | "USD";
  category_id: number;
  split_type: "equal" | "custom";
  expense_date: string;
  payment_date: string;
  locked: boolean;
  credit_card_item_id: number | null;
  created_by_user_id: number;
  created_at: string;
  installment_group_id: number | null;
  splits: Split[];
}

interface Member {
  id: number;
  display_name: string | null;
  email: string;
}

interface Category {
  id: number;
  name: string;
  color: string | null;
}

interface AgendaContact {
  id: number;
  contact_name: string;
  contact_phone: string;
}

interface ParticipantRow {
  type: "member" | "external";
  user_id: number | null;
  member_name: string;
  amount: string;
  manual: boolean;
  invite_method: "none" | "email" | "whatsapp";
  invite_email: string;
  invite_phone_prefix: string;
  invite_phone_local: string;
}

function parseAmt(s: string): number {
  return parseFloat(s.replace(",", ".")) || 0;
}

function fmtDate(d: string) {
  try { return format(new Date(d + "T12:00:00"), "d MMM yyyy", { locale: es }); }
  catch { return d; }
}

function fmtByCurrency(amount: number | string, currency: string) {
  return currency === "USD" ? formatUSD(amount) : formatARS(amount);
}

// Compact "d MMM" (no year) — used in the per-person monthly table, where
// the year is already shown once in the month selector above.
function fmtDateShort(d: string) {
  try { return format(new Date(d + "T12:00:00"), "d MMM", { locale: es }); }
  catch { return d; }
}

function redistAuto(parts: ParticipantRow[], total: number): ParticipantRow[] {
  const manualSum = parts.filter(p => p.manual).reduce((s, p) => s + parseAmt(p.amount), 0);
  const remaining = Math.max(0, total - manualSum);
  const autoCount = parts.filter(p => !p.manual).length;
  if (autoCount === 0) return parts;
  const perAuto = (remaining / autoCount).toFixed(2);
  return parts.map(p => p.manual ? p : { ...p, amount: perAuto });
}

// Deterministic color per person (same name/key always gets the same tone),
// distinct from pickCategoryColor which optimizes for "not already used".
const PERSON_COLOR_PALETTE = [
  "#5B4FE9", "#10b981", "#f59e0b", "#f43f5e", "#0ea5e9",
  "#14b8a6", "#f97316", "#ec4899", "#8b5cf6", "#64748b",
];
function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return PERSON_COLOR_PALETTE[Math.abs(hash) % PERSON_COLOR_PALETTE.length];
}
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.trim().slice(0, 2)).toUpperCase();
}
// Stable identity for a split's participant across expenses: registered
// members dedupe by user_id, external guests dedupe by name (no other
// stable id available for them).
function personKey(split: Split): string {
  return split.user_id != null ? `u:${split.user_id}` : `n:${split.member_name.trim().toLowerCase()}`;
}

function PersonAvatar({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  const color = colorForKey(name);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 shrink-0 w-16"
    >
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-sm transition-all ${active ? "ring-2 ring-offset-2 ring-primary" : ""}`}
        style={{ backgroundColor: color }}
      >
        {getInitials(name)}
      </div>
      <span className={`text-[11px] truncate w-full text-center ${active ? "text-primary font-medium" : "text-muted-foreground"}`}>
        {name.trim().split(/\s+/)[0]}
      </span>
    </button>
  );
}

function StatusChip({ status, hasToken }: { status: string; hasToken?: boolean }) {
  if (status === "accepted") return (
    <Chip tone="emerald"><CheckCircle className="w-3 h-3" /> Aceptado</Chip>
  );
  if (status === "rejected") return (
    <Chip tone="rose"><XCircle className="w-3 h-3" /> Rechazado</Chip>
  );
  if (hasToken) return (
    <Chip tone="violet"><Link className="w-3 h-3" /> Invitado</Chip>
  );
  return (
    <Chip tone="amber"><Clock className="w-3 h-3" /> Pendiente</Chip>
  );
}

// Field-level edit permissions mirror the backend (PATCH /shared-expenses/{id}):
// not locked (nobody but the creator accepted yet) → everything editable,
// locked → only title/dates, since another participant may already be
// relying on the amounts they saw when they accepted.
function EditExpenseModal({
  expense, categories, onClose, onSaved,
}: {
  expense: SharedExpense;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const unlocked = !expense.locked;
  const [title, setTitle] = useState(expense.title);
  const [totalAmount, setTotalAmount] = useState(String(expense.total_amount));
  const [categoryId, setCategoryId] = useState(String(expense.category_id));
  const [expenseDate, setExpenseDate] = useState(expense.expense_date);
  const [paymentDate, setPaymentDate] = useState(expense.payment_date);
  const [splitAmounts, setSplitAmounts] = useState<Record<number, string>>(
    () => Object.fromEntries(expense.splits.map(s => [s.id, String(s.amount)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total = parseAmt(totalAmount);
  const splitsSum = Object.values(splitAmounts).reduce((s, v) => s + parseAmt(v), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body: Record<string, unknown> = {
      title,
      expense_date: expenseDate,
      payment_date: paymentDate,
    };
    if (unlocked) {
      if (Math.abs(splitsSum - total) > 0.02) {
        setError(`La suma (${formatARS(splitsSum)}) no coincide con el total (${formatARS(total)})`);
        return;
      }
      body.total_amount = total;
      body.category_id = parseInt(categoryId);
      body.splits = expense.splits.map(s => ({ split_id: s.id, amount: parseAmt(splitAmounts[s.id]) }));
    }
    setSaving(true);
    try {
      await api.patch(`/shared-expenses/${expense.id}`, body);
      onSaved();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Error al editar el gasto"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Editar gasto</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!unlocked && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            Ya fue aceptado por otro participante — solo se puede corregir el título y las fechas.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input required value={title} onChange={e => setTitle(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha del gasto</label>
              <input required type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha de pago</label>
              <input required type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {unlocked ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Monto total</label>
                  <input required type="text" inputMode="decimal" value={totalAmount}
                    onChange={e => setTotalAmount(e.target.value)}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Categoría</label>
                  <select required value={categoryId} onChange={e => setCategoryId(e.target.value)}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card">
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Participantes</label>
                <div className="space-y-1.5">
                  {expense.splits.map(s => (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-foreground truncate">{s.member_name}</span>
                      <input type="text" inputMode="decimal" value={splitAmounts[s.id] ?? ""}
                        onChange={e => setSplitAmounts(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="w-28 border rounded-lg px-2 py-1.5 text-sm text-right" />
                    </div>
                  ))}
                </div>
                <p className={`text-xs mt-1.5 ${Math.abs(splitsSum - total) > 0.02 ? "text-destructive" : "text-muted-foreground"}`}>
                  Distribuido: {formatARS(splitsSum)} / Total: {formatARS(total)}
                </p>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground space-y-1 bg-muted rounded-lg px-3 py-2">
              <p>Monto: <strong className="text-foreground">{fmtByCurrency(expense.total_amount, expense.currency)}</strong></p>
              {expense.splits.map(s => (
                <p key={s.id}>{s.member_name}: {fmtByCurrency(s.amount, expense.currency)}</p>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// Settlement-time USD→ARS conversion — one split (per-person "Te debe" row)
// or every split of the expense at once (bulk "convertir todo" from the
// "Todos" card). Never touches `amount`, never blocked by `locked`.
function ConvertToArsModal({
  expense, splitIds, onClose, onSaved,
}: {
  expense: SharedExpense;
  splitIds: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const targetSplits = expense.splits.filter(s => splitIds.includes(s.id));
  const alreadyConverted = targetSplits.some(s => s.converted_ars_amount != null);
  const [rateType, setRateType] = useState<RateType>(
    (targetSplits[0]?.converted_ars_rate_type as RateType | null) ?? "blue"
  );
  const [rate, setRate] = useState<string>(
    targetSplits[0]?.converted_ars_rate != null ? Number(targetSplits[0].converted_ars_rate).toFixed(2) : ""
  );
  const [suggested, setSuggested] = useState<Partial<Record<RateType, number>> | null>(null);
  const [loadingRate, setLoadingRate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const from = new Date();
        from.setDate(from.getDate() - 14);
        const res = await api.get("/macro", { params: { from_date: from.toISOString().slice(0, 10) } });
        const latest = res.data?.[0]; // GET /macro is ordered by period_date desc
        if (latest) {
          // Decimal fields come back as JSON strings (Pydantic default), not
          // numbers — coerce before any arithmetic/.toFixed.
          const n = (v: unknown) => (v == null ? undefined : Number(v));
          const map: Partial<Record<RateType, number>> = {
            oficial: n(latest.usd_official), blue: n(latest.usd_blue), mayorista: n(latest.usd_mayorista),
            mep: n(latest.usd_mep), ccl: n(latest.usd_ccl),
          };
          setSuggested(map);
          setRate(prev => prev || (map[rateType] != null ? map[rateType]!.toFixed(2) : prev));
        }
      } catch { /* sin cotización sugerida, se completa a mano */ }
      finally { setLoadingRate(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRateTypeChange(t: RateType) {
    setRateType(t);
    if (suggested?.[t] != null) setRate(suggested[t]!.toFixed(2));
  }

  const rateNum = parseAmt(rate);

  async function handleConfirm() {
    setError("");
    if (rateNum <= 0) { setError("Ingresá una cotización válida"); return; }
    setSaving(true);
    try {
      await api.post(`/shared-expenses/${expense.id}/convert-to-ars`, {
        split_ids: splitIds, rate: rateNum, rate_type: rateType,
      });
      onSaved();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Error al convertir"));
    } finally { setSaving(false); }
  }

  async function handleRevert() {
    setSaving(true);
    try {
      await api.post(`/shared-expenses/${expense.id}/convert-to-ars`, {
        split_ids: splitIds, rate: null, rate_type: null,
      });
      onSaved();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Error al revertir"));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Convertir a pesos</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Cotización</label>
          <select value={rateType} onChange={e => handleRateTypeChange(e.target.value as RateType)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card">
            {RATE_TYPES.map(t => (
              <option key={t} value={t}>
                {RATE_TYPE_LABELS[t]}{suggested?.[t] != null ? ` — $${suggested[t].toFixed(2)}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Valor del dólar</label>
          <input required type="text" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)}
            placeholder={loadingRate ? "Cargando sugerencia..." : "0,00"}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="space-y-1 border-t pt-3">
          {targetSplits.map(s => (
            <div key={s.id} className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground truncate">{s.member_name}</span>
              <span className="font-medium text-foreground whitespace-nowrap">
                {formatUSD(s.amount)} → {rateNum > 0 ? formatARS(Number(s.amount) * rateNum) : "—"}
              </span>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          {alreadyConverted && (
            <Button type="button" variant="outline" onClick={handleRevert} disabled={saving} className="mr-auto text-muted-foreground">
              Volver a dólares
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={handleConfirm} disabled={saving || rateNum <= 0}>
            {saving ? "Guardando..." : "Confirmar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function SharedExpensesPage() {
  const { appUser } = useAuth();
  const [expenses, setExpenses] = useState<SharedExpense[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [agendaContacts, setAgendaContacts] = useState<AgendaContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState("#6366f1");
  const [savingCat, setSavingCat] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<SharedExpense | null>(null);
  const [converting, setConverting] = useState<{ expense: SharedExpense; splitIds: number[] } | null>(null);

  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [differentPaymentDate, setDifferentPaymentDate] = useState(false);
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  const [participants, setParticipants] = useState<ParticipantRow[]>([
    { type: "member", user_id: null, member_name: "", amount: "", manual: false, invite_method: "none", invite_email: "", invite_phone_prefix: "54", invite_phone_local: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const now = new Date();
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [personYear, setPersonYear] = useState(now.getFullYear());
  const [personMonth, setPersonMonth] = useState(now.getMonth() + 1);

  const total = parseAmt(totalAmount);

  const loadCategories = async () => {
    try {
      const res = await api.get("/expenses/categories");
      setCategories(res.data);
    } catch { /* ignorar */ }
  };

  const load = async () => {
    setLoading(true);
    const [se, mem, contacts] = await Promise.allSettled([
      api.get("/shared-expenses"),
      api.get("/auth/members"),
      api.get("/contacts"),
    ]);
    if (se.status === "fulfilled") setExpenses(se.value.data);
    if (mem.status === "fulfilled") setMembers(mem.value.data);
    if (contacts.status === "fulfilled") setAgendaContacts(contacts.value.data);
    await loadCategories();
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Pre-cargar el primer participante con el usuario actual (appUser siempre disponible)
  useEffect(() => {
    if (!appUser) return;
    setParticipants(prev => {
      if (prev[0].user_id !== null) return prev;
      const updated: ParticipantRow[] = [
        { ...prev[0], user_id: appUser.id, member_name: appUser.display_name || appUser.email },
        ...prev.slice(1),
      ];
      return splitType === "custom" ? redistAuto(updated, total) : updated;
    });
  }, [appUser]);

  // Redistribuir automaticos cuando cambia el monto total
  useEffect(() => {
    if (splitType === "custom" && total > 0) {
      setParticipants(prev => redistAuto(prev, total));
    }
  }, [totalAmount, splitType]);

  // --- Valores derivados ---
  const equalShare = participants.length > 0 && total > 0
    ? (total / participants.length).toFixed(2) : "0.00";

  const manualSum = splitType === "custom"
    ? participants.filter(p => p.manual).reduce((s, p) => s + parseAmt(p.amount), 0)
    : 0;
  const assignedSum = splitType === "custom"
    ? participants.reduce((s, p) => s + parseAmt(p.amount), 0)
    : 0;
  const overBudget = splitType === "custom" && total > 0 && manualSum > total + 0.01;

  // --- Helpers de participantes ---
  function updateParticipant(idx: number, patch: Partial<ParticipantRow>) {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function setManualAmount(idx: number, value: string) {
    setParticipants(prev => {
      const updated = prev.map((p, i) =>
        i === idx ? { ...p, amount: value, manual: true } : p
      );
      return redistAuto(updated, total);
    });
  }

  function addParticipant() {
    setParticipants(prev => {
      const newRow: ParticipantRow = {
        type: "member", user_id: null, member_name: "", amount: "", manual: false, invite_method: "none", invite_email: "", invite_phone_prefix: "54", invite_phone_local: "",
      };
      const updated = [...prev, newRow];
      return splitType === "custom" ? redistAuto(updated, total) : updated;
    });
  }

  function removeParticipant(idx: number) {
    if (idx === 0 || participants.length <= 1) return;
    setParticipants(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      return splitType === "custom" ? redistAuto(updated, total) : updated;
    });
  }

  function handleSplitTypeChange(newType: "equal" | "custom") {
    setSplitType(newType);
    if (newType === "custom") {
      setParticipants(prev => redistAuto(prev.map(p => ({ ...p, manual: false })), total));
    } else {
      setParticipants(prev => prev.map(p => ({ ...p, amount: "", manual: false })));
    }
  }

  function resetForm() {
    setTitle(""); setTotalAmount(""); setCategoryId("");
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setDifferentPaymentDate(false);
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setSplitType("equal");
    setParticipants([{
      type: "member",
      user_id: appUser?.id ?? null,
      member_name: appUser?.display_name || appUser?.email || "",
      amount: "",
      manual: false,
      invite_method: "none",
      invite_email: "",
      invite_phone_prefix: "54",
      invite_phone_local: "",
    }]);
    setFormError("");
  }

  async function saveCat() {
    if (!catName.trim()) return;
    setSavingCat(true);
    try {
      await api.post("/expenses/categories", { name: catName, color: catColor, is_fixed: false });
      setCatName(""); setCatColor("#6366f1");
      setShowCatForm(false);
      await loadCategories();
    } finally { setSavingCat(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (overBudget) {
      setFormError("La division supera el monto total"); return;
    }
    const splits = participants.map(p => ({
      user_id: p.type === "member" ? p.user_id : null,
      member_name: p.member_name,
      amount: splitType === "equal" ? parseFloat(equalShare) : parseAmt(p.amount),
      invite_contact: p.type === "external"
        ? (p.invite_method === "email" && p.invite_email.trim() ? p.invite_email.trim()
          : p.invite_method === "whatsapp" && p.invite_phone_local.trim() ? buildPhone(p.invite_phone_prefix, p.invite_phone_local)
          : undefined)
        : undefined,
    }));
    const sumAmts = splits.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sumAmts - total) > 0.02) {
      setFormError(`La suma (${formatARS(sumAmts)}) no coincide con el total (${formatARS(total)})`);
      return;
    }
    if (splits.some(s => !s.member_name.trim())) {
      setFormError("Todos los participantes deben tener nombre"); return;
    }
    setSaving(true);
    try {
      await api.post("/shared-expenses", {
        title, total_amount: total, category_id: parseInt(categoryId),
        split_type: splitType, expense_date: expenseDate,
        payment_date: differentPaymentDate ? paymentDate : expenseDate,
        splits,
      });
      resetForm(); setShowForm(false); await load();
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, "Error al crear el gasto compartido"));
    } finally { setSaving(false); }
  }

  async function handleAccept(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/accept`); await load();
  }
  async function handleReject(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/reject`); await load();
  }
  async function handleDelete(sharedId: number, isGrouped: boolean) {
    const msg = isGrouped
      ? "Se eliminará esta cuota y todas las cuotas futuras del plan. Las cuotas ya pasadas no se van a tocar. ¿Continuar?"
      : "Eliminar este gasto compartido? Se borraran todos los egresos parciales asociados.";
    if (!confirm(msg)) return;
    try {
      await api.delete(`/shared-expenses/${sharedId}`);
      await load();
    } catch (err) {
      alert(getErrorMessage(err, "No se pudo eliminar"));
    }
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  }

  const currentUserId = appUser?.id;

  // Distinct people I share expenses with (excluding myself), derived from
  // every split across every expense I can see — not just ones I created.
  const people = useMemo(() => {
    const map = new Map<string, { key: string; name: string }>();
    for (const exp of expenses) {
      for (const split of exp.splits) {
        if (split.user_id != null && split.user_id === currentUserId) continue;
        const key = personKey(split);
        if (!map.has(key)) map.set(key, { key, name: split.member_name });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [expenses, currentUserId]);

  const selectedPerson = people.find(p => p.key === selectedPersonKey) ?? null;

  const personPrev = () => { if (personMonth === 1) { setPersonMonth(12); setPersonYear(y => y - 1); } else setPersonMonth(m => m - 1); };
  const personNext = () => { if (personMonth === 12) { setPersonMonth(1); setPersonYear(y => y + 1); } else setPersonMonth(m => m + 1); };
  const personPeriodLabel = format(new Date(personYear, personMonth - 1, 1), "MMMM yyyy", { locale: es });

  // Expenses where the selected person participates, in the selected month —
  // bucketed by payment_date (when the money actually moves), not expense_date
  // (the accounting date, which can land in a different month — e.g. a bill
  // closed end-of-July but due August 10th). Each installment cuota is its
  // own record with its own dates, so no cuota-grouping is needed here
  // (unlike the "Todos" list below, which stays on expense_date).
  const personExpenses = useMemo(() => {
    if (!selectedPerson) return [];
    return expenses
      .filter(exp => {
        const d = new Date(exp.payment_date + "T12:00:00");
        return d.getFullYear() === personYear && d.getMonth() + 1 === personMonth
          && exp.splits.some(s => personKey(s) === selectedPerson.key);
      })
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  }, [expenses, selectedPerson, personYear, personMonth]);

  // Direction of debt per expense — derived from who created it (the creator fronts the
  // total, everyone else owes the creator their own split), never from mine/theirs amounts.
  // Expenses created by a third household member (neither me nor the selected person) don't
  // represent a direct debt between the two of us, so they're excluded from both buckets.
  const owedToMeExpenses = useMemo(
    () => personExpenses.filter(exp => exp.created_by_user_id === currentUserId),
    [personExpenses, currentUserId]
  );

  const iOweExpenses = useMemo(() => {
    if (!selectedPerson) return [];
    return personExpenses.filter(exp => {
      if (exp.created_by_user_id === currentUserId) return false;
      const theirSplit = exp.splits.find(s => personKey(s) === selectedPerson.key);
      return theirSplit?.user_id != null && exp.created_by_user_id === theirSplit.user_id;
    });
  }, [personExpenses, selectedPerson, currentUserId]);

  // Totals kept separate per currency — ARS and USD amounts can't be summed together.
  // A split converted to ARS counts toward the ARS bucket, not USD, regardless
  // of the expense's own currency.
  const personTotals = useMemo(() => {
    const owedToMe = { ARS: 0, USD: 0 };
    for (const exp of owedToMeExpenses) {
      const theirSplit = exp.splits.find(s => selectedPerson && personKey(s) === selectedPerson.key);
      if (!theirSplit) continue;
      const { amount, currency } = resolveDisplay(theirSplit, exp.currency);
      owedToMe[currency] += amount;
    }
    const iOwe = { ARS: 0, USD: 0 };
    for (const exp of iOweExpenses) {
      const mySplit = exp.splits.find(s => s.user_id === currentUserId);
      if (!mySplit) continue;
      const { amount, currency } = resolveDisplay(mySplit, exp.currency);
      iOwe[currency] += amount;
    }
    return { owedToMe, iOwe };
  }, [owedToMeExpenses, iOweExpenses, selectedPerson, currentUserId]);

  function shareByWhatsApp() {
    if (!selectedPerson) return;
    const lines = [`📊 Gastos compartidos con ${selectedPerson.name} — ${personPeriodLabel}`];

    if (owedToMeExpenses.length > 0) {
      lines.push("", "Te debe:");
      for (const exp of owedToMeExpenses) {
        const theirSplit = exp.splits.find(s => personKey(s) === selectedPerson.key);
        if (!theirSplit) continue;
        const { amount, currency } = resolveDisplay(theirSplit, exp.currency);
        lines.push(`• ${fmtDate(exp.payment_date)} - ${exp.title}: ${fmtByCurrency(amount, currency)}`);
      }
    }
    if (iOweExpenses.length > 0) {
      lines.push("", "Debo:");
      for (const exp of iOweExpenses) {
        const mySplit = exp.splits.find(s => s.user_id === currentUserId);
        if (!mySplit) continue;
        const { amount, currency } = resolveDisplay(mySplit, exp.currency);
        lines.push(`• ${fmtDate(exp.payment_date)} - ${exp.title}: ${fmtByCurrency(amount, currency)}`);
      }
    }

    lines.push("", "Balance:");
    for (const cur of ["ARS", "USD"] as const) {
      const owed = personTotals.owedToMe[cur];
      const owe = personTotals.iOwe[cur];
      if (owed === 0 && owe === 0) continue;
      const net = owed - owe;
      const fmt = cur === "USD" ? formatUSD : formatARS;
      lines.push(
        net === 0 ? `• Están a mano (${cur})`
          : net > 0 ? `• Te debe ${fmt(net)}`
          : `• Debo ${fmt(-net)}`
      );
    }

    window.open("https://wa.me/?text=" + encodeURIComponent(lines.join(String.fromCharCode(10))), "_blank");
  }

  // Shared table renderer for both direction tables below (Fecha/Descripción/Monto/delete) —
  // identical shape, differing only in which expenses, which split's amount, and the column label.
  function renderDirectionTable(
    exps: SharedExpense[],
    splitFor: (exp: SharedExpense) => Split | undefined,
    columnLabel: string,
    totals: { ARS: number; USD: number },
    emptyLabel: string
  ) {
    if (exps.length === 0) {
      return <Card className="p-4 text-center text-muted-foreground text-xs">{emptyLabel}</Card>;
    }
    return (
      <Card className="p-0 md:p-0 divide-y overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="w-[7ch] px-2 py-2.5 font-medium">Fecha</th>
                <th className="px-2 sm:px-4 py-2.5 font-medium">Descripción</th>
                <th className="w-[18ch] px-2 sm:px-4 py-2.5 font-medium text-right">{columnLabel}</th>
                <th className="w-9 px-1 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {exps.map(exp => {
                const split = splitFor(exp);
                if (!split) return null;
                const { amount, currency } = resolveDisplay(split, exp.currency);
                const isCreator = exp.created_by_user_id === currentUserId;
                const canConvert = isCreator && exp.currency === "USD";
                const isConverted = split.converted_ars_amount != null;
                return (
                  <tr key={exp.id}>
                    <td className="w-[7ch] px-2 py-2.5 whitespace-nowrap text-muted-foreground">{fmtDateShort(exp.payment_date)}</td>
                    <td className="px-2 sm:px-4 py-2.5 text-foreground truncate">{exp.title}</td>
                    <td className="w-[18ch] px-2 sm:px-4 py-2.5 text-right font-medium text-foreground whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {canConvert ? (
                          <button
                            onClick={() => setConverting({ expense: exp, splitIds: [split.id] })}
                            title={isConverted
                              ? `Convertido a ${RATE_TYPE_LABELS[split.converted_ars_rate_type ?? "blue"]} — tocar para cambiar`
                              : "Convertir a pesos"}
                            className={`p-0.5 transition-colors ${isConverted ? "text-primary" : "text-muted-foreground/50 hover:text-primary"}`}
                          >
                            <ArrowLeftRight className="w-3 h-3" />
                          </button>
                        ) : isConverted ? (
                          <span title={`Convertido a ${RATE_TYPE_LABELS[split.converted_ars_rate_type ?? "blue"]}`} className="text-primary">
                            <ArrowLeftRight className="w-3 h-3" />
                          </span>
                        ) : null}
                        {fmtByCurrency(amount, currency)}
                      </div>
                    </td>
                    <td className="w-9 px-1 py-2.5 text-right">
                      {isCreator && (
                        <button onClick={() => handleDelete(exp.id, false)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {totals.ARS > 0 && (
                <tr className="border-t bg-muted font-semibold">
                  <td className="px-2 sm:px-4 py-2.5 text-foreground" colSpan={2}>Total ARS</td>
                  <td className="w-[18ch] px-2 sm:px-4 py-2.5 text-right text-foreground whitespace-nowrap">{formatARS(totals.ARS)}</td>
                  <td className="w-9 px-1 py-2.5" />
                </tr>
              )}
              {totals.USD > 0 && (
                <tr className="border-t bg-muted font-semibold">
                  <td className="px-2 sm:px-4 py-2.5 text-foreground" colSpan={2}>Total USD</td>
                  <td className="w-[18ch] px-2 sm:px-4 py-2.5 text-right text-foreground whitespace-nowrap">{formatUSD(totals.USD)}</td>
                  <td className="w-9 px-1 py-2.5" />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-2xl font-display font-bold text-foreground">Gastos compartidos</h1>
        <Button onClick={() => { setShowForm(v => !v); resetForm(); }}>
          <Plus className="w-4 h-4" /> Nuevo gasto
        </Button>
      </div>

      {people.length > 0 && (
        <div className="flex items-start gap-3 overflow-x-auto pt-1.5 pb-1 -mx-4 px-4 md:mx-0 md:px-0">
          <button
            type="button"
            onClick={() => setSelectedPersonKey(null)}
            className="flex flex-col items-center gap-1 shrink-0 w-16"
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center bg-accent text-primary transition-all ${!selectedPerson ? "ring-2 ring-offset-2 ring-primary" : ""}`}>
              <Users className="w-5 h-5" />
            </div>
            <span className={`text-[11px] ${!selectedPerson ? "text-primary font-medium" : "text-muted-foreground"}`}>Todos</span>
          </button>
          {people.map(p => (
            <PersonAvatar key={p.key} name={p.name} active={selectedPersonKey === p.key} onClick={() => setSelectedPersonKey(p.key)} />
          ))}
        </div>
      )}

      {showForm && (
        <Card className="p-4 md:p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm font-medium text-foreground">Nuevo gasto compartido</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Descripción *</label>
              <input required value={title} onChange={e => setTitle(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="ej: Supermercado del fin de semana" />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Monto ($) *</label>
              <input
                required
                type="text"
                inputMode="decimal"
                value={totalAmount}
                onChange={e => setTotalAmount(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha *</label>
              <input required type="date" value={expenseDate}
                onChange={e => setExpenseDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
            </div>

            <div className="sm:col-span-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={differentPaymentDate}
                  onChange={e => { setDifferentPaymentDate(e.target.checked); if (e.target.checked) setPaymentDate(expenseDate); }}
                  className="rounded border-input" />
                La fecha de pago real es distinta a la fecha del gasto
              </label>
              {differentPaymentDate && (
                <div className="mt-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Fecha de pago *</label>
                  <input required type="date" value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Se usa para saber en qué mes aparece este gasto en la vista por persona — no afecta tus Egresos.
                  </p>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-muted-foreground">Categoría *</label>
                <button type="button" onClick={() => setShowCatForm(v => {
                  if (!v) setCatColor(pickCategoryColor(categories.map(c => c.color)));
                  return !v;
                })}
                  className="text-xs text-primary hover:underline">
                  + Crear
                </button>
              </div>
              {showCatForm && (
                <div className="mb-1 border rounded-lg p-2 bg-muted space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={catName}
                      onChange={e => setCatName(e.target.value)}
                      placeholder="Nombre categoría"
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                    />
                    <input type="color" value={catColor}
                      onChange={e => setCatColor(e.target.value)}
                      className="h-8 w-10 border rounded-lg cursor-pointer" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowCatForm(false)}
                      className="text-xs border px-2 py-1 rounded-lg hover:bg-card">Cancelar</button>
                    <button type="button" disabled={savingCat || !catName.trim()} onClick={saveCat}
                      className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded-lg disabled:opacity-60">
                      Guardar
                    </button>
                  </div>
                </div>
              )}
              <select required value={categoryId} onChange={e => setCategoryId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-card">
                <option value="">Seleccionar...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!showCatForm && categories.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No hay categorías. Usa <strong>+ Crear</strong> para agregar una.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Division *</label>
              <select value={splitType} onChange={e => handleSplitTypeChange(e.target.value as "equal" | "custom")}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card">
                <option value="equal">Equitativa</option>
                <option value="custom">Personalizada</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Participantes *</label>
              <button type="button" onClick={addParticipant}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Agregar
              </button>
            </div>

            <div className="space-y-2">
              {participants.map((p, idx) => {
                const isCreator = idx === 0;
                return (
                  <div key={idx} className="border rounded-lg p-2.5 bg-muted space-y-2">
                    <div className="flex items-center gap-2">
                      {isCreator ? (
                        <span className="border rounded-lg px-2 py-1.5 text-xs bg-card text-muted-foreground shrink-0">
                          Del hogar
                        </span>
                      ) : (
                        <select value={p.type}
                          onChange={e => {
                            const t = e.target.value as "member" | "external";
                            updateParticipant(idx, { type: t, user_id: null, member_name: "" });
                          }}
                          className="border rounded-lg px-2 py-1.5 text-xs bg-card shrink-0">
                          <option value="member">Del hogar</option>
                          <option value="external">Externo</option>
                        </select>
                      )}
                      {!isCreator && (
                        <button type="button" onClick={() => removeParticipant(idx)}
                          className="ml-auto text-muted-foreground hover:text-destructive px-1 text-base leading-none">
                          x
                        </button>
                      )}
                    </div>

                    {isCreator ? (
                      <p className="text-sm text-foreground px-1">
                        {p.member_name}
                      </p>
                    ) : p.type === "member" ? (
                      <select required value={p.user_id ?? ""}
                        onChange={e => {
                          const id = parseInt(e.target.value);
                          const mem = members.find(m => m.id === id);
                          updateParticipant(idx, { user_id: id, member_name: mem?.display_name || mem?.email || "" });
                        }}
                        className="w-full border rounded-lg px-2 py-2 text-sm bg-card">
                        <option value="">Seleccionar miembro...</option>
                        {members.filter(m => m.id !== appUser?.id).map(m => (
                          <option key={m.id} value={m.id}>{m.display_name || m.email}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="space-y-2">
                        {agendaContacts.length > 0 && (
                          <select
                            value=""
                            onChange={e => {
                              const c = agendaContacts.find(a => a.id === parseInt(e.target.value));
                              if (!c) return;
                              const { prefix, local, isValid } = normalizePhoneNumber(c.contact_phone, COUNTRIES.map(cc => cc.prefix));
                              if (!isValid) return;
                              updateParticipant(idx, {
                                member_name: c.contact_name,
                                invite_phone_prefix: prefix,
                                invite_phone_local: local,
                                invite_method: "whatsapp",
                              });
                            }}
                            className="w-full border rounded-lg px-2 py-1.5 text-xs bg-accent border-primary/20 text-primary"
                          >
                            <option value="">📇 Elegir de la agenda...</option>
                            {agendaContacts.map(c => (
                              <option key={c.id} value={c.id}>{c.contact_name} · {c.contact_phone}</option>
                            ))}
                          </select>
                        )}
                        <div className="flex gap-2">
                          <input required type="text" placeholder="Nombre del externo"
                            value={p.member_name} onChange={e => updateParticipant(idx, { member_name: e.target.value })}
                            className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                          <button type="button"
                            onClick={async () => {
                              const result = await pickContactAndNormalize(COUNTRIES.map(c => c.prefix));
                              if (result) {
                                updateParticipant(idx, {
                                  member_name: result.name,
                                  invite_phone_prefix: result.prefix,
                                  invite_phone_local: result.local,
                                  invite_method: "whatsapp",
                                });
                              } else if (!("contacts" in navigator) || !navigator.contacts) {
                                alert("Tu navegador no permite elegir contactos del dispositivo. Completá el nombre y teléfono manualmente, o elegí uno de la agenda si ya lo compartiste antes.");
                              }
                            }}
                            title="Seleccionar contacto del dispositivo"
                            className="px-3 py-2 text-sm border rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0"
                          >
                            <Smartphone className="w-4 h-4" />
                          </button>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">Enviar invitacion</p>
                          <div className="flex gap-1.5 flex-wrap">
                            <button type="button"
                              onClick={() => updateParticipant(idx, { invite_method: "none" })}
                              className={`px-2.5 py-1 text-xs rounded-full border-2 transition-colors ${p.invite_method === "none" ? "border-ink bg-muted text-foreground font-medium" : "border-transparent text-muted-foreground/60 hover:bg-accent"}`}>
                              Sin invitacion
                            </button>
                            <button type="button"
                              onClick={() => updateParticipant(idx, { invite_method: "email" })}
                              className={`px-2.5 py-1 text-xs rounded-full border-2 transition-colors ${p.invite_method === "email" ? "border-ink bg-accent text-primary font-medium" : "border-transparent text-muted-foreground/60 hover:bg-accent"}`}>
                              Email
                            </button>
                            <button type="button"
                              onClick={() => updateParticipant(idx, { invite_method: "whatsapp" })}
                              className={`px-2.5 py-1 text-xs rounded-full border-2 transition-colors flex items-center gap-1 ${p.invite_method === "whatsapp" ? "border-ink bg-emerald-100 text-emerald-700 font-medium" : "border-transparent text-muted-foreground/60 hover:bg-accent"}`}>
                              <MessageCircle className="w-3 h-3" /> WhatsApp
                            </button>
                          </div>
                        </div>

                        {p.invite_method === "email" && (
                          <div className="space-y-1">
                            <input type="email" placeholder="email@ejemplo.com"
                              value={p.invite_email}
                              onChange={e => updateParticipant(idx, { invite_email: e.target.value })}
                              className="w-full border rounded-lg px-3 py-2 text-sm" />
                            <p className="text-xs text-primary">Se generara un link para copiar y compartir manualmente</p>
                          </div>
                        )}

                        {p.invite_method === "whatsapp" && (
                          <div className="space-y-1">
                            <div className="flex gap-2">
                              <select
                                value={p.invite_phone_prefix}
                                onChange={e => updateParticipant(idx, { invite_phone_prefix: e.target.value, invite_phone_local: "" })}
                                className="border rounded-lg px-2 py-2 text-sm bg-card shrink-0">
                                {COUNTRIES.map(c => (
                                  <option key={c.prefix} value={c.prefix}>{c.flag} +{c.prefix}</option>
                                ))}
                              </select>
                              <input type="tel"
                                value={p.invite_phone_local}
                                onChange={e => updateParticipant(idx, { invite_phone_local: e.target.value.replace(/[^\d\s]/g, "") })}
                                placeholder={COUNTRIES.find(c => c.prefix === p.invite_phone_prefix)?.placeholder ?? ""}
                                inputMode="numeric"
                                className="flex-1 border rounded-lg px-3 py-2 text-sm min-w-0" />
                            </div>
                            {p.invite_phone_local.trim() && (
                              <p className="text-xs text-muted-foreground/70">
                                Número a enviar: +{buildPhone(p.invite_phone_prefix, p.invite_phone_local)}
                              </p>
                            )}
                            <p className="text-xs text-emerald-700">Se enviara una invitacion automaticamente por WhatsApp al crear el gasto</p>
                          </div>
                        )}
                      </div>
                    )}

                    {splitType === "custom" ? (
                      <div>
                        <label className="text-xs text-muted-foreground">Monto ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={p.amount}
                          onChange={e => setManualAmount(idx, e.target.value)}
                          className={`mt-0.5 w-full border rounded-lg px-3 py-2 text-sm ${!p.manual ? "text-muted-foreground italic" : ""}`}
                        />
                        {!p.manual && parseAmt(p.amount) > 0 && (
                          <p className="text-xs text-primary mt-0.5">sugerencia</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs text-muted-foreground">Monto</span>
                        <span className="text-sm font-medium text-foreground">
                          {total > 0 ? formatARS(parseFloat(equalShare)) : "-"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {splitType === "equal" && total > 0 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {formatARS(total)} / {participants.length} = {formatARS(parseFloat(equalShare))} por persona
              </p>
            )}

            {splitType === "custom" && total > 0 && (
              <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${overBudget ? "bg-destructive/10 text-destructive font-medium" : "bg-accent text-primary"}`}>
                {overBudget
                  ? `La division supera el total: asignaste ${formatARS(manualSum)} de ${formatARS(total)}`
                  : `Distribuido: ${formatARS(assignedSum)} | Restante: ${formatARS(total - assignedSum)}`
                }
              </div>
            )}
          </div>

          {formError && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{formError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving || overBudget}>
              {saving ? "Generando..." : "Generar gasto"}
            </Button>
          </div>
          </form>
        </Card>
      )}

      {selectedPerson ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card shadow-chip pl-3 pr-1.5 py-1.5">
              <CalendarDays className="w-4 h-4 text-primary shrink-0" />
              <button onClick={personPrev} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-bold text-foreground capitalize px-0.5 min-w-[100px] text-center">{personPeriodLabel}</span>
              <button onClick={personNext} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {personExpenses.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground text-sm">
              No hay gastos compartidos con {selectedPerson.name} en {personPeriodLabel}.
            </Card>
          ) : (
            <>
              <Card className="p-3 md:p-4 flex items-start justify-between gap-4">
                <span className="text-sm font-semibold text-foreground shrink-0">Balance</span>
                <div className="flex flex-col items-end gap-0.5">
                  {(["ARS", "USD"] as const).map(cur => {
                    const owed = personTotals.owedToMe[cur];
                    const owe = personTotals.iOwe[cur];
                    if (owed === 0 && owe === 0) return null;
                    const net = owed - owe;
                    const fmt = cur === "USD" ? formatUSD : formatARS;
                    return (
                      <span key={cur} className={`text-sm font-medium flex items-center gap-1 ${net > 0 ? "text-emerald-600" : net < 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                        {net > 0 && <ArrowDownLeft className="w-3.5 h-3.5" />}
                        {net < 0 && <ArrowUpRight className="w-3.5 h-3.5" />}
                        {net === 0 ? `Están a mano (${cur})` : net > 0 ? `Te debe ${fmt(net)}` : `Debo ${fmt(-net)}`}
                      </span>
                    );
                  })}
                </div>
              </Card>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Te debe</p>
                {renderDirectionTable(
                  owedToMeExpenses,
                  exp => exp.splits.find(s => personKey(s) === selectedPerson.key),
                  selectedPerson.name.split(/\s+/)[0],
                  personTotals.owedToMe,
                  `${selectedPerson.name} no te debe nada en ${personPeriodLabel}.`
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Vos debés</p>
                {renderDirectionTable(
                  iOweExpenses,
                  exp => exp.splits.find(s => s.user_id === currentUserId),
                  "Vos",
                  personTotals.iOwe,
                  `No le debés nada a ${selectedPerson.name} en ${personPeriodLabel}.`
                )}
              </div>
            </>
          )}

          {personExpenses.length > 0 && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={shareByWhatsApp} className="text-emerald-700">
                <Share2 className="w-4 h-4" /> Compartir por WhatsApp
              </Button>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <Card key={i} className="h-28 animate-pulse" />)}
        </div>
      ) : expenses.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No hay gastos compartidos registrados.
        </Card>
      ) : (
        <div className="space-y-3">
          {(() => {
            const groupsMap = new Map<number, SharedExpense[]>();
            for (const exp of expenses) {
              const rootId = exp.installment_group_id ?? exp.id;
              if (!groupsMap.has(rootId)) groupsMap.set(rootId, []);
              groupsMap.get(rootId)!.push(exp);
            }
            const displayGroups = Array.from(groupsMap.entries())
              .map(([rootId, members]) => ({
                root: members.find(m => m.id === rootId) ?? members[0],
                cuotas: [...members].sort((a, b) => a.expense_date.localeCompare(b.expense_date)),
              }))
              .sort((a, b) => b.root.expense_date.localeCompare(a.root.expense_date));

            return displayGroups.map(({ root: exp, cuotas }) => {
              const isGrouped = cuotas.length > 1;
              const groupTotal = cuotas.reduce((s, c) => s + Number(c.total_amount), 0);
              const myMemberSplit = exp.splits.find(s => s.user_id === currentUserId);
              const pendingCount = exp.splits.filter(s => s.user_id !== null && s.status === "pending" && !s.invite_token).length;
              const isCreator = exp.created_by_user_id === currentUserId;
              // "Convertir todo" (header) only makes sense whole-expense — a cuota
              // group is always ARS (USD only allowed for single-item purchases).
              const canConvertAll = isCreator && exp.currency === "USD" && !isGrouped;
              const allConverted = exp.splits.every(s => s.converted_ars_amount != null);
              const headerAmount = allConverted
                ? exp.splits.reduce((s, sp) => s + Number(sp.converted_ars_amount), 0)
                : groupTotal;
              const headerCurrency: "ARS" | "USD" = allConverted ? "ARS" : exp.currency;
              return (
                <Card key={exp.id} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate flex items-center gap-1.5">
                        {exp.title}
                        {isGrouped && (
                          <Chip tone="violet" className="shrink-0">
                            <Layers className="w-3 h-3" /> {cuotas.length} cuotas
                          </Chip>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isGrouped
                          ? `${fmtDate(cuotas[0].expense_date)} — ${fmtDate(cuotas[cuotas.length - 1].expense_date)}`
                          : fmtDate(exp.expense_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-lg font-bold text-foreground">{fmtByCurrency(headerAmount, headerCurrency)}</p>
                      {canConvertAll && (
                        <button
                          onClick={() => setConverting({ expense: exp, splitIds: exp.splits.map(s => s.id) })}
                          title={allConverted ? "Convertido a pesos — tocar para cambiar" : "Convertir todo a pesos"}
                          className={`p-1.5 transition-colors ${allConverted ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                        >
                          <ArrowLeftRight className="w-4 h-4" />
                        </button>
                      )}
                      {isCreator && !exp.credit_card_item_id && (
                        <button onClick={() => setEditingExpense(exp)}
                          className="p-1.5 text-muted-foreground hover:text-primary transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {isCreator && (
                        <button onClick={() => handleDelete(exp.id, isGrouped)}
                          className="p-1.5 text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isGrouped && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-primary hover:opacity-80 select-none">
                        Ver detalle de las {cuotas.length} cuotas
                      </summary>
                      <div className="mt-1.5 space-y-1 border-l-2 border-primary/20 pl-2.5">
                        {cuotas.map((c, i) => (
                          <div key={c.id} className="flex items-center justify-between text-muted-foreground">
                            <span>Cuota {i + 1}/{cuotas.length} &middot; {fmtDate(c.expense_date)}</span>
                            <span className="font-medium text-muted-foreground">{fmtByCurrency(c.total_amount, c.currency)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div className="border-t border-gray-200" />

                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 text-sm">
                    {exp.splits.map(split => {
                      const { amount: splitAmount, currency: splitCurrency } = resolveDisplay(split, exp.currency);
                      return (
                      <Fragment key={split.id}>
                        <span className="text-foreground truncate">{split.member_name}</span>
                        <span className="text-muted-foreground text-right whitespace-nowrap">
                          {split.converted_ars_amount != null && <ArrowLeftRight className="w-3 h-3 inline mr-0.5 text-primary" />}
                          {fmtByCurrency(splitAmount, splitCurrency)}{isGrouped && <span className="text-muted-foreground/60"> /cuota</span>}
                        </span>
                        <span className="flex items-center gap-1 justify-self-end">
                          <StatusChip
                            status={split.user_id === null && !split.invite_token ? "accepted" : split.status}
                            hasToken={!!split.invite_token}
                          />
                          {split.invite_token && isCreator && (
                            <button
                              onClick={() => copyInviteLink(split.invite_token!)}
                              title="Copiar link de invitacion"
                              className={`p-1 rounded transition-colors ${copiedToken === split.invite_token ? "text-emerald-600" : "text-muted-foreground hover:text-primary"}`}
                            >
                              {copiedToken === split.invite_token
                                ? <CheckCircle className="w-4 h-4" />
                                : <Copy className="w-4 h-4" />
                              }
                            </button>
                          )}
                        </span>
                      </Fragment>
                      );
                    })}
                  </div>

                  {myMemberSplit?.status === "pending" && !myMemberSplit?.invite_token && (
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <p className="text-sm text-muted-foreground flex-1">
                        Te corresponden <strong>{fmtByCurrency(resolveDisplay(myMemberSplit, exp.currency).amount, resolveDisplay(myMemberSplit, exp.currency).currency)}</strong>{isGrouped && ` por cuota (${cuotas.length} cuotas)`}
                      </p>
                      <button onClick={() => handleAccept(exp.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-full border-2 border-ink shadow-chip hover:opacity-90">
                        <CheckCircle className="w-3.5 h-3.5" /> {isGrouped ? "Aceptar todas" : "Aceptar"}
                      </button>
                      <button onClick={() => handleReject(exp.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border text-muted-foreground rounded-full hover:bg-accent">
                        <XCircle className="w-3.5 h-3.5" /> Rechazar
                      </button>
                    </div>
                  )}
                  {pendingCount > 0 && isCreator && (
                    <p className="text-xs text-muted-foreground pt-1 border-t">
                      {pendingCount} participante{pendingCount > 1 ? "s" : ""} aun no acepto
                    </p>
                  )}
                </Card>
              );
            });
          })()}
        </div>
      )}

      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          categories={categories}
          onClose={() => setEditingExpense(null)}
          onSaved={() => { setEditingExpense(null); load(); }}
        />
      )}

      {converting && (
        <ConvertToArsModal
          expense={converting.expense}
          splitIds={converting.splitIds}
          onClose={() => setConverting(null)}
          onSaved={() => { setConverting(null); load(); }}
        />
      )}
    </div>
  );
}

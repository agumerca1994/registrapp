"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeftRight, Check, Copy, Share2, UserPlus, X } from "lucide-react";
import type { Step } from "react-joyride";

import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD, getErrorMessage, parseAmount, pickCategoryColor } from "@/lib/utils";
import { equalSplit, fromCents, remainder, sumMatches, toCents } from "@/lib/split";
import { useAuth } from "@/contexts/AuthContext";
import { ParticipantPicker, type PickedParticipant } from "@/components/ParticipantPicker";
import NewCategoryModal from "@/components/NewCategoryModal";
import ProductTour from "@/components/ProductTour";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { MonthPill } from "@/components/dashboard/MonthPill";
import { EntrySheet, SheetActions, SheetLink, SheetRow } from "@/components/movimientos/EntrySheet";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { LedgerRow, LedgerTotal, ledgerAmount } from "@/components/movimientos/Ledger";
import { usePendingShared } from "@/contexts/PendingSharedContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { DateField, FIELD, FormGrid, SegmentedToggle, SelectField } from "@/components/ui/form";
import { Fab } from "@/components/ui/fab";
import { ScrollRow } from "@/components/ui/scroll-row";
import { useNuevo } from "@/lib/nuevo";

// Un componente y no el hook suelto: esta pantalla tiene varios `return` antes del
// principal, y un hook no puede ir después de ellos.
function NuevoListener({ onNuevo }: { onNuevo: () => void }) {
  useNuevo(onNuevo, "nuevo");
  return null;
}

// Muestra lo que hay en la pantalla, en el orden en que se mira. Lo pendiente y
// las personas sólo si están: una pantalla vacía no lleva guía.
const tourSteps = (hasPending: boolean, hasPeople: boolean, hasList: boolean): Step[] => [
  ...(hasPending ? [{
    target: "[data-tour='shared-pending']",
    title: "Lo que espera tu respuesta",
    content: "Aceptá o rechazá lo que te compartieron. Si aceptás, tu parte se suma a tus Egresos.",
  }] : []),
  ...(hasPeople ? [{
    target: "[data-tour='shared-people']",
    title: "Por persona",
    content: "Elegí a alguien para ver quién le debe a quién en cada mes y mandarle el detalle por WhatsApp.",
  }] : []),
  ...(hasList ? [{
    target: "[data-tour='shared-list']",
    title: "Cada gasto",
    content: "Tocá uno para ver cuánto pone cada persona y si ya aceptó. Si invitaste a alguien, ahí copiás el link.",
  }] : []),
  {
    // En el celular es el + de la barra; en la compu, el botón flotante.
    target: "[data-tour='nav-add'], [data-tour='shared-add']",
    title: "Compartí un gasto",
    content: "Cargá cuánto salió y elegí con quién: en partes iguales o lo que ponga cada uno.",
  },
];

function buildPhone(prefix: string, local: string): string {
  const digits = local.replace(/\D/g, "");
  return prefix === "54" ? prefix + "9" + digits : prefix + digits;
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
  // Set by the backend per viewer: this split is the requesting user's, whether
  // it's linked to their account or still an invite addressed to their
  // email/phone. Not a column — the same split is "mine" for one viewer only.
  mine: boolean;
  converted_ars_amount: number | null;
  converted_ars_rate: number | null;
  converted_ars_rate_type: RateType | null;
}

const RATE_TYPES = ["blue", "oficial", "mayorista", "mep", "ccl", "personalizado"] as const;
type RateType = (typeof RATE_TYPES)[number];
const RATE_TYPE_LABELS: Record<RateType, string> = {
  blue: "Blue", oficial: "Oficial", mayorista: "Mayorista", mep: "MEP", ccl: "CCL", personalizado: "Personalizado",
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

/** Un gasto suelto, o las cuotas de un plan: cada cuota es su propio registro. */
interface Group {
  root: SharedExpense;
  cuotas: SharedExpense[];
}

interface Category {
  id: number;
  name: string;
  color: string | null;
}

/** Qué se muestra debajo del nombre de un participante ya elegido. */
function participantHint(p: ParticipantRow): string {
  if (p.user_id) return "Usuario de tood";
  if (p.invite_email) return `Se le invita a ${p.invite_email}`;
  // El `+` se antepone acá y no se guarda en el campo: `buildPhone` compone
  // sobre dígitos, y meterle el símbolo lo rompería.
  if (p.invite_phone_local) {
    const num = `${p.invite_phone_prefix}${p.invite_phone_local}`;
    return `Se le invita al +${num.replace(/^\+/, "")}`;
  }
  if (p.member_name) return "Sin cuenta, sólo para anotar tu parte";
  return "";
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

const EMPTY_ROW: ParticipantRow = {
  type: "member", user_id: null, member_name: "", amount: "", manual: false,
  invite_method: "none", invite_email: "", invite_phone_prefix: "54", invite_phone_local: "",
};

function fmtDate(d: string) {
  try { return format(new Date(d + "T12:00:00"), "d MMM yyyy", { locale: es }).replace(".", ""); }
  catch { return d; }
}

function fmtByCurrency(amount: number | string, currency: string) {
  return currency === "USD" ? formatUSD(amount) : formatARS(amount);
}

// Un monto en un campo se ve como se escribe acá: "4.069.000,00". El backend manda "4069000.00".
const amountText = (n: number | string) =>
  Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// La fecha del teléfono, no la de `toISOString()`: a las 21 de Buenos Aires esa ya es mañana.
const today = () => format(new Date(), "yyyy-MM-dd");

const firstName = (name: string) => name.trim().split(/\s+/)[0];

/**
 * Reparte lo que queda del total entre las filas que el usuario no fijó a mano.
 *
 * Pasa por `equalSplit` (centavos, resto a la última fila) y no por
 * `remaining / autoCount`, que es lo que hacía antes: con tres personas y
 * $100, ese cálculo escribía 33,33 en las tres y la suma daba 99,99, o sea un
 * formulario que se veía bien y el backend rechazaba.
 */
function redistAuto(parts: ParticipantRow[], total: number): ParticipantRow[] {
  const manualCents = parts
    .filter(p => p.manual)
    .reduce((s, p) => s + toCents(parseAmount(p.amount)), 0);
  const remaining = fromCents(Math.max(0, toCents(total) - manualCents));
  const autoIdx = parts.flatMap((p, i) => (p.manual ? [] : [i]));
  if (autoIdx.length === 0) return parts;
  const shares = equalSplit(remaining, autoIdx.length);
  const byIdx = new Map(autoIdx.map((i, k) => [i, shares[k]]));
  return parts.map((p, i) => {
    const share = byIdx.get(i);
    return share === undefined ? p : { ...p, amount: amountText(share) };
  });
}

// Stable identity for a split's participant across expenses: registered
// members dedupe by user_id, external guests dedupe by name (no other
// stable id available for them).
function personKey(split: Split): string {
  return split.user_id != null ? `u:${split.user_id}` : `n:${split.member_name.trim().toLowerCase()}`;
}

/** En qué está esta parte, dicho en una frase. `waiting` es lo que espera algo: va en lila. */
function splitStatus(split: Split, exp: SharedExpense): { text: string; waiting: boolean } {
  const isCreatorSplit = split.user_id != null && split.user_id === exp.created_by_user_id;
  if (split.status === "rejected") return { text: split.mine ? "Lo rechazaste" : "Lo rechazó", waiting: false };
  if (split.mine) {
    if (split.status === "pending") return { text: "Falta que aceptes", waiting: true };
    return { text: isCreatorSplit ? "Lo cargaste" : "Aceptaste", waiting: false };
  }
  if (isCreatorSplit) return { text: "Lo cargó", waiting: false };
  if (split.status === "accepted") {
    // Un externo sin cuenta nace aceptado: no hay nada que esperar de él.
    return { text: split.user_id === null ? "Sin cuenta, sólo anotado" : "Aceptó", waiting: false };
  }
  if (split.invite_token) return { text: "Invitación sin aceptar", waiting: true };
  return { text: split.user_id === null ? "Sin cuenta, sólo anotado" : "Falta que acepte", waiting: split.user_id !== null };
}

/** La línea de abajo de una fila: con quién, y lo único que todavía importa de su estado. */
function rowSub(exp: SharedExpense, cuotas: number, currentUserId: number | undefined): string {
  const others = exp.splits.filter(s => !s.mine);
  const parts: string[] = [];
  if (exp.created_by_user_id === currentUserId) {
    const names = others.slice(0, 2).map(s => firstName(s.member_name));
    const extra = others.length - names.length;
    parts.push(`Con ${names.join(" y ")}${extra > 0 ? ` y ${extra} más` : ""}`);
    const waiting = others.filter(s => splitStatus(s, exp).waiting).length;
    if (waiting === 1) parts.push("falta 1 respuesta");
    if (waiting > 1) parts.push(`faltan ${waiting} respuestas`);
    const rejected = others.filter(s => s.status === "rejected");
    if (rejected.length === 1) parts.push(`${firstName(rejected[0].member_name)} lo rechazó`);
    if (rejected.length > 1) parts.push(`${rejected.length} lo rechazaron`);
  } else {
    const creator = exp.splits.find(s => s.user_id === exp.created_by_user_id);
    if (creator) parts.push(`De ${firstName(creator.member_name)}`);
    if (exp.splits.find(s => s.mine)?.status === "rejected") parts.push("lo rechazaste");
  }
  if (cuotas > 1) parts.push(`${cuotas} cuotas`);
  return parts.join(" · ");
}

function SplitBalance({ left, money }: { left: number; money: (n: number) => string }) {
  return (
    <p className={`text-sm ${left === 0 ? "text-muted-foreground" : left > 0 ? "text-[#3B2FB3]" : "text-destructive"}`}>
      {left === 0 ? "La división suma justo." : left > 0 ? `Falta repartir ${money(left)}.` : `Te pasaste por ${money(-left)}.`}
    </p>
  );
}

const FORM_BLOCK = "rounded-[22px] bg-white/70 border border-white/80 px-3.5 py-3";
const FORM_ERROR = "text-sm text-destructive bg-destructive/10 rounded-2xl px-3.5 py-2.5";
const FIELD_LABEL = "text-xs font-medium text-muted-foreground";

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
  const [totalAmount, setTotalAmount] = useState(amountText(expense.total_amount));
  const [categoryId, setCategoryId] = useState(String(expense.category_id));
  const [expenseDate, setExpenseDate] = useState(expense.expense_date);
  const [paymentDate, setPaymentDate] = useState(expense.payment_date);
  const [splitAmounts, setSplitAmounts] = useState<Record<number, string>>(
    () => Object.fromEntries(expense.splits.map(s => [s.id, amountText(s.amount)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total = parseAmount(totalAmount);
  // En el orden de `expense.splits`, que es el que se manda en el PATCH.
  const splitValues = expense.splits.map(sp => parseAmount(splitAmounts[sp.id] ?? ""));
  const money = (n: number) => fmtByCurrency(n, expense.currency);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body: Record<string, unknown> = {
      title,
      expense_date: expenseDate,
      payment_date: paymentDate,
    };
    if (unlocked) {
      // Misma tolerancia que el backend (±0,01, o sea exacto en centavos): el
      // ±0,02 de antes dejaba salir divisiones que el PATCH rechazaba.
      if (!sumMatches(total, splitValues)) {
        const left = remainder(total, splitValues);
        setError(left > 0
          ? `Faltan ${money(left)} por asignar`
          : `Sobran ${money(-left)}: la división supera el total`);
        return;
      }
      body.total_amount = total;
      body.category_id = parseInt(categoryId);
      body.splits = expense.splits.map((sp, i) => ({ split_id: sp.id, amount: splitValues[i] }));
    }
    setSaving(true);
    try {
      await api.patch(`/shared-expenses/${expense.id}`, body);
      onSaved();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "No se pudieron guardar los cambios"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSheet title="Editar gasto" onClose={onClose}>
      <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          {unlocked ? (
            <AmountField label="Monto total" currency={expense.currency} required
              value={totalAmount} onChange={e => setTotalAmount(e.target.value)} />
          ) : (
            <p className="rounded-2xl bg-accent border border-[#CFC9E4] px-3.5 py-2.5 text-sm text-foreground">
              Ya lo aceptó otro participante: sólo se pueden corregir el título y las fechas.
            </p>
          )}

          <div>
            <label className={FIELD_LABEL}>Descripción</label>
            <input required aria-label="Descripción" value={title} onChange={e => setTitle(e.target.value)} className={FIELD} />
          </div>

          <FormGrid>
            <div>
              <label className={FIELD_LABEL}>Fecha del gasto</label>
              <DateField required value={expenseDate} onChange={setExpenseDate} />
            </div>
            <div>
              <label className={FIELD_LABEL}>Fecha de pago</label>
              <DateField required value={paymentDate} onChange={setPaymentDate} />
            </div>
          </FormGrid>

          {unlocked ? (
            <>
              <div>
                <label className={FIELD_LABEL}>Categoría</label>
                <SelectField required value={categoryId} onChange={setCategoryId}
                  options={categories.map(c => ({ value: String(c.id), label: c.name }))} />
              </div>

              <div className={`${FORM_BLOCK} space-y-2`}>
                <p className="text-sm font-medium text-foreground">Cuánto pone cada uno</p>
                {expense.splits.map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 text-[15px] text-foreground truncate">{s.mine ? "Vos" : s.member_name}</span>
                    {/* `FIELD` trae `w-full`: el ancho lo pone el envoltorio. */}
                    <span className="w-32 shrink-0">
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*"
                        aria-label={`Parte de ${s.member_name}`}
                        value={splitAmounts[s.id] ?? ""}
                        onChange={e => setSplitAmounts(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className={`${FIELD} mt-0 text-right tabular-nums`} />
                    </span>
                  </div>
                ))}
                <SplitBalance left={remainder(total, splitValues)} money={money} />
              </div>
            </>
          ) : (
            <div className={`${FORM_BLOCK} divide-y divide-ink/[0.08] !py-0`}>
              <SheetRow label="Monto" strong><span className="tabular-nums">{money(expense.total_amount)}</span></SheetRow>
              {expense.splits.map(s => (
                <SheetRow key={s.id} label={s.mine ? "Vos" : s.member_name}>
                  <span className="tabular-nums">{money(s.amount)}</span>
                </SheetRow>
              ))}
            </div>
          )}

          {error && <p className={FORM_ERROR} role="alert">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
      </form>
    </FormSheet>
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
    targetSplits[0]?.converted_ars_rate != null ? amountText(targetSplits[0].converted_ars_rate) : ""
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
          setRate(prev => prev || (map[rateType] != null ? amountText(map[rateType]!) : prev));
        }
      } catch { /* sin cotización sugerida, se completa a mano */ }
      finally { setLoadingRate(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRateTypeChange(t: RateType) {
    setRateType(t);
    if (t !== "personalizado" && suggested?.[t] != null) setRate(amountText(suggested[t]!));
  }

  // Editing the rate by hand no longer matches whichever published quote was
  // selected, so it stops being "Blue"/"Oficial"/etc. and becomes a custom one.
  function handleRateInputChange(value: string) {
    setRate(value);
    setRateType("personalizado");
  }

  const rateNum = parseAmount(rate);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (rateNum <= 0) { setError("Ingresá una cotización válida"); return; }
    setSaving(true);
    try {
      await api.post(`/shared-expenses/${expense.id}/convert-to-ars`, {
        split_ids: splitIds, rate: rateNum, rate_type: rateType,
      });
      onSaved();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "No se pudo convertir a pesos"));
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
      setError(getErrorMessage(err, "No se pudo volver a dólares"));
    } finally { setSaving(false); }
  }

  return (
    <FormSheet title="Convertir a pesos" onClose={onClose}>
      <form onSubmit={handleConfirm} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <div>
              <label className={FIELD_LABEL}>Cotización</label>
              <SelectField value={rateType} onChange={v => handleRateTypeChange(v as RateType)}
                options={RATE_TYPES.map(t => ({ value: t, label: RATE_TYPE_LABELS[t] }))} />
            </div>
            <div>
              <label className={FIELD_LABEL}>Valor del dólar</label>
              <input required type="text" inputMode="decimal" pattern="[0-9.,]*" aria-label="Valor del dólar"
                value={rate} onChange={e => handleRateInputChange(e.target.value)}
                placeholder={loadingRate ? "Cargando..." : "0,00"}
                className={`${FIELD} tabular-nums`} />
            </div>
          </div>

          <div className={`${FORM_BLOCK} !py-0 divide-y divide-ink/[0.08]`}>
            {targetSplits.map(s => (
              <SheetRow key={s.id} label={s.mine ? "Vos" : s.member_name}>
                <span className="tabular-nums">
                  {formatUSD(s.amount)}
                  <span className="block text-sm font-normal text-muted-foreground">
                    {rateNum > 0 ? formatARS(Number(s.amount) * rateNum) : "Falta la cotización"}
                  </span>
                </span>
              </SheetRow>
            ))}
          </div>

          {alreadyConverted && (
            <button type="button" onClick={handleRevert} disabled={saving}
              className="min-h-[44px] px-1.5 text-sm font-semibold text-foreground underline underline-offset-2 disabled:opacity-50">
              Volver a dólares
            </button>
          )}

          {error && <p className={FORM_ERROR} role="alert">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} disabled={rateNum <= 0} label="Convertir" />
      </form>
    </FormSheet>
  );
}

function NewSharedForm({ categories, reloadCategories, onClose, onSaved }: {
  categories: Category[];
  reloadCategories: () => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { appUser } = useAuth();
  // Índice de la fila que está eligiendo participante, "new" para sumar una, o null.
  const [pickerFor, setPickerFor] = useState<number | "new" | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);

  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [differentPaymentDate, setDifferentPaymentDate] = useState(false);
  const [paymentDate, setPaymentDate] = useState(today);
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  // La primera fila es quien carga: appUser siempre está, el layout no deja llegar sin él.
  const [participants, setParticipants] = useState<ParticipantRow[]>([{
    ...EMPTY_ROW, user_id: appUser?.id ?? null, member_name: appUser?.display_name || appUser?.email || "",
  }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const total = parseAmount(totalAmount);

  // Redistribuir automaticos cuando cambia el monto total
  useEffect(() => {
    if (splitType === "custom" && total > 0) {
      setParticipants(prev => redistAuto(prev, total));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount, splitType]);

  // Una parte por fila, no un solo número repetido: `equalSplit` le deja el
  // resto de centavos a la última, que es lo que hace que la suma dé el total.
  const equalShares = total > 0 ? equalSplit(total, participants.length) : [];

  const manualSum = splitType === "custom"
    ? participants.filter(p => p.manual).reduce((s, p) => s + parseAmount(p.amount), 0)
    : 0;
  const overBudget = splitType === "custom" && total > 0 && toCents(manualSum) > toCents(total);

  function setManualAmount(idx: number, value: string) {
    setParticipants(prev => {
      const updated = prev.map((p, i) =>
        i === idx ? { ...p, amount: value, manual: true } : p
      );
      return redistAuto(updated, total);
    });
  }

  // Traduce lo que devuelve el selector a la fila que este formulario maneja.
  // El selector no sabe de montos ni de redistribución: eso es de acá.
  function rowFromPick(picked: PickedParticipant): Partial<ParticipantRow> {
    const base = {
      user_id: null as number | null, member_name: "", invite_method: "none" as const,
      invite_email: "", invite_phone_prefix: "54", invite_phone_local: "",
    };
    if (picked.kind === "member" || picked.kind === "user") {
      return { ...base, type: "member", user_id: picked.user_id, member_name: picked.member_name };
    }
    if (picked.kind === "invite") {
      const isMail = picked.contact.includes("@");
      return {
        ...base, type: "external", member_name: picked.member_name,
        invite_method: isMail ? "email" : "whatsapp",
        invite_email: isMail ? picked.contact : "",
        // El selector ya entrega el contacto completo, con prefijo incluido, así
        // que acá NO se vuelve a componer: se guardan los dígitos enteros y el
        // prefijo queda vacío, que en `buildPhone` es un no-op. El backend lo
        // normaliza igual (`normalize_phone` reconoce "549…" sin el +).
        // Anteponerle otro prefijo duplicaría el código de país.
        invite_phone_local: isMail ? "" : picked.contact.replace(/\D/g, ""),
        invite_phone_prefix: "",
      };
    }
    return { ...base, type: "external", member_name: picked.member_name };
  }

  function applyPick(picked: PickedParticipant) {
    const patch = rowFromPick(picked);
    setParticipants(prev => {
      const updated = pickerFor === "new"
        ? [...prev, { ...EMPTY_ROW, ...patch }]
        : prev.map((p, i) => (i === pickerFor ? { ...p, ...patch } : p));
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

  async function saveCat(cat: { name: string; color: string; is_fixed: boolean }) {
    const res = await api.post("/expenses/categories", cat);
    await reloadCategories();
    setCategoryId(String(res.data.id));
    setShowCatForm(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (overBudget) {
      setFormError("La división supera el monto total"); return;
    }
    const splits = participants.map((p, idx) => ({
      user_id: p.type === "member" ? p.user_id : null,
      member_name: p.member_name,
      amount: splitType === "equal" ? (equalShares[idx] ?? 0) : parseAmount(p.amount),
      invite_contact: p.type === "external"
        ? (p.invite_method === "email" && p.invite_email.trim() ? p.invite_email.trim()
          : p.invite_method === "whatsapp" && p.invite_phone_local.trim() ? buildPhone(p.invite_phone_prefix, p.invite_phone_local)
          : undefined)
        : undefined,
    }));
    // Exacto, no ±0,02: el backend rebota cualquier división que no cierre
    // dentro de ±0,01, así que la tolerancia vieja sólo cambiaba un error claro
    // acá por un 422 del servidor.
    const amounts = splits.map(x => x.amount);
    if (!sumMatches(total, amounts)) {
      const left = remainder(total, amounts);
      setFormError(left > 0
        ? `Faltan ${formatARS(left)} por asignar`
        : `Sobran ${formatARS(-left)}: la división supera el total`);
      return;
    }
    if (splits.some(s => !s.member_name.trim())) {
      setFormError("Hay un participante sin elegir"); return;
    }
    setSaving(true);
    try {
      await api.post("/shared-expenses", {
        title, total_amount: total, category_id: parseInt(categoryId),
        split_type: splitType, expense_date: expenseDate,
        payment_date: differentPaymentDate ? paymentDate : expenseDate,
        splits,
      });
      onSaved();
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, "No se pudo crear el gasto compartido"));
    } finally { setSaving(false); }
  }

  const customAmounts = participants.map(p => parseAmount(p.amount));

  return (
    <>
      <FormSheet title="Nuevo gasto compartido" onClose={onClose}>
        <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
          <div className={FORM_SHEET_BODY}>
            <AmountField label="Monto" currency="ARS" required
              value={totalAmount} onChange={e => setTotalAmount(e.target.value)} />

            <div>
              <label className={FIELD_LABEL}>Descripción</label>
              <input required aria-label="Descripción" value={title} onChange={e => setTitle(e.target.value)}
                className={FIELD} placeholder="ej: Supermercado del fin de semana" />
            </div>

            <FormGrid>
              <div>
                <label className={FIELD_LABEL}>Categoría</label>
                <div className="flex gap-1.5">
                  <SelectField className="flex-1" required value={categoryId} onChange={setCategoryId}
                    placeholder="Categoría"
                    options={categories.map(c => ({ value: String(c.id), label: c.name }))} />
                  <button type="button" title="Nueva categoría" aria-label="Nueva categoría" onClick={() => setShowCatForm(true)}
                    className="mt-1 w-11 border border-border bg-card rounded-lg text-muted-foreground hover:bg-accent shrink-0 text-lg leading-none">+</button>
                </div>
                {categories.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Todavía no hay categorías. Creá una con el +.</p>
                )}
              </div>
              <div>
                <label className={FIELD_LABEL}>Fecha</label>
                <DateField required value={expenseDate} onChange={setExpenseDate} />
              </div>
            </FormGrid>

            <div>
              <label className="flex items-center gap-2.5 min-h-[44px] text-sm text-foreground cursor-pointer">
                <input type="checkbox" checked={differentPaymentDate}
                  onChange={e => { setDifferentPaymentDate(e.target.checked); if (e.target.checked) setPaymentDate(expenseDate); }}
                  className="w-[18px] h-[18px] rounded-md accent-[#1C1B25] shrink-0" />
                Se paga otro día
              </label>
              {differentPaymentDate && (
                <div>
                  <label className={FIELD_LABEL}>Fecha de pago</label>
                  <DateField required value={paymentDate} onChange={setPaymentDate} />
                  <p className="text-xs text-muted-foreground mt-1">
                    Se usa para saber en qué mes aparece este gasto en la vista por persona. No cambia tus Egresos.
                  </p>
                </div>
              )}
            </div>

            <div className={`${FORM_BLOCK} space-y-3`}>
              <SegmentedToggle ariaLabel="Cómo se divide" value={splitType} onChange={handleSplitTypeChange}
                options={[
                  { value: "equal", label: "En partes iguales" },
                  { value: "custom", label: "Personalizado" },
                ]} />

              <MotionList as="ul" className="space-y-2.5">
                {participants.map((p, idx) => {
                  const isCreator = idx === 0;
                  return (
                    <li key={idx} className="flex items-center gap-2">
                      <button type="button" disabled={isCreator} onClick={() => setPickerFor(idx)}
                        aria-label={isCreator ? undefined : `Cambiar a ${p.member_name}`}
                        className="flex-1 min-w-0 min-h-[44px] text-left disabled:cursor-default">
                        <span className="block text-[15px] font-medium text-foreground truncate">{p.member_name || "Elegí a quién"}</span>
                        <span className="block text-xs text-muted-foreground truncate">{isCreator ? "Vos" : participantHint(p)}</span>
                      </button>
                      {splitType === "custom" ? (
                        <span className="w-[116px] shrink-0">
                          <input type="text" inputMode="decimal" pattern="[0-9.,]*" placeholder="0,00"
                            aria-label={`Parte de ${p.member_name || "la fila " + (idx + 1)}`}
                            value={p.amount}
                            onChange={e => setManualAmount(idx, e.target.value)}
                            className={`${FIELD} mt-0 text-right tabular-nums ${!p.manual ? "text-muted-foreground italic" : ""}`} />
                          {!p.manual && parseAmount(p.amount) > 0 && (
                            <span className="block text-right text-[11px] text-[#3B2FB3] mt-0.5">sugerencia</span>
                          )}
                        </span>
                      ) : total > 0 && (
                        <span className="text-[15px] font-medium tabular-nums text-foreground shrink-0">{formatARS(equalShares[idx] ?? 0)}</span>
                      )}
                      {!isCreator ? (
                        <button type="button" onClick={() => removeParticipant(idx)} aria-label={`Quitar a ${p.member_name}`}
                          className="w-10 h-11 -mr-1.5 flex items-center justify-center text-muted-foreground shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      ) : <span className="w-[34px] shrink-0" />}
                    </li>
                  );
                })}
              </MotionList>

              <button type="button" onClick={() => setPickerFor("new")}
                className="w-full min-h-[44px] rounded-full border border-border bg-card inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-foreground active:scale-[0.98] transition-transform duration-100">
                <UserPlus className="w-4 h-4" /> Agregar persona
              </button>

              {splitType === "custom" && total > 0 && (
                <SplitBalance left={remainder(total, customAmounts)} money={formatARS} />
              )}
            </div>

            {participants.length > 1 && (
              <p className="px-1.5 text-xs text-muted-foreground">
                Puede llegarles un aviso al compartirlo, y eso no se deshace.
              </p>
            )}

            {formError && <p className={FORM_ERROR} role="alert">{formError}</p>}
          </div>
          <FormSheetActions onCancel={onClose} saving={saving} disabled={overBudget} label="Compartir gasto" />
        </form>
      </FormSheet>

      {/* Fuera de la hoja: su `backdrop-filter` encerraría a estas ventanas fijas. */}
      <ParticipantPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={applyPick}
        excludeUserIds={participants.map(x => x.user_id).filter((x): x is number => x !== null)}
      />
      {showCatForm && (
        <NewCategoryModal
          initialColor={pickCategoryColor(categories.map(c => c.color))}
          onSave={saveCat}
          onClose={() => setShowCatForm(false)}
        />
      )}
    </>
  );
}

/**
 * Editar y eliminar, con la pregunta ahí mismo. Es `SheetActions` con dos cosas que
 * ésa no deja: un gasto de tarjeta no tiene "Editar" (se edita en el resumen) pero
 * sí se puede eliminar, y la pregunta tiene que decir qué más se lleva puesto.
 */
/** Lo que se abre al tocar una fila: cuánto, quién pone qué y qué se puede hacer. */
function SharedSheet({
  exp, group, scope, focusSplit, categories, currentUserId,
  onEdit, onConvert, onAccept, onReject, onDelete, onClose,
}: {
  exp: SharedExpense;
  group: Group;
  /** "group": el plan entero, como en la lista. "cuota": esta sola, como en la vista por persona. */
  scope: "group" | "cuota";
  /** Vista por persona: convertir a pesos es la parte de esa persona, no la de todos. */
  focusSplit: Split | null;
  categories: Category[];
  currentUserId: number | undefined;
  onEdit: () => void;
  onConvert: (splitIds: number[]) => void;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCuotas, setShowCuotas] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { cuotas } = group;
  const inPlan = cuotas.length > 1;
  const wholePlan = scope === "group" && inPlan;
  const isCreator = exp.created_by_user_id === currentUserId;
  const mySplit = exp.splits.find(s => s.mine);
  const pendingMine = mySplit?.status === "pending";
  const category = categories.find(c => c.id === exp.category_id);

  const allConverted = exp.splits.every(s => s.converted_ars_amount != null);
  const groupTotal = cuotas.reduce((s, c) => s + Number(c.total_amount), 0);
  const headerAmount = allConverted
    ? exp.splits.reduce((s, sp) => s + Number(sp.converted_ars_amount), 0)
    : wholePlan ? groupTotal : Number(exp.total_amount);
  const headerCurrency: "ARS" | "USD" = allConverted ? "ARS" : exp.currency;

  // "Convertir todo" only makes sense whole-expense — a cuota group is always
  // ARS (USD only allowed for single-item purchases).
  const convertIds = focusSplit ? [focusSplit.id] : exp.splits.map(s => s.id);
  const canConvert = isCreator && exp.currency === "USD" && (!!focusSplit || !inPlan);
  const converted = focusSplit ? focusSplit.converted_ars_amount != null : allConverted;

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    }).catch(() => setError(`No se pudo copiar. El link es: ${link}`));
  }

  // Lo creado desde una tarjeta se edita desde la tarjeta. La parte de quien lo
  // cargó es el mismo egreso que tiene el ítem, y por ahí se llega a su resumen.
  const openStatement = () => run(async () => {
    const entryId = mySplit?.expense_entry_id;
    if (!entryId) throw new Error("sin egreso");
    const res = await api.get(`/credit-cards/for-expense/${entryId}`);
    onClose();
    router.push(`/tarjetas/${res.data.card_id}/${res.data.statement_id}?item=${exp.credit_card_item_id}`);
  }, "No se encontró el resumen de tarjeta de este gasto.");

  // Lo dice `delete_shared`: de un plan se borran sólo las cuotas de hoy en adelante.
  const deleteDetail = inPlan
    ? "Se borran esta cuota y las futuras del plan. Las que ya pasaron quedan."
    : "También se borra la parte de cada participante en Egresos.";

  const cuotaNumber = cuotas.findIndex(c => c.id === exp.id) + 1;

  return (
    <EntrySheet
      date={exp.expense_date}
      title={exp.title}
      badge={category ? { label: category.name, color: category.color } : undefined}
      amount={fmtByCurrency(headerAmount, headerCurrency)}
      onClose={onClose}
      footer={(
        <div className="space-y-2.5">
          {error && <p className={FORM_ERROR} role="alert">{error}</p>}
          {pendingMine && mySplit && (
            <div>
              <p className="px-1.5 pb-2.5 text-sm leading-snug text-[#4A4658]">
                Te corresponden {fmtByCurrency(resolveDisplay(mySplit, exp.currency).amount, resolveDisplay(mySplit, exp.currency).currency)}
                {wholePlan && ` por cuota (${cuotas.length} cuotas)`}. Si aceptás, tu parte se suma a tus Egresos.
              </p>
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => run(onReject, "No se pudo rechazar")}
                  className="h-[52px] px-4 rounded-full font-semibold text-[15px] text-foreground disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
                  Rechazar
                </button>
                <button type="button" disabled={busy} onClick={() => run(onAccept, "No se pudo aceptar")}
                  className="flex-1 h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
                  {inPlan ? "Aceptar todas" : "Aceptar"}
                </button>
              </div>
            </div>
          )}
          {canConvert && (
            <button type="button" onClick={() => onConvert(convertIds)}
              className="w-full h-12 rounded-full bg-white/70 border border-white/80 inline-flex items-center justify-center gap-2 font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
              <ArrowLeftRight className="w-4 h-4" /> {converted ? "Cambiar cotización" : "Convertir a pesos"}
            </button>
          )}
          {isCreator && exp.credit_card_item_id && mySplit?.expense_entry_id && (
            <SheetLink note="Es de tarjeta: se edita desde su resumen." label="Ver en resumen" onClick={openStatement} />
          )}
          {isCreator && (
            <SheetActions question={`¿Eliminarlo? ${deleteDetail} No se puede deshacer.`} onEdit={exp.credit_card_item_id ? undefined : onEdit}
              onDelete={() => run(onDelete, "No se pudo eliminar el gasto compartido")} />
          )}
          {!isCreator && !pendingMine && (
            <p className="px-1.5 pb-1 text-sm leading-snug text-[#4A4658]">Sólo quien lo cargó lo puede cambiar o eliminar.</p>
          )}
        </div>
      )}
    >
      {exp.splits.map(split => {
        const { amount, currency } = resolveDisplay(split, exp.currency);
        const status = splitStatus(split, exp);
        const token = split.invite_token;
        return (
          <SheetRow key={split.id} label={(
            <>
              <span className="block font-medium text-foreground truncate">{split.mine ? "Vos" : split.member_name}</span>
              <span className={`block text-[13px] ${status.waiting ? "text-[#3B2FB3]" : ""}`}>{status.text}</span>
              {token && isCreator && (
                <button type="button" onClick={() => copyInviteLink(token)}
                  className="mt-0.5 -ml-0.5 min-h-[36px] inline-flex items-center gap-1 text-[13px] font-semibold text-foreground">
                  {copiedToken === token ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedToken === token ? "Link copiado" : "Copiar link de invitación"}
                </button>
              )}
            </>
          )}>
            <span className="tabular-nums whitespace-nowrap">
              {fmtByCurrency(amount, currency)}
              {wholePlan && <span className="text-muted-foreground font-normal"> /cuota</span>}
              {split.converted_ars_amount != null && (
                <span className="block text-[13px] font-normal text-muted-foreground">
                  {ledgerAmount(split.amount, "USD")} · {RATE_TYPE_LABELS[split.converted_ars_rate_type ?? "blue"]}
                </span>
              )}
            </span>
          </SheetRow>
        );
      })}
      {scope === "cuota" && inPlan && (
        <SheetRow label="Cuota">{cuotaNumber} de {cuotas.length}</SheetRow>
      )}
      {!wholePlan && exp.payment_date !== exp.expense_date && (
        <SheetRow label="Fecha de pago">{fmtDate(exp.payment_date)}</SheetRow>
      )}
      {wholePlan && (
        <MotionList className="py-1">
          <button type="button" onClick={() => setShowCuotas(v => !v)} aria-expanded={showCuotas}
            className="w-full min-h-[44px] text-left text-[15px] font-semibold text-foreground">
            {showCuotas ? "Ocultar las cuotas" : `Ver las ${cuotas.length} cuotas`}
          </button>
          {showCuotas && (
            <div className="pb-2 space-y-1.5">
              {cuotas.map((c, i) => (
                <div key={c.id} className="flex items-baseline justify-between gap-3 text-sm text-[#4A4658]">
                  <span>Cuota {i + 1}/{cuotas.length} · {fmtDate(c.expense_date)}</span>
                  <span className="tabular-nums font-medium text-foreground">{fmtByCurrency(c.total_amount, c.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </MotionList>
      )}
    </EntrySheet>
  );
}

// Lo que espera una respuesta se ve primero, pero no puede crecer con los datos:
// es una fila que se desliza, y la lista queda a la misma altura con uno o con diez.
function PendingBlock({ groups, currentUserId, onOpen, onAccept, onReject }: {
  groups: Group[];
  currentUserId: number | undefined;
  onOpen: (g: Group) => void;
  onAccept: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const single = groups.length === 1;

  const resolve = async (id: number, action: (id: number) => Promise<void>) => {
    setBusyId(id);
    setError("");
    try {
      await action(id);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar la respuesta"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section data-tour="shared-pending" aria-label="Para resolver" className="rounded-3xl bg-accent border border-[#CFC9E4] p-2.5 space-y-2">
      <p className="px-1.5 pt-0.5 font-marca text-xs text-[#3F3B4B]">
        {groups.length} para resolver
      </p>
      <ScrollRow gap="gap-2">
      {groups.map(({ root: exp, cuotas }) => {
        const mine = exp.splits.find(s => s.mine)!;
        const { amount, currency } = resolveDisplay(mine, exp.currency);
        const plan = cuotas.length > 1;
        return (
          <div key={exp.id} className={`rounded-2xl bg-white p-1.5 pb-2 shrink-0 ${single ? "w-full" : "w-[86%] md:w-[340px]"}`}>
            <button type="button" onClick={() => onOpen({ root: exp, cuotas })}
              data-no-press className="w-full min-h-[52px] px-1.5 py-1 flex items-center gap-3 text-left active:opacity-60 transition-opacity">
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-[15.5px] text-foreground truncate">{exp.title}</span>
                <span className="block text-sm text-muted-foreground truncate">{rowSub(exp, cuotas.length, currentUserId)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-medium text-base tabular-nums text-foreground">{ledgerAmount(amount, currency)}</span>
                <span className="block text-xs text-muted-foreground">{plan ? "tu parte por cuota" : "tu parte"}</span>
              </span>
            </button>
            <div className="mt-1 grid grid-cols-2 gap-2 px-1">
              <button type="button" disabled={busyId !== null} onClick={() => resolve(exp.id, onReject)}
                aria-label={`Rechazar ${exp.title}`}
                className="h-11 rounded-full bg-ink/[0.06] font-semibold text-sm text-foreground disabled:opacity-50 active:scale-[0.97] transition-transform duration-100">
                Rechazar
              </button>
              <button type="button" disabled={busyId !== null} onClick={() => resolve(exp.id, onAccept)}
                aria-label={`Aceptar ${exp.title}`}
                className="h-11 rounded-full bg-ink text-background font-semibold text-sm disabled:opacity-50 active:scale-[0.97] transition-transform duration-100">
                {busyId === exp.id ? "Guardando…" : plan ? "Aceptar todas" : "Aceptar"}
              </button>
            </div>
          </div>
        );
      })}
      </ScrollRow>
      {error && <p className={FORM_ERROR} role="alert">{error}</p>}
    </section>
  );
}

export default function SharedExpensesPage() {
  const { refresh: refreshPending } = usePendingShared();
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const { appUser } = useAuth();
  const reaccionar = useReaccion();
  const [expenses, setExpenses] = useState<SharedExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<SharedExpense | null>(null);
  const [converting, setConverting] = useState<{ expense: SharedExpense; splitIds: number[] } | null>(null);
  // Por id y no el objeto: la ficha sigue a lo que devuelve la última recarga.
  const [detail, setDetail] = useState<{ expId: number; scope: "group" | "cuota"; splitId: number | null } | null>(null);

  const now = new Date();
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [personYear, setPersonYear] = useState(now.getFullYear());
  const [personMonth, setPersonMonth] = useState(now.getMonth() + 1);

  const loadCategories = async () => {
    try {
      const res = await api.get("/expenses/categories");
      setCategories(res.data);
    } catch { /* ignorar */ }
  };

  const load = async () => {
    setLoading(true);
    // Miembros y agenda ya no se piden acá: los carga ParticipantPicker cuando
    // se abre, que es el único lugar que los usa. Pedirlos en cada visita a la
    // pantalla era traer dos listas para no mostrarlas.
    const [se] = await Promise.allSettled([api.get("/shared-expenses")]);
    if (se.status === "fulfilled") setExpenses(se.value.data);
    setFailed(se.status === "rejected");
    await loadCategories();
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openForm = () => { setFormKey(k => k + 1); setShowForm(true); };

  // `refreshPending` además del `load()` de la pantalla: resolver acá tiene que
  // apagar el puntito de la navegación, que se alimenta de otra consulta.
  async function handleAccept(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/accept`);
    reaccionar("guardado", "Sumado a tus Egresos");
    setDetail(null);
    await load(); await refreshPending();
  }
  async function handleReject(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/reject`);
    reaccionar("borrado", "Gasto rechazado");
    setDetail(null);
    await load(); await refreshPending();
  }
  async function handleDelete(sharedId: number) {
    await api.delete(`/shared-expenses/${sharedId}`);
    reaccionar("borrado", "Gasto compartido eliminado");
    setDetail(null);
    await load();
  }

  const currentUserId = appUser?.id;

  // Las cuotas de un plan se muestran como una sola fila. Las dos vistas leen de acá.
  const groups = useMemo(() => {
    const map = new Map<number, SharedExpense[]>();
    for (const exp of expenses) {
      const rootId = exp.installment_group_id ?? exp.id;
      if (!map.has(rootId)) map.set(rootId, []);
      map.get(rootId)!.push(exp);
    }
    const out = new Map<number, Group>();
    for (const [rootId, members] of Array.from(map.entries())) {
      out.set(rootId, {
        root: members.find(m => m.id === rootId) ?? members[0],
        cuotas: [...members].sort((a, b) => a.expense_date.localeCompare(b.expense_date)),
      });
    }
    return out;
  }, [expenses]);

  const displayGroups = useMemo(
    () => Array.from(groups.values()).sort((a, b) => b.root.expense_date.localeCompare(a.root.expense_date)),
    [groups],
  );
  const pendingGroups = displayGroups.filter(g => g.root.splits.find(s => s.mine)?.status === "pending");
  // Lo que espera tu respuesta ya está en el bloque de arriba: no se repite abajo.
  const listGroups = displayGroups.filter(g => g.root.splits.find(s => s.mine)?.status !== "pending");

  // Distinct people I share expenses with (excluding myself), derived from
  // every split across every expense I can see — not just ones I created.
  const people = useMemo(() => {
    const map = new Map<string, { key: string; name: string }>();
    for (const exp of expenses) {
      for (const split of exp.splits) {
        if (split.mine) continue;
        const key = personKey(split);
        if (!map.has(key)) map.set(key, { key, name: split.member_name });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [expenses]);

  const selectedPerson = people.find(p => p.key === selectedPersonKey) ?? null;

  const personPrev = () => { if (personMonth === 1) { setPersonMonth(12); setPersonYear(y => y - 1); } else setPersonMonth(m => m - 1); };
  const personNext = () => { if (personMonth === 12) { setPersonMonth(1); setPersonYear(y => y + 1); } else setPersonMonth(m => m + 1); };
  const personPeriodLabel = format(new Date(personYear, personMonth - 1, 1), "MMMM yyyy", { locale: es });

  // Expenses where the selected person participates, in the selected month —
  // bucketed by payment_date (when the money actually moves), not expense_date
  // (the accounting date, which can land in a different month — e.g. a bill
  // closed end-of-July but due August 10th). Each installment cuota is its
  // own record with its own dates, so no cuota-grouping is needed here
  // (unlike the "Todos" list, which stays on expense_date).
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
      const mySplit = exp.splits.find(s => s.mine);
      if (!mySplit) continue;
      const { amount, currency } = resolveDisplay(mySplit, exp.currency);
      iOwe[currency] += amount;
    }
    return { owedToMe, iOwe };
  }, [owedToMeExpenses, iOweExpenses, selectedPerson]);

  function shareByWhatsApp() {
    if (!selectedPerson) return;
    const lines = [`Gastos compartidos con ${selectedPerson.name}, ${personPeriodLabel}`];

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
        const mySplit = exp.splits.find(s => s.mine);
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

  // Las dos direcciones de la vista por persona tienen la misma forma: cambian los
  // gastos y qué parte se muestra. Sólo se dibuja la que tiene algo.
  function renderDirection(
    heading: string,
    exps: SharedExpense[],
    splitFor: (exp: SharedExpense) => Split | undefined,
    totals: { ARS: number; USD: number },
    focusOnSplit: boolean,
  ) {
    if (exps.length === 0) return null;
    return (
      <section className="px-2">
        <h3 className="text-[15.5px] font-semibold text-foreground pb-1">{heading}</h3>
        <MotionList key={`${selectedPersonKey}-${personYear}-${personMonth}`} className="animate-page-in">
          {exps.map((exp, i) => {
            const split = splitFor(exp);
            if (!split) return null;
            const { amount, currency } = resolveDisplay(split, exp.currency);
            const group = groups.get(exp.installment_group_id ?? exp.id);
            const inPlan = (group?.cuotas.length ?? 1) > 1;
            const notes = [
              inPlan ? `Cuota ${(group?.cuotas.findIndex(c => c.id === exp.id) ?? 0) + 1} de ${group?.cuotas.length}` : "",
              split.converted_ars_amount != null ? `Convertido a ${RATE_TYPE_LABELS[split.converted_ars_rate_type ?? "blue"]}` : "",
            ].filter(Boolean).join(" · ");
            return (
              <LedgerRow key={exp.id}
                date={exp.payment_date}
                showDate={i === 0 || exps[i - 1].payment_date !== exp.payment_date}
                title={exp.title}
                sub={notes || undefined}
                amount={ledgerAmount(amount, currency)}
                onOpen={() => setDetail({ expId: exp.id, scope: "cuota", splitId: focusOnSplit ? split.id : null })}
              />
            );
          })}
        </MotionList>
        <LedgerTotal label="Total" ars={totals.ARS} usd={totals.USD} />
      </section>
    );
  }

  const detailExp = detail ? expenses.find(e => e.id === detail.expId) ?? null : null;
  const detailGroup = detailExp ? groups.get(detailExp.installment_group_id ?? detailExp.id) ?? null : null;

  const firstLoad = loading && expenses.length === 0;
  const steps = useMemo(
    () => tourSteps(pendingGroups.length > 0, people.length > 0, listGroups.length > 0),
    [pendingGroups.length > 0, people.length > 0, listGroups.length > 0], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <NuevoListener onNuevo={openForm} />
      {!firstLoad && expenses.length > 0 && <ProductTour tourId="shared-intro" steps={steps} />}
      <h1 className="text-[28px] md:text-[34px] font-medium leading-tight tracking-[-0.03em] text-foreground">Gastos compartidos</h1>

      <Fab label="Nuevo gasto compartido" data-tour="shared-add" onClick={openForm} />

      {people.length > 0 && (
        <div data-tour="shared-people">
          <ChoiceChips
            ariaLabel="Ver por persona"
            className="-mx-4 px-4 md:mx-0 md:px-0"
            value={selectedPerson ? selectedPerson.key : "all"}
            onChange={v => setSelectedPersonKey(v === "all" ? null : v)}
            options={[{ value: "all", label: "Todos" }, ...people.map(p => ({ value: p.key, label: p.name }))]}
          />
        </div>
      )}

      {selectedPerson ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate text-[22px] font-medium tracking-[-0.03em] text-foreground">Con {firstName(selectedPerson.name)}</h2>
            <MonthPill compact label={personPeriodLabel} onPrev={personPrev} onNext={personNext} />
          </div>

          {personExpenses.length === 0 ? (
            <p className="px-2 py-6 text-muted-foreground text-[15px]">
              No hay gastos compartidos con {selectedPerson.name} en {personPeriodLabel}.
            </p>
          ) : owedToMeExpenses.length === 0 && iOweExpenses.length === 0 ? (
            <p className="px-2 py-6 text-muted-foreground text-[15px]">
              En {personPeriodLabel} sólo comparten gastos que cargó otra persona: entre ustedes dos no hay nada que saldar.
            </p>
          ) : (
            <>
              <Card className="space-y-3">
                <div className="space-y-2">
                  {(["ARS", "USD"] as const).map(cur => {
                    const owed = personTotals.owedToMe[cur];
                    const owe = personTotals.iOwe[cur];
                    if (owed === 0 && owe === 0) return null;
                    const net = owed - owe;
                    if (net === 0) {
                      return <p key={cur} className="text-[22px] font-medium tracking-[-0.03em] text-foreground">Están a mano en {cur === "USD" ? "dólares" : "pesos"}</p>;
                    }
                    return (
                      <div key={cur}>
                        <p className="text-sm text-muted-foreground">{net > 0 ? `${firstName(selectedPerson.name)} te debe` : `Le debés a ${firstName(selectedPerson.name)}`}</p>
                        <p className={`text-[34px] font-medium leading-tight tracking-[-0.04em] tabular-nums ${net > 0 ? "text-emerald-800" : "text-foreground"}`}>
                          {ledgerAmount(Math.abs(net), cur)}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <Button variant="outline" onClick={shareByWhatsApp} className="w-full min-h-[44px]">
                  <Share2 className="w-4 h-4" /> Compartir por WhatsApp
                </Button>
              </Card>

              {renderDirection("Te debe", owedToMeExpenses,
                exp => exp.splits.find(s => personKey(s) === selectedPerson.key), personTotals.owedToMe, true)}
              {renderDirection("Vos debés", iOweExpenses,
                exp => exp.splits.find(s => s.mine), personTotals.iOwe, false)}
            </>
          )}
        </div>
      ) : firstLoad ? (
        <div className="space-y-2 px-2" aria-busy="true" aria-label="Cargando gastos compartidos">
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-ink/[0.05] animate-pulse" />)}
        </div>
      ) : failed && expenses.length === 0 ? (
        <div className="px-2 py-6 space-y-3">
          <p className="text-muted-foreground text-[15px]">No se pudieron traer tus gastos compartidos. Revisá la conexión y probá de nuevo.</p>
          <Button variant="outline" onClick={load}>Reintentar</Button>
        </div>
      ) : expenses.length === 0 ? (
        <div className="px-2 py-6 space-y-3">
          <p className="text-[22px] font-medium tracking-[-0.03em] text-foreground">Todavía no compartiste nada</p>
          <p className="text-muted-foreground text-[15px]">Cargá un gasto, elegí con quién dividirlo y acá ves quién aceptó y cuánto se deben.</p>
          <Button onClick={openForm} className="min-h-[44px]">Compartir un gasto</Button>
        </div>
      ) : (
        <>
          {pendingGroups.length > 0 && (
            <PendingBlock groups={pendingGroups} currentUserId={currentUserId}
              onOpen={g => setDetail({ expId: g.root.id, scope: "group", splitId: null })}
              onAccept={handleAccept} onReject={handleReject} />
          )}
          {listGroups.length > 0 && (
            <MotionList as="section" className="px-2">
              {listGroups.map(({ root: exp, cuotas }, i) => {
                const isGrouped = cuotas.length > 1;
                const groupTotal = cuotas.reduce((s, c) => s + Number(c.total_amount), 0);
                const allConverted = exp.splits.every(s => s.converted_ars_amount != null);
                const headerAmount = allConverted
                  ? exp.splits.reduce((s, sp) => s + Number(sp.converted_ars_amount), 0)
                  : isGrouped ? groupTotal : Number(exp.total_amount);
                // La guía ilumina la primera fila: la lista entera no deja lugar para el globo.
                // Por eso la línea va en este envoltorio y no en la fila.
                return (
                  <div key={exp.id} data-tour={i === 0 ? "shared-list" : undefined} className="border-b border-border last:border-b-0">
                    <LedgerRow
                      date={exp.expense_date}
                      showDate={i === 0 || listGroups[i - 1].root.expense_date !== exp.expense_date}
                      title={exp.title}
                      sub={rowSub(exp, cuotas.length, currentUserId)}
                      amount={ledgerAmount(headerAmount, allConverted ? "ARS" : exp.currency)}
                      onOpen={() => setDetail({ expId: exp.id, scope: "group", splitId: null })}
                    />
                  </div>
                );
              })}
            </MotionList>
          )}
        </>
      )}

      {detailExp && detailGroup && detail && (
        <SharedSheet
          exp={detailExp}
          group={detailGroup}
          scope={detail.scope}
          focusSplit={detail.splitId ? detailExp.splits.find(s => s.id === detail.splitId) ?? null : null}
          categories={categories}
          currentUserId={currentUserId}
          onClose={() => setDetail(null)}
          onEdit={() => { setDetail(null); setEditingExpense(detailExp); }}
          onConvert={splitIds => { setDetail(null); setConverting({ expense: detailExp, splitIds }); }}
          onAccept={() => handleAccept(detailExp.id)}
          onReject={() => handleReject(detailExp.id)}
          onDelete={() => handleDelete(detailExp.id)}
        />
      )}

      {showForm && (
        <NewSharedForm
          key={formKey}
          categories={categories}
          reloadCategories={loadCategories}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            reaccionar("guardado", "Gasto compartido");
            load();
          }}
        />
      )}

      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          categories={categories}
          onClose={() => setEditingExpense(null)}
          onSaved={() => { setEditingExpense(null); reaccionar("guardado", "Gasto actualizado"); load(); }}
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

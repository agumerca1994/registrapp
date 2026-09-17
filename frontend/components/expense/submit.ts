/**
 * El borrador de un egreso y cómo se convierte en un request.
 *
 * Funciones puras, sin React: acá vive la matriz de las cuatro combinaciones
 * (simple, con tarjeta, compartido, tarjeta + compartido) y todas las reglas
 * cruzadas. La UI de `ExpenseFormModal` sólo junta los datos y muestra el
 * primer error que devuelve `validateDraft`.
 */
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { parseAmount } from "@/lib/utils";
import { equalSplit, fromCents, sumMatches, toCents } from "@/lib/split";

export type Currency = "ARS" | "USD";
export type PayMethod = "cash" | "card";
export type PlanType = "single" | "installment";
export type SplitType = "equal" | "custom";

export interface SplitRow {
  type: "self" | "member" | "external";
  user_id: number | null;
  member_name: string;
  /** Mail o teléfono de un invitado sin cuenta, tal como lo entrega el picker. */
  contact: string;
  /** Sólo se usa en división personalizada. */
  amount: string;
}

export interface CreditCardLite {
  id: number;
  bank: string;
  alias: string;
  last_4_digits: string | null;
}

export interface ExpenseDraft {
  currency: Currency;
  amount: string;
  category_id: string;
  expense_date: string;
  description: string;
  /** No tiene campo en el formulario; se conserva al editar. */
  notes: string;

  pay: PayMethod;
  card_id: string;
  /** yyyy-MM del resumen. */
  period: string;
  /** Si la persona tocó el mes: a partir de ahí deja de seguir a la fecha. */
  periodTouched: boolean;
  plan: PlanType;
  installments: string;

  shared: boolean;
  splitType: SplitType;
  rows: SplitRow[];
}

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 72;

export function newDraft(today: string, self: SplitRow | null): ExpenseDraft {
  return {
    currency: "ARS",
    amount: "",
    category_id: "",
    expense_date: today,
    description: "",
    notes: "",
    pay: "cash",
    card_id: "",
    period: today.slice(0, 7),
    periodTouched: false,
    plan: "single",
    installments: "",
    shared: false,
    splitType: "equal",
    rows: self ? [self] : [],
  };
}

export const isCard = (d: ExpenseDraft) => d.pay === "card";
export const isInstallment = (d: ExpenseDraft) => isCard(d) && d.plan === "installment";

export function installmentCount(d: ExpenseDraft): number {
  const n = parseInt(d.installments, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lo que se divide. **En cuotas es el monto por cuota**, no el total: el
 * backend comparte cada cuota por separado con los mismos montos, y valida la
 * suma contra el monto de la cuota.
 */
export function shareBase(d: ExpenseDraft): number {
  return parseAmount(d.amount || "0");
}

/** Monto de cada fila tal como se va a mandar. */
export function rowAmounts(d: ExpenseDraft): number[] {
  if (d.splitType === "equal") return equalSplit(shareBase(d), d.rows.length);
  return d.rows.map(r => parseAmount(r.amount || "0"));
}

export function purchaseTotal(d: ExpenseDraft): number {
  return fromCents(toCents(shareBase(d)) * installmentCount(d));
}

export function periodLabel(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return "";
  return format(parseISO(`${period}-01`), "MMMM yyyy", { locale: es });
}

export function cardLabel(c: CreditCardLite): string {
  const tail = c.last_4_digits ? ` ••${c.last_4_digits}` : "";
  return `${c.alias} · ${c.bank}${tail}`;
}

export interface ValidateCtx {
  mode: "create" | "edit";
  /** null mientras no se pidieron o si fallaron. */
  cards: CreditCardLite[] | null;
}

/** El primer problema del borrador, o null si se puede guardar. */
export function validateDraft(d: ExpenseDraft, ctx: ValidateCtx): string | null {
  const amount = shareBase(d);
  if (!(amount > 0)) return "Poné un monto mayor a cero.";
  if (!d.expense_date) return "Elegí una fecha.";

  const cardUsd = ctx.mode === "create" && isCard(d) && d.currency === "USD";
  if (d.currency === "ARS" && !d.category_id && !cardUsd) return "Elegí una categoría.";

  if (ctx.mode === "edit") return null;

  if ((isCard(d) || d.shared) && !d.description.trim()) {
    return isCard(d)
      ? "Poné una descripción: es el nombre con el que aparece en el resumen."
      : "Poné una descripción: es lo que ven las personas con las que lo compartís.";
  }

  if (isCard(d)) {
    if (ctx.cards && ctx.cards.length === 0) return "Todavía no cargaste ninguna tarjeta.";
    if (!ctx.cards) return "No pudimos cargar tus tarjetas. Probá de nuevo.";
    if (!d.card_id) return "Elegí la tarjeta.";
    if (!/^\d{4}-\d{2}$/.test(d.period)) return "Elegí el mes del resumen.";
    if (d.plan === "installment") {
      if (d.currency === "USD") return "En dólares sólo se puede cargar en un pago.";
      const n = installmentCount(d);
      if (n < MIN_INSTALLMENTS || n > MAX_INSTALLMENTS) {
        return `La cantidad de cuotas tiene que estar entre ${MIN_INSTALLMENTS} y ${MAX_INSTALLMENTS}.`;
      }
    }
  }

  if (d.shared) {
    if (d.rows.length < 2) return "Agregá al menos a una persona más.";
    if (d.rows.some(r => !r.member_name.trim())) return "Elegí a quién o quitá la fila.";
    if (d.splitType === "custom" && !sumMatches(shareBase(d), rowAmounts(d))) {
      return "La división no suma lo que hay que dividir.";
    }
  }
  return null;
}

export type SubmitKind = "simple" | "card" | "shared";

export interface BuiltRequest {
  kind: SubmitKind;
  method: "post" | "patch";
  url: string;
  body: Record<string, unknown>;
}

function splitsPayload(d: ExpenseDraft) {
  const amounts = rowAmounts(d);
  return d.rows.map((r, i) => ({
    user_id: r.type === "external" ? null : r.user_id,
    member_name: r.member_name,
    amount: amounts[i],
    ...(r.type === "external" && r.contact.trim() ? { invite_contact: r.contact.trim() } : {}),
  }));
}

/** Arma el request. Asume que `validateDraft` ya devolvió null. */
export function buildRequest(d: ExpenseDraft, mode: "create" | "edit", editId?: number): BuiltRequest {
  const amount = shareBase(d);
  const category = d.category_id ? { category_id: parseInt(d.category_id, 10) } : {};

  if (mode === "edit") {
    return {
      kind: "simple", method: "patch", url: `/expenses/entries/${editId}`,
      body: { amount, description: d.description, expense_date: d.expense_date, notes: d.notes, currency: d.currency, ...category },
    };
  }

  if (isCard(d)) {
    const [year, month] = d.period.split("-").map(Number);
    const installment = d.plan === "installment";
    return {
      kind: "card", method: "post", url: `/credit-cards/${d.card_id}/items`,
      body: {
        year, month,
        description: d.description.trim(),
        item_date: d.expense_date,
        item_type: installment ? "installment" : "single",
        amount,
        currency: d.currency,
        // En dólares la categoría la pone el backend ("Consumo en dólares").
        ...(d.currency === "ARS" ? category : {}),
        installment_number: 1,
        ...(installment ? { installment_count: installmentCount(d), purchase_total: purchaseTotal(d) } : {}),
        ...(d.shared ? { share: { split_type: d.splitType, splits: splitsPayload(d) } } : {}),
      },
    };
  }

  if (d.shared) {
    return {
      kind: "shared", method: "post", url: "/shared-expenses",
      body: {
        title: d.description.trim(),
        total_amount: amount,
        currency: d.currency,
        ...category,
        split_type: d.splitType,
        expense_date: d.expense_date,
        splits: splitsPayload(d),
      },
    };
  }

  return {
    kind: "simple", method: "post", url: "/expenses/entries",
    body: { amount, description: d.description, expense_date: d.expense_date, notes: d.notes, currency: d.currency, ...category },
  };
}

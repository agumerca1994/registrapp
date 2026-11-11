import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { formatARS, formatARSRound, formatUSD, parseAmount } from "@/lib/utils";

// Los Decimal del backend llegan como string.
type Num = string | number;

export type Kind = "hipotecario" | "personal" | "prendario" | "plan_ahorro" | "particular" | "otro";
export type Adjustment = "uva" | "fija";
export type Amortization = "frances" | "aleman" | "americano";
export type Method = "formula" | "cuota" | "manual";
export type Currency = "ARS" | "USD";

export interface Credit {
  id: number;
  kind: Kind;
  kind_label: string;
  title: string;
  adjustment: Adjustment;
  amortization: Amortization;
  method: Method;
  currency: Currency;
  description: string | null;
  loan_number: string | null;
  total_cuotas: number;
  first_payment_date: string;
  payment_day: number | null;
  cuota_uva: Num | null;
  cuota_pesos: Num | null;
  tna: Num | null;
  original_capital_uva: Num | null;
  capital: Num | null;
  plan_status: "suscripto" | "adjudicado" | null;
  is_active: boolean;
  created_at: string;
  cuota_numero: number;
  cuotas_pagadas: number;
  cuotas_restantes: number;
  pct_completado: number;
  finished: boolean;
  paid_this_month: boolean;
  next_payment_date: string | null;
  next_amount: Num | null;
  next_units: Num | null;
  next_is_estimated: boolean;
  balance: Num | null;
  balance_units: Num | null;
  total_paid: Num;
  this_month_paid: Num;  // lo registrado este mes, en su moneda
  uva_value: Num | null;
  uva_date: string | null;
}

export interface CreditPayment {
  id: number;
  period_date: string;
  payment_amount: Num;
  capital: Num | null;
  interest: Num | null;
  uva_units: Num | null;
  cuota_number: number | null;
  currency: Currency;
  is_manual: boolean;
  expense_entry_id: number | null;
  paid_on: string | null;
}

export interface CreditDetail {
  credit: Credit;
  payments: CreditPayment[];
}

/** Lo que ve la persona al elegir: qué es y cuándo es éste. */
export const KIND_OPTIONS: { kind: Kind; label: string; desc: string }[] = [
  { kind: "hipotecario", label: "Crédito hipotecario", desc: "Para comprar o construir tu casa." },
  { kind: "personal", label: "Préstamo personal", desc: "De un banco, Mercado Pago, Ualá, Naranja X o una billetera." },
  { kind: "prendario", label: "Crédito prendario", desc: "Para un auto o una moto, también el de tasa 0% de la concesionaria." },
  { kind: "plan_ahorro", label: "Plan de ahorro", desc: "Un auto en cuotas que siguen su precio. Cada cuota la cargás vos." },
  { kind: "particular", label: "De un particular", desc: "Plata que te prestó alguien: un familiar, un amigo." },
  { kind: "otro", label: "Otro", desc: "Una mutual, ANSES o cualquier otro." },
];

/**
 * Cómo se paga, en el orden en que es más común para cada tipo. Cada opción fija
 * los ejes del crédito; "Sé la cuota" y "La cargo cada mes" van al final de todas,
 * en ese orden. El plan de ahorro no tiene este paso: el backend lo fuerza a manual.
 */
export interface PayOption {
  id: string;
  label: string;
  desc: string;
  adjustment: Adjustment;
  currency: Currency;
  method: Method;
  amortization?: Amortization;
  /** Sin interés: la tasa es 0 y no se pregunta. */
  noInterest?: boolean;
  /** La persona elige la moneda en el paso siguiente. */
  pickCurrency?: boolean;
}

const KNOW_CUOTA: PayOption = {
  id: "cuota", label: "Sé cuánto pago por mes",
  desc: "Ponés la cuota y la cantidad de cuotas, y listo.",
  adjustment: "fija", currency: "ARS", method: "cuota",
};
const MANUAL: PayOption = {
  id: "manual", label: "La cargo cada mes",
  desc: "Para una tasa variable o pagos que cambian: la cuota no se registra sola.",
  adjustment: "fija", currency: "ARS", method: "manual", pickCurrency: true,
};

export const PAY_OPTIONS: Record<Exclude<Kind, "plan_ahorro">, PayOption[]> = {
  hipotecario: [
    { id: "uva", label: "En UVA", desc: "La cuota se ajusta con la inflación. Es el más común.", adjustment: "uva", currency: "ARS", method: "formula" },
    { id: "fija", label: "Tasa fija en pesos", desc: "La tasa no cambia en todo el crédito.", adjustment: "fija", currency: "ARS", method: "formula" },
    { id: "usd", label: "En dólares", desc: "Lo pagás en dólares, a tasa fija.", adjustment: "fija", currency: "USD", method: "formula" },
    KNOW_CUOTA, MANUAL,
  ],
  personal: [
    { id: "fija", label: "Tasa fija en pesos", desc: "El de casi todos los bancos y las billeteras.", adjustment: "fija", currency: "ARS", method: "formula" },
    { id: "uva", label: "En UVA", desc: "La cuota se ajusta con la inflación.", adjustment: "uva", currency: "ARS", method: "formula" },
    KNOW_CUOTA, MANUAL,
  ],
  prendario: [
    { id: "fija", label: "Tasa fija", desc: "También la tasa 0% de la concesionaria.", adjustment: "fija", currency: "ARS", method: "formula" },
    { id: "uva", label: "En UVA", desc: "La cuota se ajusta con la inflación.", adjustment: "uva", currency: "ARS", method: "formula" },
    KNOW_CUOTA, MANUAL,
  ],
  particular: [
    { id: "sin", label: "Sin interés", desc: "Devolvés lo mismo que te prestaron, en cuotas iguales.", adjustment: "fija", currency: "ARS", method: "formula", noInterest: true, pickCurrency: true },
    { id: "con", label: "Con interés", desc: "Acordaron una tasa.", adjustment: "fija", currency: "ARS", method: "formula", pickCurrency: true },
    { id: "final", label: "Todo al final", desc: "Cada mes pagás el interés, si hay, y el capital entero en la última cuota.", adjustment: "fija", currency: "ARS", method: "formula", amortization: "americano", pickCurrency: true },
    KNOW_CUOTA, MANUAL,
  ],
  otro: [
    { id: "fija", label: "Tasa fija", desc: "Con el capital, la tasa y el plazo, la cuota sale sola.", adjustment: "fija", currency: "ARS", method: "formula", pickCurrency: true },
    KNOW_CUOTA, MANUAL,
  ],
};

/** En qué puede estar la cuota que la persona ya sabe, según el tipo. */
export const CUOTA_UNITS: Record<Kind, ("ARS" | "UVA" | "USD")[]> = {
  hipotecario: ["UVA", "ARS", "USD"],
  personal: ["ARS", "UVA"],
  prendario: ["ARS", "UVA"],
  plan_ahorro: ["ARS"],
  particular: ["ARS", "USD"],
  otro: ["ARS", "UVA", "USD"],
};

export const DEFAULT_CUOTAS: Record<Kind, number> = {
  hipotecario: 240, personal: 12, prendario: 48, plan_ahorro: 84, particular: 12, otro: 12,
};

export const AMORTIZATION_TEXT: Record<Amortization, { label: string; desc: string }> = {
  frances: { label: "Francés", desc: "La cuota es la misma todos los meses. Al principio pagás más interés." },
  aleman: { label: "Alemán", desc: "Devolvés lo mismo de capital cada mes: la cuota arranca más alta y va bajando." },
  americano: { label: "Americano", desc: "Cada mes pagás sólo el interés, y el capital entero en la última cuota." },
};

/** Cómo se ajusta, en palabras. */
export function adjustmentText(c: Pick<Credit, "adjustment" | "currency" | "tna" | "method" | "kind">): string {
  if (c.kind === "plan_ahorro") return "Sigue el precio del bien";
  if (c.adjustment === "uva") return "En UVA";
  const money = c.currency === "USD" ? "en dólares" : "en pesos";
  if (c.method === "formula" && c.tna != null && Number(c.tna) === 0) return `Sin interés, ${money}`;
  return `Tasa fija ${money}`;
}

export function methodText(m: Method): string {
  return m === "formula" ? "Calculada con la tasa" : m === "cuota" ? "La pusiste vos" : "La cargás cada mes";
}

/** Un monto en la moneda del crédito. `round` para la cifra grande. */
export function money(v: Num, currency: Currency, round = false): string {
  if (currency === "USD") return round ? formatUSD(v).replace(/,00$/, "") : formatUSD(v);
  return round ? formatARSRound(v) : formatARS(v);
}

export function fmtDate(iso: string): string {
  try { return format(parseISO(iso), "d MMM yyyy", { locale: es }).replace(".", ""); }
  catch { return iso; }
}

export function fmtShortDate(iso: string): string {
  try { return format(parseISO(iso), "d MMM", { locale: es }).replace(".", ""); }
  catch { return iso; }
}

export function monthName(iso: string): string {
  return format(parseISO(iso), "MMMM", { locale: es });
}

/** Un número como se escribe acá: "4.069.000,00", nunca "4069000.00". */
export function fmtDecimal(v: Num | null | undefined, digits = 2): string {
  if (v == null || v === "") return "";
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v));
}

export function fmtUnits(v: Num | null | undefined): string {
  return `${fmtDecimal(v)} UVA`;
}

// Por parseAmount y no por parseFloat: "150.000" son ciento cincuenta mil, no 150.
export function parseDecimalInput(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseAmount(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseRate(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseAmount(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isCurrentMonth(iso: string | null): boolean {
  if (!iso) return false;
  const d = parseISO(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** La fecha que se muestra de una cuota: el día en que salió, si se sabe. */
export function paymentDate(p: CreditPayment): string {
  return p.paid_on ?? p.period_date;
}

/** Cómo se nombra la fila de un crédito: si el título ya es el tipo, no se repite abajo. */
export function creditSub(c: Credit): string {
  const bits = [c.title !== c.kind_label ? c.kind_label : null];
  if (c.finished) bits.push("Terminado");
  else if (!c.is_active) bits.push("Pausado");
  else bits.push(`Cuota ${Math.min(c.cuota_numero, c.total_cuotas)} de ${c.total_cuotas}`);
  return bits.filter(Boolean).join(" · ");
}

export const LABEL = "text-xs font-medium text-muted-foreground";
export const MENU_ITEM = "flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-accent w-full outline-none cursor-pointer";
export const OPTION = "w-full text-left rounded-[22px] bg-white/70 border border-white/80 p-3.5 hover:bg-white transition-colors active:scale-[0.99] disabled:opacity-50";
export const MENU_PANEL = "rounded-[22px] border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota p-1.5 animate-fade-in w-52 z-50";
export const H1 = "text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground";

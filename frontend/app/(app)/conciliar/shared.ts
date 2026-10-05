import { formatARS, formatUSD } from "@/lib/utils";

/**
 * Tipos y vocabulario de la conciliación de resúmenes (/conciliar), compartidos
 * entre la lista y el detalle para que las dos pantallas no puedan nombrar el
 * mismo estado con palabras distintas.
 */

export type SessionStatus =
  | "ready" | "unexplained" | "needs_ai" | "needs_choice" | "applied" | "closed";

export interface SessionRow {
  id: number;
  status: SessionStatus;
  reason: string | null;
  bank: string | null;
  card_id: number | null;
  period_year: number | null;
  period_month: number | null;
  item_count: number;
  has_pending: boolean;
  created_at: string | null;
}

export interface ActionPayload {
  // missing
  description?: string;
  bank_description?: string;
  bank_coupon?: string | null;
  date?: string;
  amount?: string;
  currency?: string;
  item_type?: string;
  installment_number?: number | null;
  installment_count?: number | null;
  category_id?: number | null;
  category_source?: string | null;
  // updates (rounding / amount_diff / double_count / usd_fix)
  item_id?: number;
  updates?: { amount?: string; description?: string };
  app_description?: string;
  app_amount?: string;
  // dates
  closing_date?: string | null;
  due_date?: string | null;
}

export interface Action {
  id: number;
  klass: string;
  op: string;
  item_id: number | null;
  payload: ActionPayload;
  status: "proposed" | "applied" | "discarded" | "undone" | "needs_app";
  applied_at: string | null;
}

export interface CurrencyTotals {
  bank_total: string;
  app_total: string;
  difference: string;
  explained: string;
  unexplained: string;
}

export interface CardChoice {
  card_id: number;
  alias: string;
  bank: string | null;
  last_4: string | null;
}

export interface StatementChoice {
  statement_id: number;
  year: number;
  month: number;
  closing_date: string | null;
  due_date: string | null;
  item_count: number;
}

export interface SessionDetail {
  id: number;
  status: SessionStatus;
  reason: string | null;
  channel: string | null;
  bank: string | null;
  bank_id: string | null;
  card_label: string | null;
  cardholder: string | null;
  card_id: number | null;
  statement_id: number | null;
  period_year: number | null;
  period_month: number | null;
  closing_date: string | null;
  due_date: string | null;
  totals: { ARS?: CurrencyTotals; USD?: CurrencyTotals } | null;
  choices: { cards?: CardChoice[]; statements?: StatementChoice[] } | null;
  item_count: number;
  excluded: Record<string, number> | null;
  excluded_by_rule: string[] | null;
  groups: Partial<Record<string, Action[]>>;
  group_order: string[];
  created_at: string | null;
  plan?: "free" | "pro";
}

export interface ApplyResult {
  dry_run: boolean;
  applied: number;
  skipped: { action_id: number; reason: string; description?: string }[];
  stamped: number;
  propagated_future_cuotas: number;
  pending_groups: Record<string, number>;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "septiembre 2026", o null cuando el período todavía no se conoce. */
export function periodLabel(year: number | null, month: number | null): string | null {
  if (!year || !month || month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${year}`;
}

/** Estado → chip. Ámbar es "te espera algo", rosa "no cierra", nunca un error. */
export const STATUS_CHIP: Record<SessionStatus, { label: string; tone: "neutral" | "violet" | "emerald" | "amber" | "rose" }> = {
  ready: { label: "Para revisar", tone: "amber" },
  needs_choice: { label: "Falta elegir", tone: "amber" },
  needs_ai: { label: "No se pudo leer", tone: "neutral" },
  unexplained: { label: "No cierra", tone: "rose" },
  applied: { label: "Aplicada en parte", tone: "violet" },
  closed: { label: "Conciliada", tone: "emerald" },
};

export const GROUP_LABELS: Record<string, string> = {
  dates: "Fechas del resumen",
  missing: "Faltantes",
  double_count: "Cargos sumados dos veces",
  amount_diff: "Montos distintos",
  usd_fix: "USD mal identificados",
  rounding: "Redondeos de cuota",
  surplus: "Sobrantes",
};

// Para la línea "Quedan: 2 redondeos · 1 sobrante" del pie del detalle.
export const GROUP_NOUNS: Record<string, [string, string]> = {
  dates: ["fecha por corregir", "fechas por corregir"],
  missing: ["faltante", "faltantes"],
  double_count: ["cargo duplicado", "cargos duplicados"],
  amount_diff: ["monto distinto", "montos distintos"],
  usd_fix: ["USD por corregir", "USD por corregir"],
  rounding: ["redondeo", "redondeos"],
  surplus: ["sobrante", "sobrantes"],
};

/** Un monto en la moneda del renglón — nunca se mezclan ni se suman. */
export function fmtAmount(currency: string | null | undefined, value: string | number): string {
  return currency === "USD" ? formatUSD(Number(value)) : formatARS(Number(value));
}

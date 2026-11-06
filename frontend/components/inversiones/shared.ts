import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ledgerAmount } from "@/components/movimientos/Ledger";

export type Currency = "ARS" | "USD";
export type Kind = "plazo_fijo" | "cuenta" | "fci" | "acciones" | "cripto" | "efectivo";

export interface Investment {
  id: number;
  name: string;
  kind: Kind;
  kind_label: string;
  currency: Currency;
  institution: string | null;
  tna: string | null;
  start_date: string;
  maturity_date: string | null;
  closed_at: string | null;
  created_at: string;
  invested: string;
  value: string;
  gain: string;
  gain_pct: number | null;
  value_date: string | null;
  calculated: boolean;
  stale_days: number | null;
  matured: boolean;
  value_at_maturity: string | null;
}

export interface Totals { value: string; invested: string; gain: string }

export interface InvestmentsResponse {
  investments: Investment[];
  // Sólo las vigentes, y cada moneda por su lado: pesos y dólares nunca se suman.
  totals: Partial<Record<Currency, Totals>>;
}

export interface Movement {
  id: number;
  kind: "deposit" | "withdrawal" | "valuation";
  amount: string;
  movement_date: string;
  note: string | null;
  user_id: number | null;
}

export interface InvestmentDetail { investment: Investment; movements: Movement[] }

/** Lo que cotiza: su valor lo carga la persona, y un número viejo se nota. */
export const MARKET: Kind[] = ["fci", "acciones", "cripto"];
export const isMarket = (k: Kind) => MARKET.includes(k);
/** Pasado esto, el valor de algo que cotiza ya no dice cuánto vale hoy. */
export const STALE_AFTER = 30;
export const isStale = (inv: Investment) => isMarket(inv.kind) && (inv.stale_days ?? 0) > STALE_AFTER;

export const KIND_OPTIONS: { kind: Kind; label: string; short: string; desc: string }[] = [
  { kind: "plazo_fijo", label: "Plazo fijo", short: "Plazo fijo", desc: "Con tasa y vencimiento. Lo que rinde se calcula solo." },
  { kind: "cuenta", label: "Cuenta remunerada", short: "Cuenta", desc: "La billetera o la cuenta del banco que paga interés. Se calcula sola con la TNA." },
  { kind: "fci", label: "Fondo común de inversión", short: "FCI", desc: "Cargás lo que pusiste y, cada tanto, cuánto vale." },
  { kind: "acciones", label: "Acciones y CEDEARs", short: "Acciones", desc: "Lo que tenés en el broker. Actualizás el valor cuando lo mirás." },
  { kind: "cripto", label: "Cripto", short: "Cripto", desc: "Bitcoin, USDT o la que tengas. Va en dólares, salvo que elijas pesos." },
  { kind: "efectivo", label: "Efectivo", short: "Efectivo", desc: "Pesos o dólares guardados. Vale lo que pusiste." },
];

/** Montos sin ",00", como en las listas; los centavos se ven en la ficha. */
export const money = (amount: number | string, currency: Currency) => ledgerAmount(amount, currency);

/** "+$ 52.603" o "−U$D 120". Un cero no se muestra. */
export function signedMoney(amount: number | string, currency: Currency): string | null {
  const n = Number(amount);
  if (Math.abs(n) < 0.005) return null;
  return `${n > 0 ? "+" : "−"}${money(Math.abs(n), currency)}`;
}

export function pctText(p: number | null): string | null {
  if (p === null || Math.abs(p) < 0.05) return null;
  return `${p > 0 ? "+" : "−"}${Math.abs(p).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}

/** "19 nov", y con el año si no es este. */
export function shortDate(iso: string): string {
  const d = parseISO(iso);
  const pattern = d.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy";
  return format(d, pattern, { locale: es }).replace(/\./g, "");
}

export function ago(days: number): string {
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 60) return `hace ${days} días`;
  return `hace ${Math.round(days / 30)} meses`;
}

export const tnaText = (tna: string | number) =>
  `${Number(tna).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;

/** Interés simple, el mismo cálculo del backend para el plazo fijo. */
export function simpleAtMaturity(amount: number, tna: number, start: string, end: string): number {
  const days = Math.max(differenceInCalendarDays(parseISO(end), parseISO(start)), 0);
  return amount * (1 + (tna / 100) * (days / 365));
}

/**
 * "Tipo · institución", sin lo que ya dice el nombre: "Plazo fijo Nación" no
 * necesita "Plazo fijo · Nación" abajo.
 */
export function subLine(inv: Investment): string {
  const name = inv.name.toLowerCase();
  const short = KIND_OPTIONS.find(k => k.kind === inv.kind)?.short ?? inv.kind_label;
  const parts = [
    name.includes(short.toLowerCase()) || name.includes(inv.kind_label.toLowerCase()) ? null : inv.kind_label,
    inv.institution && !name.includes(inv.institution.toLowerCase()) ? inv.institution : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export type Tone = "pending" | "quiet";
export const TONE = { pending: "text-[#3B2FB3]", quiet: "text-muted-foreground" } as const;

/** La línea de estado: lo que sirve saber de esa inversión hoy. */
export function statusLine(inv: Investment): { text: string; tone: Tone } | null {
  if (inv.closed_at) return { text: `Rescatada el ${shortDate(inv.closed_at)}`, tone: "quiet" };
  if (inv.matured && inv.maturity_date) return { text: `Venció el ${shortDate(inv.maturity_date)}: ¿lo renovaste?`, tone: "pending" };
  if (inv.kind === "plazo_fijo" && inv.maturity_date) {
    const at = inv.value_at_maturity ? ` · al vencer ${money(Math.round(Number(inv.value_at_maturity)), inv.currency)}` : "";
    return { text: `Vence el ${shortDate(inv.maturity_date)}${at}`, tone: "quiet" };
  }
  if (inv.kind === "cuenta") {
    return inv.calculated && inv.tna ? { text: `Calculado al ${tnaText(inv.tna)} TNA`, tone: "quiet" } : null;
  }
  if (isMarket(inv.kind)) {
    const days = inv.stale_days ?? 0;
    if (!inv.value_date) {
      return days > STALE_AFTER
        ? { text: `Hace ${days} días que no cargás cuánto vale`, tone: "pending" }
        : { text: "Vale lo que pusiste hasta que cargues el valor", tone: "quiet" };
    }
    return { text: `Actualizado ${ago(days)}${days > STALE_AFTER ? ": ¿cuánto vale hoy?" : ""}`, tone: days > STALE_AFTER ? "pending" : "quiet" };
  }
  return null;
}

// Un monto en un campo se ve como se escribe acá: "4.069.000,00". El backend manda "4069000.00".
export const amountText = (n: number | string) =>
  Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const LABEL = "text-xs font-medium text-muted-foreground";
export const OPTION = "w-full text-left rounded-[22px] bg-white/70 border border-white/80 p-3.5 hover:bg-white transition-colors active:scale-[0.99] disabled:opacity-50";
export const MENU_PANEL = "rounded-[22px] border border-white/70 bg-card/90 backdrop-blur-2xl backdrop-saturate-150 shadow-flota p-1.5 animate-fade-in w-52 z-50";
export const MENU_ITEM = "flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-accent w-full outline-none cursor-pointer";
export const H1 = "text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground";

/**
 * Ventas de un negocio: el borrador de una venta, sus reglas y el request.
 *
 * Funciones puras, sin React, como `components/expense/submit.ts`: la UI junta
 * los datos y muestra el primer error que devuelve `validateSale`.
 *
 * La regla que manda: **lo cobrado es la verdad de la plata, no las líneas.**
 * El total arranca en lo que suman los productos y sigue a las líneas hasta
 * que la persona lo toca (un descuento, un redondeo); de ahí en más manda lo
 * que escribió. Los pagos se arman desde ese total.
 */
import { parseAmount } from "@/lib/utils";
import { fromCents, toCents } from "@/lib/split";

export type PaymentMethod = "efectivo" | "mercadopago" | "debito" | "credito" | "transferencia" | "otro";

/** En el orden en que se ofrecen: lo más común primero. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  mercadopago: "Mercado Pago",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  otro: "Otro",
};
export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

export interface Product {
  id: number;
  name: string;
  kind: "reventa" | "elaborado";
  unit: "unidad" | "porcion" | "kg";
  sale_price: number | string | null;
  track_stock: boolean;
  min_stock: number | string | null;
  is_active: boolean;
}

export interface SaleLine {
  id: number;
  product_id: number | null;
  description: string | null;
  qty: number | string;
  unit_price: number | string | null;
}

export interface Sale {
  id: number;
  sale_date: string;
  kind: "ticket" | "cierre";
  total: number | string;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  lines: SaleLine[];
  payments: { method: PaymentMethod; amount: number | string }[];
}

export interface MethodLine {
  method: PaymentMethod;
  ticketed: number | string;
  counted: number | string | null;
  diff: number | string | null;
}

export interface DaySummary {
  sale_date: string;
  tickets: Sale[];
  close: Sale | null;
  by_method: MethodLine[];
  ticketed_total: number | string;
  counted_total: number | string | null;
  total: number | string;
  warnings: string[];
}

export interface SaleLineDraft {
  key: string;
  product_id: number | null;
  /** Sólo en una línea libre. */
  description: string;
  qty: number;
  /** Como se escribe ("1.500"); vacío = sin precio. */
  unit_price: string;
}

export interface SaleDraft {
  sale_date: string;
  lines: SaleLineDraft[];
  /** Lo cobrado, como se escribe. Sigue a las líneas mientras no se toque. */
  total: string;
  totalTouched: boolean;
  method: PaymentMethod;
  /** Un segundo medio de pago y cuánto se cobró por ahí. */
  split: { method: PaymentMethod; amount: string } | null;
  notes: string;
  /** Lo genera el celular al abrir el formulario: un reintento no duplica. */
  client_ref: string;
}

/** El día de un negocio en la Argentina: hasta las 5 de la mañana sigue siendo
 *  el anterior (lo mismo que `services/clock.business_today` del backend). */
export function businessToday(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 5 * 3600 * 1000);
  // en-CA formatea como yyyy-MM-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(shifted);
}

let lineSeq = 0;
export const newLineKey = () => `l${++lineSeq}`;

function newRef(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function newSaleDraft(sale_date: string): SaleDraft {
  return {
    sale_date, lines: [], total: "", totalTouched: false,
    method: "efectivo", split: null, notes: "", client_ref: newRef(),
  };
}

/** Un borrador desde una venta guardada, para editarla. */
export function draftFromSale(sale: Sale): SaleDraft {
  const fmt = (n: number | string | null) =>
    n === null || n === "" ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const [first, second] = sale.payments;
  return {
    sale_date: sale.sale_date,
    lines: sale.lines.map(l => ({
      key: newLineKey(), product_id: l.product_id, description: l.description ?? "",
      qty: Number(l.qty), unit_price: fmt(l.unit_price),
    })),
    total: fmt(sale.total),
    totalTouched: true,
    method: first?.method ?? "efectivo",
    split: second ? { method: second.method, amount: fmt(second.amount) } : null,
    notes: sale.notes ?? "",
    client_ref: newRef(),
  };
}

export function linesTotal(d: SaleDraft): number {
  const cents = d.lines.reduce(
    (s, l) => s + Math.round(toCents(parseAmount(l.unit_price || "0")) * l.qty), 0,
  );
  return fromCents(cents);
}

export function chargedTotal(d: SaleDraft): number {
  return d.totalTouched ? parseAmount(d.total || "0") : linesTotal(d);
}

/** El primer problema del borrador, o null si se puede guardar. */
export function validateSale(d: SaleDraft): string | null {
  const total = chargedTotal(d);
  if (!(total > 0)) return d.lines.length ? "Poné cuánto se cobró." : "Elegí productos o poné el total cobrado.";
  for (const l of d.lines) {
    if (!l.product_id && !l.description.trim()) return "Cada línea necesita un producto o una descripción.";
    if (!(l.qty > 0)) return "La cantidad tiene que ser mayor a cero.";
  }
  if (d.split) {
    const second = parseAmount(d.split.amount || "0");
    if (d.split.method === d.method) return "El segundo medio de pago tiene que ser otro.";
    if (!(second > 0)) return "Poné cuánto se cobró por el segundo medio.";
    if (toCents(second) >= toCents(total)) return "Lo del segundo medio tiene que ser menos que el total.";
  }
  return null;
}

/** El body de `POST/PATCH /sales`. Asume que `validateSale` devolvió null. */
export function buildSaleBody(d: SaleDraft) {
  const total = toCents(chargedTotal(d));
  const second = d.split ? toCents(parseAmount(d.split.amount || "0")) : 0;
  const payments = [{ method: d.method, amount: fromCents(total - second) }];
  if (d.split) payments.push({ method: d.split.method, amount: fromCents(second) });
  return {
    sale_date: d.sale_date,
    lines: d.lines.map(l => ({
      product_id: l.product_id,
      description: l.product_id ? null : l.description.trim(),
      qty: l.qty,
      unit_price: l.unit_price.trim() ? parseAmount(l.unit_price) : null,
    })),
    payments,
    notes: d.notes.trim() || null,
    client_ref: d.client_ref,
  };
}

/** "3 × Empanada, 1 × Coca-Cola" — o "Venta rápida" si no tiene detalle. */
export function saleSummary(sale: Sale, products: Product[]): string {
  if (!sale.lines.length) return "Venta rápida";
  return sale.lines.map(l => {
    const name = l.product_id ? products.find(p => p.id === l.product_id)?.name ?? "Producto" : l.description;
    const qty = Number(l.qty);
    return `${Number.isInteger(qty) ? qty : qty.toLocaleString("es-AR")} × ${name}`;
  }).join(", ");
}

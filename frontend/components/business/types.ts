export type PayeeKind = "proveedor" | "empleado" | "otro";

export const PAYEE_KIND_LABELS: Record<PayeeKind, string> = {
  proveedor: "Proveedor",
  empleado: "Empleado",
  otro: "Otro",
};

/** A quién le paga un negocio (backend: models/business.py). Se archiva, no se borra. */
export interface Payee {
  id: number;
  name: string;
  kind: PayeeKind;
  default_category_id: number | null;
  notes: string | null;
  is_active: boolean;
}

export type StockKind = "compra" | "produccion" | "venta" | "ajuste" | "merma";

export const STOCK_KIND_LABELS: Record<StockKind, string> = {
  compra: "Ingreso",
  produccion: "Producción",
  venta: "Venta",
  ajuste: "Conteo",
  merma: "Merma",
};

/** Lo que hay de un producto que lleva stock (backend: services/business/stock.py). */
export interface StockLevel {
  product_id: number;
  name: string;
  unit: "unidad" | "porcion" | "kg";
  on_hand: number | string;
  min_stock: number | string | null;
  alert: "negativo" | "bajo" | null;
}

export interface StockMovement {
  id: number;
  product_id: number;
  kind: StockKind;
  qty: number | string;
  movement_date: string;
  unit_cost: number | string | null;
  counted_qty: number | string | null;
  expense_entry_id: number | null;
  sale_id: number | null;
  notes: string | null;
}

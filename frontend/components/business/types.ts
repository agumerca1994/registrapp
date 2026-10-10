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

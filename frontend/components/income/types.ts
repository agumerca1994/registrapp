import { parseAmount } from "@/lib/utils";

export type FieldKind = "add" | "subtract" | "info";

export interface SourceField {
  id: number;
  name: string;
  kind: FieldKind;
  position: number;
  // Archivado: ya no se ofrece para ingresos nuevos, pero sus montos siguen en
  // los ingresos que lo cargaron. `GET /sources` sólo devuelve los archivados
  // que todavía tienen ítems.
  is_active: boolean;
  // Con montos cargados el tipo queda fijo (el backend lo rechaza igual).
  has_items: boolean;
}

export interface IncomeSource {
  id: number;
  name: string;
  income_type: string;
  fields?: SourceField[];
}

export interface EntryItem {
  field_id: number;
  name: string;
  kind: FieldKind;
  amount: number | string;
  field_active: boolean;
}

export interface IncomeEntry {
  id: number; source_id: number;
  bruto: number | null; deducciones: number | null; amount: number;
  period_date: string; notes?: string; currency?: string;
  source: IncomeSource;
  items?: EntryItem[];
}

export const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "Sueldo", bonus: "Bono", aguinaldo: "Aguinaldo",
  investment: "Inversión", other: "Otro",
};

export const KIND_LABELS: Record<FieldKind, string> = {
  add: "Suma", subtract: "Resta", info: "Info",
};

/** Neto que resulta del detalle (Σ suma − Σ resta), en centavos para que
 *  0,1 + 0,2 no termine en un "0.30000000000000004" en el campo. */
export function detailNet(rows: { kind: FieldKind; amount: number | string }[]): number {
  let cents = 0;
  for (const r of rows) {
    const v = Math.round(parseAmount(r.amount) * 100);
    if (r.kind === "add") cents += v;
    else if (r.kind === "subtract") cents -= v;
  }
  return cents / 100;
}

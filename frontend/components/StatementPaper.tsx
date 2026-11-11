"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Chip } from "@/components/ui/chip";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import { RowMenu, shortDate, totalsByCurrency } from "@/components/tarjetas/parts";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

export interface StatementData {
  id: number;
  year: number;
  month: number;
  closing_date?: string;
  due_date?: string;
  due_date_effective?: string;
  due_date_is_estimated?: boolean;
  total: number;
  items: { id: number; amount: number | string; currency?: string | null }[];
}

const MENU_LABEL = (s: StatementData) => `Más acciones de ${MONTH_NAMES[s.month - 1]} ${s.year}`;

// Lo que usa el dashboard para contar: la fecha real, o la estimada mientras el
// banco no mandó la suya. Una estimación tiene que decirlo, no pasar por un dato.
const dueOf = (s: StatementData) => s.due_date || s.due_date_effective;
const Estimated = () => <Chip locked className="px-2 py-0 text-[11px]">estimado</Chip>;

/**
 * Los montos salen de los ítems: `statement.total` trae sólo los pesos, y acá
 * también van los dólares de cada plan.
 */
function Amounts({ statement }: { statement: StatementData }) {
  const { ars, usd } = totalsByCurrency(statement.items);
  if (ars <= 0 && usd <= 0) return <span className="text-sm text-muted-foreground">Sin gastos</span>;
  return (
    <>
      {ars > 0 && <span className="block">{ledgerAmount(ars)}</span>}
      {usd > 0 && <span className="block">{ledgerAmount(usd, "USD")}</span>}
    </>
  );
}

/** Un resumen en la lista de una tarjeta, con la fecha en que vence a la izquierda. */
export function StatementPaper({
  statement,
  onClick,
  onEdit,
  onDelete,
}: {
  statement: StatementData;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const due = dueOf(statement);
  return (
    <div className="flex items-center gap-1 border-b border-border">
      <button type="button" data-no-press onClick={onClick}
        className="flex-1 min-w-0 min-h-[64px] py-2 flex items-center gap-3 md:gap-4 text-left active:opacity-60 transition-opacity">
        <span className="w-[46px] shrink-0">
          {due && (
            <>
              <span className="block font-fecha italic text-[30px] leading-none text-[#3B2FB3]">{format(parseISO(due), "d")}</span>
              <span className="font-marca text-xs text-muted-foreground whitespace-nowrap">{format(parseISO(due), "MMM", { locale: es }).replace(".", "")}</span>
            </>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-[15.5px] text-foreground truncate">{MONTH_NAMES[statement.month - 1]} {statement.year}</span>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
            <span className="truncate">
              {due ? "Vence" : "Sin vencimiento"}
              {statement.closing_date && ` · cierre ${shortDate(statement.closing_date)}`}
            </span>
            {due && statement.due_date_is_estimated && <Estimated />}
          </span>
        </span>
        <span className="shrink-0 font-medium text-base text-right tabular-nums text-foreground">
          <Amounts statement={statement} />
        </span>
      </button>
      <RowMenu label={MENU_LABEL(statement)} editLabel="Editar fechas" onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

/**
 * El resumen de este mes, el papel que se viene a ver: con su cifra grande y
 * entre los dos grupos plegados. Sin este mes en la tarjeta, no se dibuja.
 */
export function CurrentStatement({
  statement,
  onClick,
  onEdit,
  onDelete,
}: {
  statement: StatementData;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const due = dueOf(statement);
  const { ars, usd } = totalsByCurrency(statement.items);
  return (
    <div className="flex items-start gap-1 rounded-3xl border border-border bg-card pl-4 pr-3 py-3.5 md:pl-5 md:py-4">
      <button type="button" data-no-press onClick={onClick} className="flex-1 min-w-0 text-left active:opacity-60 transition-opacity">
        <span className="block text-sm text-muted-foreground">Resumen de {MONTH_NAMES[statement.month - 1].toLowerCase()}</span>
        {ars > 0 || usd > 0 ? (
          <span className="block mt-0.5 font-medium tracking-[-0.03em] tabular-nums text-foreground">
            {ars > 0 && <span className="block text-[32px] leading-tight">{ledgerAmount(ars)}</span>}
            {usd > 0 && <span className={`block leading-tight ${ars > 0 ? "text-lg tracking-[-0.01em]" : "text-[32px]"}`}>{ledgerAmount(usd, "USD")}</span>}
          </span>
        ) : (
          <span className="block mt-1 text-[19px] font-medium tracking-[-0.02em] text-foreground">Todavía sin gastos</span>
        )}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
          {due ? <span>Vence el {shortDate(due)}</span> : <span>Sin vencimiento cargado</span>}
          {due && statement.due_date_is_estimated && <Estimated />}
          {statement.closing_date && <span>· cierre {shortDate(statement.closing_date)}</span>}
        </span>
      </button>
      <RowMenu label={MENU_LABEL(statement)} editLabel="Editar fechas" onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

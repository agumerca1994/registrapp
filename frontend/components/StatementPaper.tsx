"use client";

import { Pencil, Trash2 } from "lucide-react";
import { formatARS, formatDate } from "@/lib/utils";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface StatementData {
  id: number;
  year: number;
  month: number;
  closing_date?: string;
  due_date?: string;
  total: number;
  items: { id: number }[];
}

// Full-width row for a statement — styled like a paper (a document, not a
// plastic card, and not the app's 3D hero treatment — per the one-hero-per-
// screen rule, a plain list stays flat). No badge/icon at all — kept
// simple after the folded-corner "dog-ear" detail proved unreliable across
// browsers. Closing/due dates always sit on their own lines under the
// title (in place of an item count, which doesn't carry much signal here).
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
  return (
    <div
      className="relative rounded-2xl border border-border shadow-sm bg-card cursor-pointer transition-colors hover:bg-accent/40 p-3 sm:p-4 flex items-center gap-3 sm:gap-4"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">{MONTH_NAMES[statement.month - 1]} {statement.year}</p>
        {statement.closing_date && (
          <p className="text-xs text-muted-foreground">
            <span className="text-[10px] font-medium uppercase tracking-wide">Cierre </span>
            {formatDate(statement.closing_date)}
          </p>
        )}
        {statement.due_date && (
          <p className="text-xs text-muted-foreground">
            <span className="text-[10px] font-medium uppercase tracking-wide">Vence </span>
            {formatDate(statement.due_date)}
          </p>
        )}
      </div>

      <p className="shrink-0 text-sm font-bold text-rose-600">{formatARS(statement.total)}</p>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Editar resumen"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
          title="Eliminar resumen"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

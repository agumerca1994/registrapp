"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Pencil, Trash2, MoreVertical } from "lucide-react";
import { formatARS, formatDate } from "@/lib/utils";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface StatementData {
  id: number;
  year: number;
  month: number;
  closing_date?: string;
  due_date?: string;
  due_date_effective?: string;
  due_date_is_estimated?: boolean;
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
        {/* Show the date the dashboard actually accounts with. While the bank
            hasn't sent the real one it's an estimate from the card's due day,
            and it has to say so rather than pass as fact. */}
        {(statement.due_date || statement.due_date_effective) && (
          <p className="text-xs text-muted-foreground">
            <span className="text-[10px] font-medium uppercase tracking-wide">Vence </span>
            {formatDate(statement.due_date || statement.due_date_effective!)}
            {statement.due_date_is_estimated && (
              <span className="ml-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px">
                estimado
              </span>
            )}
          </p>
        )}
      </div>

      <p className="shrink-0 text-sm font-bold text-rose-600">{formatARS(statement.total)}</p>

      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none" title="Más acciones">
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="bg-card border rounded-xl shadow-lg p-1 w-40 z-50">
              <DropdownMenu.Item asChild>
                <button onClick={onEdit}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full text-left outline-none cursor-pointer">
                  <Pencil className="w-4 h-4 text-muted-foreground" /> Editar
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <button onClick={onDelete}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 w-full text-left outline-none cursor-pointer">
                  <Trash2 className="w-4 h-4" /> Eliminar
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

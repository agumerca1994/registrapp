"use client";

import { UserPlus, X } from "lucide-react";
import { FIELD, SegmentedToggle } from "@/components/ui/form";
import { cn, formatARS, formatUSD } from "@/lib/utils";
import { remainder } from "@/lib/split";
import { installmentCount, isInstallment, rowAmounts, shareBase, type ExpenseDraft, type SplitRow } from "./submit";

/**
 * Con quién se comparte y cuánto pone cada uno.
 *
 * **Deuda consciente:** `/shared` y `ShareItemModal` (resumen de tarjeta)
 * tienen cada uno su propia lógica de división, con dos defectos que ésta no
 * tiene — `/shared` lee "15.000" como 15 y ninguno de los dos cierra el resto
 * de centavos igual que el backend. Quedaron sin tocar porque el formulario
 * unificado sólo reemplaza el alta del `+`. Esta sección usa `lib/split.ts`,
 * que es a donde deberían migrar.
 *
 * El picker de participantes no se renderiza acá: vive fuera del `<form>` del
 * modal, porque su buscador no frena el Enter y adentro del form guardaría el
 * egreso. Esta sección sólo pide "elegí a alguien para la fila N".
 */
export default function SplitSection({ draft, set, onPick }: {
  draft: ExpenseDraft;
  set: (patch: Partial<ExpenseDraft>) => void;
  /** `null` = agregar una persona nueva; un índice = cambiar esa fila. */
  onPick: (idx: number | null) => void;
}) {
  const money = draft.currency === "USD" ? formatUSD : formatARS;
  const base = shareBase(draft);
  const amounts = rowAmounts(draft);
  const cuotas = isInstallment(draft) ? installmentCount(draft) : 0;

  const updateRow = (idx: number, patch: Partial<SplitRow>) =>
    set({ rows: draft.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  const removeRow = (idx: number) => set({ rows: draft.rows.filter((_, i) => i !== idx) });

  const hint = (r: SplitRow) =>
    r.type === "self" ? "Vos"
      : r.type === "member" ? "Tiene RegistrApp"
      : r.contact ? `Se invita a ${r.contact}` : "Sin cuenta";

  const left = draft.splitType === "custom" ? remainder(base, amounts) : 0;

  return (
    <div className="space-y-3 rounded-lg border border-border px-3 py-3">
      <SegmentedToggle
        ariaLabel="Cómo se divide"
        value={draft.splitType}
        onChange={splitType => set({ splitType })}
        options={[
          { value: "equal", label: "En partes iguales" },
          { value: "custom", label: "Personalizado" },
        ]}
      />

      <p className="text-xs text-muted-foreground">
        A dividir: <span className="font-medium text-foreground">{money(base)}</span>
        {cuotas >= 2 && <> por cuota · se comparten las {cuotas} cuotas</>}
      </p>

      <ul className="space-y-2">
        {draft.rows.map((r, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <button type="button" disabled={r.type === "self"} onClick={() => onPick(idx)}
              className="flex-1 min-w-0 text-left disabled:cursor-default">
              <span className="block text-sm text-foreground truncate">{r.member_name || "Elegí a quién"}</span>
              <span className="block text-[11px] text-muted-foreground truncate">{hint(r)}</span>
            </button>
            {draft.splitType === "equal" ? (
              <span className="text-sm tabular-nums text-foreground shrink-0">{money(amounts[idx] ?? 0)}</span>
            ) : (
              <input type="text" inputMode="decimal" pattern="[0-9.,]*"
                aria-label={`Parte de ${r.member_name || "la fila " + (idx + 1)}`}
                className={cn(FIELD, "mt-0 w-28 shrink-0 text-right tabular-nums")}
                value={r.amount} onChange={e => updateRow(idx, { amount: e.target.value })} />
            )}
            {r.type !== "self" ? (
              <button type="button" onClick={() => removeRow(idx)} aria-label={`Quitar a ${r.member_name}`}
                className="p-1 text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-4 h-4" />
              </button>
            ) : <span className="w-6 shrink-0" />}
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => onPick(null)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
        <UserPlus className="w-3.5 h-3.5" /> Agregar persona
      </button>

      {draft.splitType === "custom" && (
        <p className={`text-[11px] ${left === 0 ? "text-muted-foreground" : "text-amber-700"}`}>
          {left === 0 ? "La división suma justo." : left > 0 ? `Falta repartir ${money(left)}.` : `Te pasaste por ${money(-left)}.`}
        </p>
      )}
    </div>
  );
}

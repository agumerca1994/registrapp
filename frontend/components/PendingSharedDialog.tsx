"use client";

import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { formatARS, formatUSD, formatDate, getErrorMessage } from "@/lib/utils";
import { usePendingShared, type PendingShared, type PendingSplit } from "@/contexts/PendingSharedContext";
import { useTourRunning } from "@/components/ProductTour";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { useExitGhost } from "@/lib/motion";

// Misma regla que /shared: si el split se saldó en pesos, el número que importa
// es el convertido, no el original en dólares.
function display(split: PendingSplit, expenseCurrency: string) {
  if (split.converted_ars_amount != null) {
    return { amount: Number(split.converted_ars_amount), currency: "ARS" as const };
  }
  return { amount: Number(split.amount), currency: (expenseCurrency === "USD" ? "USD" : "ARS") as "ARS" | "USD" };
}

const money = (amount: number, currency: "ARS" | "USD") =>
  currency === "USD" ? formatUSD(amount) : formatARS(amount);

function sharedBy(exp: PendingShared): string {
  const creator = exp.splits.find(s => s.user_id === exp.created_by_user_id);
  return creator?.member_name || "Te lo compartieron";
}

/**
 * El aviso del primer ingreso: los gastos compartidos que están esperando tu
 * decisión, de a uno y paginado.
 *
 * No tiene "omitir": no aceptar ni rechazar es exactamente lo mismo que cerrar
 * la ventana, y dos acciones distintas para el mismo resultado sólo obligan a
 * elegir entre ellas. Cerrar no pierde nada — queda el puntito en la
 * navegación y la sección sigue donde estaba.
 */
export function PendingSharedDialog() {
  // `dismissed` vive en el contexto para que el carrusel de novedades sepa si
  // este aviso está a la vista y no se encime.
  const { pending, accept, reject, dialogDismissed: dismissed, dismissDialog } = usePendingShared();
  const [index, setIndex] = useState(0);
  // La guía de producto y este aviso pueden dispararse los dos en el primer
  // ingreso y se encimarían. Gana la guía, que corre una sola vez y justamente
  // enseña dónde queda cada sección; el aviso vuelve apenas termina, y mientras
  // tanto el puntito ya está encendido.
  //
  // Se pregunta si hay una guía CORRIENDO, no si quedó alguna sin ver: los
  // tours `requireDesktop` no se marcan como vistos en mobile, así que la
  // segunda pregunta se contesta "sí" para siempre en un teléfono y el aviso
  // no aparecía nunca ahí.
  const tourRunning = useTourRunning();

  // La lista se acorta al resolver, así que el índice puede quedar apuntando
  // más allá del final.
  useEffect(() => {
    if (index > 0 && index >= pending.length) setIndex(Math.max(0, pending.length - 1));
  }, [pending.length, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismissDialog(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissDialog]);

  if (dismissed || tourRunning || pending.length === 0) return null;

  const exp = pending[Math.min(index, pending.length - 1)];
  if (!exp) return null;

  const mySplit = exp.splits.find(s => s.mine);
  if (!mySplit) return null;

  return (
    <PendingSheet exp={exp} mySplit={mySplit} count={pending.length} index={Math.min(index, pending.length - 1)}
      onPage={setIndex} onAccept={accept} onReject={reject} onClose={dismissDialog} />
  );
}

/**
 * La hoja, aparte: este aviso no se desmonta al cerrarse, devuelve null. Siendo un
 * componente propio, lo que se va del árbol es la hoja, y `useExitGhost` la baja.
 */
function PendingSheet({ exp, mySplit, count, index, onPage, onAccept, onReject, onClose }: {
  exp: PendingShared;
  mySplit: PendingSplit;
  count: number;
  index: number;
  onPage: (index: number) => void;
  onAccept: (id: number) => Promise<unknown>;
  onReject: (id: number) => Promise<unknown>;
  onClose: () => void;
}) {
  const ghost = useExitGhost<HTMLDivElement>();
  const reaccionar = useReaccion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mine = display(mySplit, exp.currency);
  const total = { amount: Number(exp.total_amount), currency: (exp.currency === "USD" ? "USD" : "ARS") as "ARS" | "USD" };

  // Los centavos más chicos, como en la ficha de un movimiento.
  const text = money(mine.amount, mine.currency);
  const comma = text.lastIndexOf(",");
  const whole = comma >= 0 ? text.slice(0, comma) : text;
  const cents = comma >= 0 ? text.slice(comma) : "";

  const resolve = async (action: "accept" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await (action === "accept" ? onAccept(exp.id) : onReject(exp.id));
      if (action === "accept") reaccionar("guardado", "Sumado a tus Egresos");
      else reaccionar("borrado", "Gasto rechazado");
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar la respuesta"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={ghost}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 p-2.5 animate-fade-in"
      style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Gastos compartidos por confirmar"
    >
      <div
        className="relative w-full sm:max-w-[400px] max-h-[88vh] overflow-y-auto rounded-[34px] border border-white/70 bg-card/85 backdrop-blur-2xl backdrop-saturate-150 shadow-flota px-3.5 pt-2.5 pb-3.5 animate-sheet-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-ink/20 mx-auto mb-3" />
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 w-10 h-10 rounded-full bg-ink/[0.07] text-foreground flex items-center justify-center active:scale-[0.95] transition-transform duration-100"
        >
          <X className="w-[18px] h-[18px]" />
        </button>

        <div className="px-1.5 pb-3.5 sm:pt-2">
          <p className="font-marca text-xs text-muted-foreground pr-12">
            {count === 1 ? "Te compartieron un gasto" : `${count} para resolver`}
          </p>
          <p className="mt-2.5 text-sm text-[#4A4658]">Tu parte</p>
          <p className="font-medium text-[44px] leading-[1.1] tracking-[-0.04em] tabular-nums break-words text-foreground">
            {whole}
            {cents && <span className="text-2xl tracking-[-0.02em] text-muted-foreground">{cents}</span>}
          </p>
          <h3 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{exp.title}</h3>
          <p className="text-[15px] text-[#4A4658] mt-0.5">
            {sharedBy(exp)} · {formatDate(exp.expense_date)}
          </p>
        </div>

        <div className="rounded-[22px] bg-white/70 border border-white/80 px-3.5">
          <div className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
            <span className="text-[#4A4658]">Total del gasto</span>
            <span className="font-medium text-foreground tabular-nums">{money(total.amount, total.currency)}</span>
          </div>
        </div>

        {/* Aceptar crea el gasto en tus egresos, y eso no se ve en ningún lado
            del diálogo — conviene decirlo antes y no después. */}
        <p className="px-1.5 pt-2.5 text-sm leading-snug text-[#4A4658]">
          Si aceptás, tu parte se suma a tus Egresos.
        </p>

        {error && (
          <p role="alert" className="mt-2.5 text-sm text-destructive bg-destructive/10 rounded-2xl px-3.5 py-2.5">
            {error}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => resolve("reject")}
            className="h-[52px] px-4 rounded-full font-semibold text-[15px] text-foreground disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
            Rechazar
          </button>
          <button type="button" disabled={busy} onClick={() => resolve("accept")}
            className="flex-1 h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
            {busy ? "Guardando…" : "Aceptar"}
          </button>
        </div>

        {/* El paginador va abajo: se navega entre pendientes sin decidir, pero
            decidir es la acción principal y va primero. */}
        {count > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              onClick={() => onPage(Math.max(0, index - 1))}
              disabled={index === 0}
              aria-label="Gasto anterior"
              className="w-11 h-11 rounded-full flex items-center justify-center text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="font-marca text-xs text-muted-foreground">
              {index + 1} de {count}
            </span>
            <button
              onClick={() => onPage(Math.min(count - 1, index + 1))}
              disabled={index >= count - 1}
              aria-label="Gasto siguiente"
              className="w-11 h-11 rounded-full flex items-center justify-center text-foreground disabled:opacity-30"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

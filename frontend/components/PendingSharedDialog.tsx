"use client";

import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight, Users2 } from "lucide-react";
import { Card as UiCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatARS, formatUSD, formatDate, getErrorMessage } from "@/lib/utils";
import { usePendingShared, type PendingShared, type PendingSplit } from "@/contexts/PendingSharedContext";
import { tourSeenKey } from "@/components/ProductTour";

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
  return creator?.member_name || "Alguien de tu hogar";
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
  const { pending, accept, reject } = usePendingShared();
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  // La guía de producto y este aviso se disparan los dos en el primer ingreso y
  // se encimarían: dos overlays a la vez no se pueden usar. Gana la guía, que
  // corre una sola vez y justamente enseña dónde queda cada sección. El aviso
  // vuelve en el ingreso siguiente, y mientras tanto el puntito ya está
  // encendido, así que no se pierde nada.
  //
  // Arranca en `true` y se resuelve en un efecto: leer localStorage durante el
  // render desincroniza la hidratación.
  const [tourPending, setTourPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // La lista se acorta al resolver, así que el índice puede quedar apuntando
  // más allá del final.
  useEffect(() => {
    if (index > 0 && index >= pending.length) setIndex(Math.max(0, pending.length - 1));
  }, [pending.length, index]);

  useEffect(() => {
    setTourPending(!localStorage.getItem(tourSeenKey("dashboard-intro")));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDismissed(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (dismissed || tourPending || pending.length === 0) return null;

  const exp = pending[Math.min(index, pending.length - 1)];
  if (!exp) return null;

  const mySplit = exp.splits.find(s => s.mine);
  if (!mySplit) return null;

  const mine = display(mySplit, exp.currency);
  const total = { amount: Number(exp.total_amount), currency: (exp.currency === "USD" ? "USD" : "ARS") as "ARS" | "USD" };

  const resolve = async (action: "accept" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await (action === "accept" ? accept(exp.id) : reject(exp.id));
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar la respuesta"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={() => setDismissed(true)}
      role="dialog"
      aria-modal="true"
      aria-label="Gastos compartidos por confirmar"
    >
      <UiCard
        className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <Users2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <h3 className="font-semibold text-foreground flex-1 min-w-0">
            {pending.length === 1 ? "Te compartieron un gasto" : "Gastos por confirmar"}
          </h3>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Cerrar"
            className="text-muted-foreground hover:text-foreground p-1 -m-1 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <p className="text-lg font-semibold text-foreground leading-snug">{exp.title}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sharedBy(exp)} · {formatDate(exp.expense_date)}
          </p>
        </div>

        <div className="rounded-xl border-2 border-ink bg-accent/40 p-3 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">Tu parte</span>
            <span className="text-xl font-bold text-foreground tabular-nums">
              {money(mine.amount, mine.currency)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">Total del gasto</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {money(total.amount, total.currency)}
            </span>
          </div>
        </div>

        {/* Aceptar crea el gasto en tus egresos, y eso no se ve en ningún lado
            del diálogo — conviene decirlo antes y no después. */}
        <p className="text-xs text-muted-foreground">
          Si aceptás, se agrega a tus egresos por tu parte.
        </p>

        {error && (
          <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => resolve("reject")}>
            Rechazar
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => resolve("accept")}>
            {busy ? "Guardando..." : "Aceptar"}
          </Button>
        </div>

        {/* El paginador va abajo: se navega entre pendientes sin decidir, pero
            decidir es la acción principal y va primero. */}
        {pending.length > 1 && (
          <div className="flex items-center justify-center gap-4 pt-1">
            <button
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0}
              aria-label="Anterior"
              className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.min(index, pending.length - 1) + 1} de {pending.length}
            </span>
            <button
              onClick={() => setIndex(i => Math.min(pending.length - 1, i + 1))}
              disabled={index >= pending.length - 1}
              aria-label="Siguiente"
              className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </UiCard>
    </div>
  );
}

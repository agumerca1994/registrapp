"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { FileUp, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { features } from "@/lib/features";
import { getErrorMessage } from "@/lib/utils";
import { UploadStatementButton } from "@/components/UploadStatementButton";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { ErrorNote, StatusChip, SubHeader } from "@/components/tarjetas/parts";
import { periodLabel, type SessionRow } from "@/app/(app)/conciliar/shared";

/**
 * Resúmenes subidos: la subida y el historial completo. "Subir resumen" en
 * /tarjetas trae acá en vez de abrir el selector de archivos de una — así, si
 * no elegís nada, igual llegás a los resúmenes ya subidos, incluidos los que
 * están al día (la tarjeta "Resúmenes por revisar" sólo muestra pendientes).
 * La revisión en sí sigue en /conciliar/[id].
 */

function rowLabel(s: SessionRow): string {
  const period = periodLabel(s.period_year, s.period_month);
  return [s.bank ?? "Resumen", period].filter(Boolean).join(" · ");
}

function isPending(s: SessionRow): boolean {
  return s.has_pending || s.status === "needs_choice";
}

function SessionItem({ session: s, confirming, deleting, onAsk, onCancel, onDelete }: {
  session: SessionRow;
  confirming: boolean;
  deleting: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const uploaded = s.created_at ? parseISO(s.created_at) : null;
  const valid = uploaded && !Number.isNaN(uploaded.getTime());
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-1">
        <Link href={`/conciliar/${s.id}`}
          className="flex-1 min-w-0 min-h-[64px] py-2 flex items-center gap-3 md:gap-4 active:opacity-60 transition-opacity">
          <span className="w-[46px] shrink-0">
            {valid && (
              <>
                <span className="sr-only">Subido el {format(uploaded, "d 'de' MMMM", { locale: es })}: </span>
                <span aria-hidden="true">
                  <span className="block font-fecha italic text-[30px] leading-none text-[#3B2FB3]">{format(uploaded, "d")}</span>
                  <span className="font-marca text-xs text-muted-foreground whitespace-nowrap">{format(uploaded, "MMM", { locale: es }).replace(".", "")}</span>
                </span>
              </>
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-[15.5px] text-foreground truncate first-letter:uppercase">{rowLabel(s)}</span>
            <span className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <StatusChip status={s.status} className="px-2 py-0 text-[11px]" />
              {s.item_count > 0 && (
                <span className="text-sm text-muted-foreground truncate">{s.item_count === 1 ? "1 consumo" : `${s.item_count} consumos`}</span>
              )}
            </span>
          </span>
        </Link>
        <button onClick={onAsk} aria-label={`Eliminar el resumen subido de ${rowLabel(s)}`}
          className="w-11 h-11 shrink-0 -mr-2 rounded-full text-muted-foreground flex items-center justify-center active:bg-ink/[0.06] hover:bg-ink/[0.06] transition-colors">
          <Trash2 className="w-[18px] h-[18px]" />
        </button>
      </div>
      {/* Pregunta ahí mismo, sin la ventana del navegador. */}
      {confirming && (
        <div role="alert" className="mb-2.5 rounded-[22px] bg-rose-50 border border-rose-200 p-2.5 animate-fade-in">
          <p className="px-1.5 pb-2 text-[15px] font-medium text-rose-900">¿Eliminar este resumen subido? Los gastos ya cargados no se tocan.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" autoFocus onClick={onCancel}
              className="h-11 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
              No, dejarlo
            </button>
            <button type="button" onClick={onDelete} disabled={deleting}
              className="h-11 rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
              {deleting ? "Eliminando…" : "Sí, eliminar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResumenesPage() {
  const reaccionar = useReaccion();
  // Borrar uno pendiente tiene que apagar el puntito de Tarjetas.
  const { refresh: refreshPending } = usePendingStatements();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<SessionRow[]>("/reconcile");
      setSessions(res.data);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, "No se pudieron cargar los resúmenes. Probá de nuevo en un rato."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (features.reconcile) load();
  }, [load]);

  const { pending, done } = useMemo(() => ({
    pending: sessions.filter(isPending),
    done: sessions.filter(s => !isPending(s)),
  }), [sessions]);

  const handleDelete = async (s: SessionRow) => {
    setError(null);
    setDeleting(true);
    try {
      await api.delete(`/reconcile/${s.id}`);
      reaccionar("borrado", "Resumen eliminado");
      setConfirmId(null);
      await Promise.all([load(), refreshPending()]);
    } catch (e) {
      setError(getErrorMessage(e, "No se pudo eliminar el resumen subido"));
    } finally {
      setDeleting(false);
    }
  };

  const header = (
    <SubHeader title="Resúmenes subidos" backLabel="Volver a Tarjetas" backHref="/tarjetas" />
  );

  if (!features.reconcile) {
    return (
      <div className="space-y-4">
        {header}
        <p className="px-2 text-[15px] text-muted-foreground">Subir resumen no está disponible por ahora.</p>
      </div>
    );
  }

  const list = (rows: SessionRow[]) => rows.map(s => (
    <SessionItem key={s.id} session={s}
      confirming={confirmId === s.id} deleting={deleting}
      onAsk={() => setConfirmId(confirmId === s.id ? null : s.id)}
      onCancel={() => setConfirmId(null)}
      onDelete={() => handleDelete(s)} />
  ));

  return (
    <div className="space-y-4 md:space-y-6">
      {header}

      <section className="rounded-3xl border border-border bg-card p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="flex-1 min-w-0 text-[15px] leading-snug text-[#3F3B4B]">
          Subí el PDF del resumen de tu tarjeta. Se compara con lo que ya cargaste y no cambia nada hasta que lo confirmes.
        </p>
        <div className="self-start sm:self-auto">
          <UploadStatementButton primary />
        </div>
      </section>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-16 rounded-2xl bg-ink/[0.06] animate-pulse" />
          <div className="h-16 rounded-2xl bg-ink/[0.06] animate-pulse" />
          <span className="sr-only">Cargando los resúmenes</span>
        </div>
      ) : sessions.length === 0 ? (
        !error && (
          <div className="px-2 py-6 text-center">
            <FileUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-[19px] font-medium tracking-[-0.02em] text-foreground">Todavía no subiste ningún resumen.</p>
            <p className="mt-1 text-[15px] text-muted-foreground">Cuando subas uno, va a quedar acá.</p>
          </div>
        )
      ) : (
        <>
          {pending.length > 0 && (
            <section className="rounded-3xl bg-accent border border-[#CFC9E4] pt-3.5 px-2.5 pb-1">
              <h3 className="mx-2 mb-1 font-marca text-xs font-normal text-[#3B2FB3]">Por revisar</h3>
              <MotionList className="rounded-2xl bg-white px-3 mb-1.5">{list(pending)}</MotionList>
            </section>
          )}
          {done.length > 0 && (
            <section className="px-2">
              <h3 className="mb-1 text-[22px] font-medium tracking-[-0.03em] text-foreground">Anteriores</h3>
              <MotionList>{list(done)}</MotionList>
            </section>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, FileSearch, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { features } from "@/lib/features";
import { getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { UploadStatementButton } from "@/components/UploadStatementButton";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import { periodLabel, STATUS_CHIP, type SessionRow } from "@/app/(app)/conciliar/shared";

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

function createdLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

function isPending(s: SessionRow): boolean {
  return s.has_pending || s.status === "needs_choice";
}

function SessionList({ title, rows, onDelete }: {
  title: string;
  rows: SessionRow[];
  onDelete: (s: SessionRow) => void;
}) {
  return (
    <Card className="p-0 md:p-0 divide-y">
      <div className="px-4 py-3">
        <h3 className="font-semibold text-foreground text-sm md:text-base">{title}</h3>
      </div>
      {rows.map(s => {
        const chip = STATUS_CHIP[s.status] ?? { label: s.status, tone: "neutral" as const };
        const created = createdLabel(s.created_at);
        const items = s.item_count === 1 ? "1 ítem" : `${s.item_count} ítems`;
        return (
          <div key={s.id} className="flex items-center gap-2 pl-4 pr-2 py-3">
            <Link href={`/conciliar/${s.id}`} className="flex items-center gap-2 flex-1 min-w-0 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {rowLabel(s)}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {created ? `${items} · subido el ${created}` : items}
                </p>
              </div>
              <Chip tone={chip.tone} className="ml-auto shrink-0">{chip.label}</Chip>
            </Link>
            <button onClick={() => onDelete(s)} aria-label="Eliminar resumen subido"
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-600 transition-colors shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </Card>
  );
}

export default function ResumenesPage() {
  const router = useRouter();
  // Borrar uno pendiente tiene que apagar el puntito de Tarjetas.
  const { refresh: refreshPending } = usePendingStatements();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<SessionRow[]>("/reconcile");
      setSessions(res.data);
    } catch (e) {
      setError(getErrorMessage(e, "No se pudieron cargar los resúmenes"));
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
    if (!confirm(`¿Eliminar el resumen subido de ${rowLabel(s)}? Los gastos ya cargados no se tocan.`)) return;
    setError(null);
    try {
      await api.delete(`/reconcile/${s.id}`);
      await Promise.all([load(), refreshPending()]);
    } catch (e) {
      setError(getErrorMessage(e, "No se pudo eliminar"));
    }
  };

  const header = (
    <div className="flex items-center gap-3">
      <button onClick={() => router.push("/tarjetas")} aria-label="Volver a Tarjetas"
        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
        <ChevronLeft className="w-5 h-5" />
      </button>
      <h2 className="text-xl md:text-2xl font-display font-bold text-foreground truncate">Resúmenes subidos</h2>
    </div>
  );

  if (!features.reconcile) {
    return (
      <div className="max-w-4xl space-y-4">
        {header}
        <p className="text-sm text-muted-foreground">Esta función no está disponible.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      {header}

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1 min-w-0 text-sm text-muted-foreground">
            Subí el PDF del resumen de tu tarjeta y RegistrApp carga, corrige y ordena tus gastos.
          </p>
          <div className="self-start sm:self-auto">
            <UploadStatementButton primary />
          </div>
        </div>
      </Card>

      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Cargando...</Card>
      ) : sessions.length === 0 ? (
        <Card className="p-8 text-center">
          <FileSearch className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Todavía no subiste ningún resumen.</p>
          <p className="text-xs text-muted-foreground mt-1">Cuando subas uno, va a quedar acá.</p>
        </Card>
      ) : (
        <>
          {pending.length > 0 && <SessionList title="Por revisar" rows={pending} onDelete={handleDelete} />}
          {done.length > 0 && <SessionList title="Anteriores" rows={done} onDelete={handleDelete} />}
        </>
      )}
    </div>
  );
}

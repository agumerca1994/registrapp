"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { features } from "@/lib/features";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { getErrorMessage } from "@/lib/utils";
import { FileSearch, FileUp, Loader2, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { periodLabel, STATUS_CHIP, type SessionRow } from "./shared";

/**
 * Conciliación de resúmenes: subir el PDF del banco, el backend lo compara
 * contra lo cargado y acá queda la lista de sesiones para seguir revisando.
 * El trabajo de verdad pasa en /conciliar/[id].
 */
export default function ConciliarPage() {
  useAmountsHidden(); // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<SessionRow[]>("/reconcile");
      setSessions(res.data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (features.reconcile) load();
  }, [load]);

  const upload = async (file: File) => {
    if (uploading) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<{ id: number }>("/reconcile", fd);
      router.push(`/conciliar/${res.data.id}`);
      // Sin setUploading(false): la navegación desmonta la pantalla, y apagar
      // el spinner antes la deja un instante como si no hubiera pasado nada.
    } catch (e) {
      setError(getErrorMessage(e));
      setUploading(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // volver a elegir el mismo archivo tiene que disparar de nuevo
    if (file) upload(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  const handleDelete = async (s: SessionRow) => {
    const label = [s.bank, periodLabel(s.period_year, s.period_month)].filter(Boolean).join(" · ") || "esta sesión";
    if (!confirm(`¿Eliminar la conciliación de ${label}? Lo ya aplicado no se toca.`)) return;
    try {
      await api.delete(`/reconcile/${s.id}`);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  if (!features.reconcile) {
    return (
      <div className="max-w-4xl">
        <p className="text-sm text-muted-foreground">Esta función no está disponible.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div>
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Conciliar</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Subí el PDF del resumen de tu tarjeta y compará contra lo cargado.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <Card
        className={dragging ? "border-primary border-dashed" : undefined}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Nuevo resumen</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Arrastrá el PDF acá o elegilo del teléfono. No se guarda el archivo, sólo lo leído.
            </p>
          </div>
          <input ref={fileInput} type="file" accept="application/pdf" className="hidden" onChange={onPick} />
          <Button onClick={() => fileInput.current?.click()} disabled={uploading} className="shrink-0 self-start sm:self-auto">
            {uploading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Leyendo el PDF...</>
              : <><FileUp className="w-4 h-4" /> Subir resumen (PDF)</>}
          </Button>
        </div>
      </Card>

      <Card className="p-0 md:p-0 divide-y">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando...</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center">
            <FileSearch className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              Todavía no conciliaste ningún resumen.
            </p>
          </div>
        ) : (
          sessions.map(s => {
            const chip = STATUS_CHIP[s.status] ?? { label: s.status, tone: "neutral" as const };
            const period = periodLabel(s.period_year, s.period_month);
            return (
              <div key={s.id} className="flex items-center gap-2 p-3 md:p-4">
                <Link href={`/conciliar/${s.id}`} className="flex items-center gap-2 flex-1 min-w-0 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {[s.bank, period].filter(Boolean).join(" · ") || "Resumen sin identificar"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.item_count === 1 ? "1 ítem" : `${s.item_count} ítems`}
                    </p>
                  </div>
                  {/* El chip del estado va pegado al borde derecho de la fila. */}
                  <Chip tone={chip.tone} className="ml-auto shrink-0">{chip.label}</Chip>
                </Link>
                <button onClick={() => handleDelete(s)} aria-label="Eliminar sesión"
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-600 transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import { X, ArrowUp, ArrowDown, Trash2, Plus, RotateCcw, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD, FormGrid, SelectField, SegmentedToggle } from "@/components/ui/form";
import {
  INCOME_TYPE_LABELS, KIND_LABELS, type FieldKind, type IncomeSource, type SourceField,
} from "./types";

interface Row { key: string; id?: number; name: string; kind: FieldKind; has_items: boolean; }

let rowSeq = 0;
const newKey = () => `n${++rowSeq}`;
const toRow = (f: SourceField): Row => ({ key: `f${f.id}`, id: f.id, name: f.name, kind: f.kind, has_items: f.has_items });

/**
 * Alta y edición de una fuente de ingreso, con sus campos de detalle.
 *
 * Una fuente sin campos es el caso simple (nombre + neto). Los campos son lo
 * que permite ver de qué se compuso un neto que varía mes a mes: bruto, bono,
 * aguinaldo, cargas sociales, ganancias…
 *
 * Quitar un campo lo **archiva** en el backend: los ingresos ya cargados
 * conservan sus montos. Por eso los archivados que tienen historia aparecen
 * abajo con "Restaurar", y el tipo de un campo con montos no se puede cambiar.
 */
export function SourceFormModal({ source, onSaved, onClose }: {
  source?: IncomeSource;
  onSaved: (src: IncomeSource) => void | Promise<void>;
  onClose: () => void;
}) {
  const editing = !!source;
  const [name, setName] = useState(source?.name ?? "");
  const [incomeType, setIncomeType] = useState(source?.income_type ?? "salary");
  const [rows, setRows] = useState<Row[]>(
    () => (source?.fields ?? []).filter(f => f.is_active).map(toRow),
  );
  const [archived, setArchived] = useState<Row[]>(
    () => (source?.fields ?? []).filter(f => !f.is_active).map(toRow),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows(rs => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (row: Row) => {
    setRows(rs => rs.filter(r => r.key !== row.key));
    // Un campo existente con montos pasa a "archivados" para poder deshacerlo;
    // uno nuevo o sin historia simplemente desaparece.
    if (row.id && row.has_items) setArchived(a => [...a, row]);
  };
  const restore = (row: Row) => {
    setArchived(a => a.filter(r => r.key !== row.key));
    setRows(rs => [...rs, row]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rows.some(r => !r.name.trim())) { setError("Cada campo necesita un nombre"); return; }
    const names = rows.map(r => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) { setError("Hay dos campos con el mismo nombre"); return; }
    setSaving(true);
    setError("");
    const body = {
      name: name.trim(),
      income_type: incomeType,
      fields: rows.map(r => ({ id: r.id, name: r.name.trim(), kind: r.kind })),
    };
    try {
      const { data } = editing
        ? await api.patch<IncomeSource>(`/income/sources/${source!.id}`, body)
        : await api.post<IncomeSource>("/income/sources", body);
      await onSaved(data);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar la fuente"));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">{editing ? "Editar fuente" : "Nueva fuente"}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <FormGrid>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input className={FIELD} placeholder="Sueldo" autoFocus={!editing}
                value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <SelectField
                value={incomeType}
                onChange={setIncomeType}
                options={Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            </div>
          </FormGrid>

          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-foreground">Detalle <span className="text-muted-foreground font-normal">(opcional)</span></p>
              <p className="text-xs text-muted-foreground">
                Sin campos, el ingreso se carga sólo con el neto. Con campos, el neto se calcula
                como lo que <strong>suma</strong> menos lo que <strong>resta</strong>; <strong>info</strong> se
                guarda para analizar pero no entra en la cuenta.
              </p>
            </div>

            {rows.map((r, i) => (
              <div key={r.key} className="rounded-xl border p-2.5 space-y-2" data-testid="source-field-row">
                <div className="flex items-center gap-1.5">
                  <input className={`${FIELD} mt-0 flex-1`} placeholder="Ej: Impuesto a las ganancias"
                    aria-label="Nombre del campo"
                    value={r.name} onChange={e => update(r.key, { name: e.target.value })} />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Subir"
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-30">
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Bajar"
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-30">
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => remove(r)} title="Quitar campo"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-accent">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <SegmentedToggle<FieldKind>
                  ariaLabel={`Tipo de ${r.name || "campo"}`}
                  value={r.kind}
                  onChange={k => update(r.key, { kind: k })}
                  options={(Object.keys(KIND_LABELS) as FieldKind[]).map(k => ({
                    value: k, label: KIND_LABELS[k],
                    disabled: r.has_items && k !== r.kind,
                  }))} />
                {r.has_items && (
                  <p className="text-[11px] text-muted-foreground">
                    Ya tiene montos cargados: el tipo queda fijo para no cambiar la cuenta de meses anteriores.
                  </p>
                )}
              </div>
            ))}

            <button type="button"
              onClick={() => setRows(rs => [...rs, { key: newKey(), name: "", kind: "add", has_items: false }])}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed text-sm text-muted-foreground hover:bg-accent">
              <Plus className="w-4 h-4" /> Agregar campo
            </button>

            {archived.length > 0 && (
              <div className="pt-1 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Quitados — los ingresos ya cargados conservan sus montos:
                </p>
                {archived.map(r => (
                  <div key={r.key} className="flex items-center justify-between gap-2 text-sm px-2.5 py-1.5 rounded-lg bg-muted">
                    <span className="truncate text-muted-foreground">{r.name} <span className="text-xs">({KIND_LABELS[r.kind]})</span></span>
                    <button type="button" onClick={() => restore(r)}
                      className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                      <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando..." : editing ? "Guardar" : "Crear"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** Lista de fuentes del hogar, desde el ⋮ de Ingresos: el lugar para revisar
 *  y editar todas, no sólo la que está elegida en un formulario abierto. */
export function SourcesListModal({ sources, onEdit, onNew, onClose }: {
  sources: IncomeSource[];
  onEdit: (src: IncomeSource) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Fuentes de ingreso</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay fuentes.</p>
        ) : (
          <div className="divide-y rounded-xl border">
            {sources.map(s => {
              const active = (s.fields ?? []).filter(f => f.is_active);
              return (
                <button key={s.id} type="button" onClick={() => onEdit(s)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent first:rounded-t-xl last:rounded-b-xl">
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate">{s.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {INCOME_TYPE_LABELS[s.income_type]} · {active.length === 0
                        ? "sólo neto"
                        : active.map(f => f.name).join(", ")}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
        <Button type="button" variant="outline" className="w-full" onClick={onNew}>
          <Plus className="w-4 h-4" /> Nueva fuente
        </Button>
      </Card>
    </div>
  );
}

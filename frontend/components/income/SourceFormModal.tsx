"use client";

import { useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus, RotateCcw } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { FIELD, FormGrid, SelectField, SegmentedToggle } from "@/components/ui/form";
import { MotionList } from "@/components/ui/motion-list";
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
    e.stopPropagation();
    if (rows.some(r => !r.name.trim())) { setError("Cada campo necesita un nombre."); return; }
    const names = rows.map(r => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) { setError("Hay dos campos con el mismo nombre."); return; }
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

  const ICON_BTN = "w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[#4A4658] disabled:opacity-30 active:scale-[0.95] transition-transform duration-100";

  return (
    <FormSheet stacked title={editing ? "Editar fuente" : "Nueva fuente"} onClose={onClose}>
      <form onSubmit={submit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <FormGrid>
            <div>
              <label htmlFor="source-name" className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input id="source-name" className={FIELD} placeholder="Sueldo" autoFocus={!editing}
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
            <div className="px-1.5">
              <p className="text-[15px] font-medium text-foreground">Detalle del recibo</p>
              <p className="text-sm leading-snug text-[#4A4658]">
                {rows.length === 0
                  ? "Opcional. Sin campos, cada ingreso de esta fuente guarda sólo el neto."
                  : "Cada ingreso de esta fuente pide estos montos, y el neto sale de ellos."}
              </p>
            </div>
            <MotionList className="space-y-2 empty:hidden">
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-[22px] bg-white/70 border border-white/80 p-2.5 space-y-2" data-testid="source-field-row">
                <div className="flex items-center gap-0.5">
                  <input className={`${FIELD} !mt-0 flex-1 mr-1`} placeholder="Ej: Ganancias"
                    aria-label="Nombre del campo"
                    value={r.name} onChange={e => update(r.key, { name: e.target.value })} />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Subir" aria-label="Subir" className={ICON_BTN}>
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Bajar" aria-label="Bajar" className={ICON_BTN}>
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => remove(r)} title="Quitar campo" aria-label="Quitar campo" className={`${ICON_BTN} text-destructive`}>
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
                {/* Cambiarlo reinterpretaría en silencio la cuenta de meses cerrados. */}
                {r.has_items && (
                  <p className="px-1.5 text-xs text-[#4A4658]">Ya tiene montos cargados: si suma o resta no se puede cambiar.</p>
                )}
              </div>
            ))}
            </MotionList>

            <button type="button"
              onClick={() => setRows(rs => [...rs, { key: newKey(), name: "", kind: "add", has_items: false }])}
              className="w-full h-12 flex items-center justify-center gap-1.5 rounded-[22px] border border-dashed border-muted-foreground/50 text-[15px] font-semibold text-foreground active:scale-[0.98] transition-transform duration-100">
              <Plus className="w-4 h-4" /> Agregar campo
            </button>

            {archived.length > 0 && (
              <div className="pt-1">
                <p className="px-1.5 text-[15px] font-medium text-foreground">Quitados</p>
                <p className="px-1.5 text-sm leading-snug text-[#4A4658]">Los ingresos ya cargados conservan sus montos.</p>
                <div className="mt-1 divide-y divide-ink/[0.08]">
                  {archived.map(r => (
                    <div key={r.key} className="flex items-center justify-between gap-2 px-1.5 min-h-[44px]">
                      <span className="truncate text-[15px] text-foreground">{r.name} <span className="text-sm text-[#4A4658]">({KIND_LABELS[r.kind]})</span></span>
                      <button type="button" onClick={() => restore(r)}
                        className="min-h-[44px] flex items-center gap-1 text-sm font-semibold text-[#3B2FB3] shrink-0">
                        <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label={editing ? "Guardar fuente" : "Crear fuente"} />
      </form>
    </FormSheet>
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
    <FormSheet title="Fuentes de ingreso" onClose={onClose}>
      <div className={FORM_SHEET_BODY}>
        {sources.length === 0 ? (
          <p className="px-1.5 py-2 text-sm text-[#4A4658]">Todavía no hay fuentes. Creá la primera, por ejemplo tu sueldo.</p>
        ) : (
          <div className="divide-y divide-ink/[0.08]">
            {sources.map(s => {
              const active = (s.fields ?? []).filter(f => f.is_active);
              const type = INCOME_TYPE_LABELS[s.income_type];
              const detail = active.length === 0 ? "sólo neto" : active.map(f => f.name).join(", ");
              return (
                <button key={s.id} type="button" onClick={() => onEdit(s)}
                  className="w-full min-h-[56px] px-1.5 py-2 text-left active:scale-[0.99] transition-transform duration-100">
                  <span className="block text-[15.5px] font-semibold text-foreground truncate">{s.name}</span>
                  {/* "Sueldo" de tipo "Sueldo" no se dice dos veces. */}
                  <span className="block text-sm text-[#4A4658] truncate">
                    {type && type !== s.name ? `${type} · ${detail}` : detail}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="shrink-0 px-3.5 pt-2.5 pb-3.5 border-t border-ink/[0.08]">
        <button type="button" onClick={onNew}
          className="w-full h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform duration-100">
          <Plus className="w-4 h-4" /> Nueva fuente
        </button>
      </div>
    </FormSheet>
  );
}

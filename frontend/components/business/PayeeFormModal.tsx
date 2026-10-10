"use client";

import { useState } from "react";
import { X } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD, FormGrid, SelectField, SegmentedToggle } from "@/components/ui/form";
import { PAYEE_KIND_LABELS, type Payee, type PayeeKind } from "./types";

interface Category { id: number; name: string }

/**
 * Alta y edición de un proveedor o empleado.
 *
 * La categoría habitual es lo que hace rápido el formulario de gastos: elegir
 * a Juan propone "Sueldos" sin tener que buscarla. Archivar no borra nada: los
 * gastos ya pagados a esa persona la siguen mostrando.
 */
export function PayeeFormModal({ payee, categories, defaultKind = "proveedor", onSaved, onClose }: {
  payee?: Payee;
  categories: Category[];
  defaultKind?: PayeeKind;
  onSaved: (payee: Payee) => void | Promise<void>;
  onClose: () => void;
}) {
  const editing = !!payee;
  const [name, setName] = useState(payee?.name ?? "");
  const [kind, setKind] = useState<PayeeKind>(payee?.kind ?? defaultKind);
  const [categoryId, setCategoryId] = useState(payee?.default_category_id ? String(payee.default_category_id) : "");
  const [notes, setNotes] = useState(payee?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (patch?: Partial<Payee>) => {
    setSaving(true);
    setError("");
    const body = patch ?? {
      name: name.trim(),
      kind,
      default_category_id: categoryId ? Number(categoryId) : null,
      notes: notes.trim() || null,
    };
    try {
      const { data } = editing
        ? await api.patch<Payee>(`/payees/${payee!.id}`, body)
        : await api.post<Payee>("/payees", body);
      await onSaved(data);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar"));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            {editing ? `Editar ${PAYEE_KIND_LABELS[payee!.kind].toLowerCase()}` : "Nuevo proveedor o empleado"}
          </h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); save(); }} className="space-y-4">
          <SegmentedToggle<PayeeKind>
            ariaLabel="Tipo"
            value={kind}
            onChange={setKind}
            options={(Object.keys(PAYEE_KIND_LABELS) as PayeeKind[]).map(k => ({ value: k, label: PAYEE_KIND_LABELS[k] }))}
          />
          <FormGrid>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input className={FIELD} autoFocus={!editing} required maxLength={120}
                placeholder={kind === "empleado" ? "Juan Pérez" : "Distribuidora Norte"}
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría habitual (opcional)</label>
              <SelectField
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Sin categoría"
                options={categories.map(c => ({ value: String(c.id), label: c.name }))} />
            </div>
          </FormGrid>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notas (opcional)</label>
            <input className={FIELD} maxLength={255}
              placeholder={kind === "empleado" ? "Turno noche" : "Entrega martes y viernes"}
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {editing && (
              <Button type="button" variant="ghost" disabled={saving}
                className="text-muted-foreground mr-auto"
                onClick={() => save({ is_active: !payee!.is_active })}>
                {payee!.is_active ? "Archivar" : "Restaurar"}
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Guardando..." : editing ? "Guardar" : "Crear"}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

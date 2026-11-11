"use client";

import { useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { FIELD, FieldLabel, SelectField, SegmentedToggle } from "@/components/ui/form";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
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
    <FormSheet title={editing ? `Editar ${PAYEE_KIND_LABELS[payee!.kind].toLowerCase()}` : "Nuevo proveedor o empleado"} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); save(); }} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <SegmentedToggle<PayeeKind>
            ariaLabel="Tipo"
            value={kind}
            onChange={setKind}
            options={(Object.keys(PAYEE_KIND_LABELS) as PayeeKind[]).map(k => ({ value: k, label: PAYEE_KIND_LABELS[k] }))}
          />
          <div>
            <FieldLabel>Nombre</FieldLabel>
            <input className={FIELD} autoFocus={!editing} required maxLength={120} aria-label="Nombre"
              placeholder={kind === "empleado" ? "Juan Pérez" : "Distribuidora Norte"}
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <FieldLabel hint="(opcional)">Categoría habitual</FieldLabel>
            <SelectField
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Sin categoría"
              options={categories.map(c => ({ value: String(c.id), label: c.name }))} />
          </div>
          <div>
            <FieldLabel hint="(opcional)">Notas</FieldLabel>
            <input className={FIELD} maxLength={255} aria-label="Notas"
              placeholder={kind === "empleado" ? "Turno noche" : "Entrega martes y viernes"}
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          {editing && (
            <div className="flex items-center justify-between gap-3 px-1.5">
              <Link href={`/expenses?payee_id=${payee!.id}`} className="min-h-[44px] inline-flex items-center font-semibold text-[15px] text-[#3B2FB3]">
                Ver sus gastos
              </Link>
              <button type="button" disabled={saving} onClick={() => save({ is_active: !payee!.is_active })}
                className="min-h-[44px] font-semibold text-[15px] text-muted-foreground disabled:opacity-50">
                {payee!.is_active ? "Archivar" : "Restaurar"}
              </button>
            </div>
          )}
        </div>
        {error && <p role="alert" className="mx-3.5 mb-1 text-sm text-destructive">{error}</p>}
        <FormSheetActions onCancel={onClose} saving={saving} disabled={!name.trim()} label={editing ? "Guardar" : "Crear"} />
      </form>
    </FormSheet>
  );
}

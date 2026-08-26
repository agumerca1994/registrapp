"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/form";

/**
 * Crear una categoría sin salir del formulario que la necesitaba.
 *
 * Vivía dentro de `app/(app)/expenses/page.tsx`. Se mudó acá cuando
 * `/registrar` pasó a necesitar lo mismo: copiarlo era garantizar que dentro de
 * unos meses crear una categoría se vea distinto según desde dónde la creaste.
 *
 * Va en `components/` y no en `components/ui/`: es un modal de un concepto del
 * dominio, no una primitiva. Mismo criterio que `ParticipantPicker`.
 */
export default function NewCategoryModal({ initialColor, onSave, onClose }: {
  initialColor: string;
  onSave: (cat: { name: string; color: string; is_fixed: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ name: "", color: initialColor, is_fixed: false });
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Nueva categoría</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={async e => { e.preventDefault(); setSaving(true); await onSave(form); setSaving(false); }} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input className={FIELD} placeholder="Supermercado" autoFocus
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Color</label>
              <input type="color" className="mt-1 block h-9 w-12 border-2 border-ink rounded-lg cursor-pointer"
                value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={form.is_fixed}
                onChange={e => setForm(p => ({ ...p, is_fixed: e.target.checked }))} />
              Fijo
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Crear"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

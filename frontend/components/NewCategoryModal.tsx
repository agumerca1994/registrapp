"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { FIELD } from "@/components/ui/form";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions, SheetSwitch } from "@/components/movimientos/FormSheet";
import { CATEGORY_COLOR_PALETTE, getErrorMessage } from "@/lib/utils";

// Quince colores y un lugar para elegir otro: dos filas de ocho, sin desplazarse.
const SWATCHES = CATEGORY_COLOR_PALETTE.slice(0, 15);

/**
 * Crear una categoría sin salir del formulario que la necesitaba.
 *
 * Es uno solo para toda la app (Egresos, el resumen de una tarjeta, /registrar):
 * una copia es garantizar que dentro de unos meses crear una categoría se vea
 * distinto según desde dónde la creaste.
 *
 * Va en `components/` y no en `components/ui/`: es un modal de un concepto del
 * dominio, no una primitiva. Mismo criterio que `ParticipantPicker`.
 */
export default function NewCategoryModal({ initialColor, onSave, onClose }: {
  initialColor: string;
  onSave: (cat: { name: string; color: string; is_fixed: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const reaccionar = useReaccion();
  const [form, setForm] = useState({ name: "", color: initialColor, is_fixed: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const custom = !SWATCHES.some(c => c.toLowerCase() === form.color.toLowerCase());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
      reaccionar("guardado", "Categoría creada");
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo crear la categoría."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet stacked title="Nueva categoría" onClose={onClose}>
      <form onSubmit={submit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <div>
            <label htmlFor="new-category-name" className="text-xs font-medium text-muted-foreground">Nombre</label>
            <div className="relative">
              {/* El punto es el que va a tener la categoría en cada lista. */}
              <span aria-hidden="true" className="absolute left-3.5 top-[calc(50%+2px)] -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-colors" style={{ backgroundColor: form.color }} />
              <input id="new-category-name" className={`${FIELD} pl-10`} placeholder="Supermercado" autoFocus required
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
          </div>

          <div role="radiogroup" aria-label="Color">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Color</p>
            <div className="grid grid-cols-8 gap-1.5 justify-items-center">
              {SWATCHES.map(color => {
                const on = color.toLowerCase() === form.color.toLowerCase();
                return (
                  <button key={color} type="button" role="radio" aria-checked={on} aria-label={`Color ${color}`}
                    onClick={() => setForm(p => ({ ...p, color }))}
                    className={`w-[38px] h-[38px] rounded-full flex items-center justify-center text-white transition-transform duration-100 active:scale-[0.92] ${on ? "ring-2 ring-offset-2 ring-offset-card ring-ink" : ""}`}
                    style={{ backgroundColor: color }}>
                    {on && <Check className="w-4 h-4" strokeWidth={3} />}
                  </button>
                );
              })}
              <label title="Otro color"
                className={`relative w-[38px] h-[38px] rounded-full flex items-center justify-center cursor-pointer overflow-hidden ${custom ? "ring-2 ring-offset-2 ring-offset-card ring-ink text-white" : "border border-dashed border-muted-foreground/60 text-muted-foreground"}`}
                style={custom ? { backgroundColor: form.color } : undefined}>
                {custom ? <Check className="w-4 h-4" strokeWidth={3} /> : <Plus className="w-4 h-4" />}
                <input type="color" aria-label="Otro color" className="absolute inset-0 opacity-0 cursor-pointer"
                  value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} />
              </label>
            </div>
          </div>

          {/* Lo lee el asistente para separar lo fijo de lo variable al armar un presupuesto. */}
          <SheetSwitch title="Es un gasto fijo" checked={form.is_fixed} onChange={() => setForm(p => ({ ...p, is_fixed: !p.is_fixed }))}>
            <span className="block text-sm text-[#4A4658]">Como el alquiler: se repite todos los meses.</span>
          </SheetSwitch>

          {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Crear categoría" />
      </form>
    </FormSheet>
  );
}

"use client";

import { useState } from "react";
import { X } from "lucide-react";
import api from "@/lib/api";
import { getErrorMessage, parseAmount } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD, FormGrid, SegmentedToggle } from "@/components/ui/form";
import type { Product } from "@/lib/sales";

type Kind = Product["kind"];
type Unit = Product["unit"];

export const PRODUCT_KIND_LABELS: Record<Kind, string> = { elaborado: "Elaborado", reventa: "Reventa" };
export const UNIT_LABELS: Record<Unit, string> = { unidad: "Unidad", porcion: "Porción", kg: "Kilo" };

/**
 * Alta y edición de un producto.
 *
 * "Elaborado" es lo que el negocio produce (porciones): su materia prima es
 * gasto directo, porque no se puede saber cuánta termina en cada porción.
 * "Reventa" es lo que se compra hecho (12 Coca-Cola) y se vende igual. El
 * precio es el de lista: lo que propone una venta, que después se puede cobrar
 * distinto. Archivar no borra nada: las ventas viejas lo siguen nombrando.
 */
export function ProductFormModal({ product, onSaved, onClose }: {
  product?: Product;
  onSaved: (p: Product) => void | Promise<void>;
  onClose: () => void;
}) {
  const editing = !!product;
  const [name, setName] = useState(product?.name ?? "");
  const [kind, setKind] = useState<Kind>(product?.kind ?? "elaborado");
  const [unit, setUnit] = useState<Unit>(product?.unit ?? "unidad");
  const [price, setPrice] = useState(
    product?.sale_price !== null && product?.sale_price !== undefined && product?.sale_price !== ""
      ? Number(product.sale_price).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (patch?: Partial<Product>) => {
    setSaving(true);
    setError("");
    const body = patch ?? {
      name: name.trim(), kind, unit,
      sale_price: price.trim() ? parseAmount(price) : null,
    };
    try {
      const { data } = editing
        ? await api.patch<Product>(`/products/${product!.id}`, body)
        : await api.post<Product>("/products", body);
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
          <h3 className="font-semibold text-foreground">{editing ? "Editar producto" : "Nuevo producto"}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); save(); }} className="space-y-4">
          <SegmentedToggle<Kind>
            ariaLabel="Tipo de producto"
            value={kind}
            onChange={setKind}
            options={[
              { value: "elaborado", label: "Elaborado" },
              { value: "reventa", label: "Reventa" },
            ]}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            {kind === "elaborado"
              ? "Lo produce el negocio. La materia prima se carga como gasto."
              : "Se compra hecho y se vende igual: entra al stock con la compra."}
          </p>
          <FormGrid>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input className={FIELD} autoFocus={!editing} required maxLength={120}
                placeholder={kind === "elaborado" ? "Empanada de carne" : "Coca-Cola 1,5 L"}
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Precio (opcional)</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={FIELD} aria-label="Precio"
                placeholder="1.500" value={price} onChange={e => setPrice(e.target.value)} />
            </div>
          </FormGrid>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Se vende por</label>
            <SegmentedToggle<Unit>
              ariaLabel="Unidad"
              value={unit}
              onChange={setUnit}
              options={(Object.keys(UNIT_LABELS) as Unit[]).map(u => ({ value: u, label: UNIT_LABELS[u] }))}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {editing && (
              <Button type="button" variant="ghost" disabled={saving} className="text-muted-foreground mr-auto"
                onClick={() => save({ is_active: !product!.is_active })}>
                {product!.is_active ? "Archivar" : "Restaurar"}
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

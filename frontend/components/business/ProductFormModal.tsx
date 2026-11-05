"use client";

import { useState } from "react";
import api from "@/lib/api";
import { getErrorMessage, parseAmount } from "@/lib/utils";
import ProductTour from "@/components/ProductTour";
import { PRODUCT_FORM_STEPS } from "@/components/business/tours";
import { FIELD, FieldLabel, SegmentedToggle } from "@/components/ui/form";
import { AmountField, FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
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
    <>
      <ProductTour tourId="product-form" steps={PRODUCT_FORM_STEPS} />
      <FormSheet title={editing ? "Editar producto" : "Nuevo producto"} onClose={onClose}>
        <form onSubmit={e => { e.preventDefault(); save(); }} className={FORM_SHEET_FORM}>
          <div className={FORM_SHEET_BODY}>
            <div data-tour="product-price">
              <AmountField label="Precio" hint="(opcional)" currency="ARS" placeholder="1.500"
                value={price} onChange={e => setPrice(e.target.value)} />
            </div>
            <div data-tour="product-name">
              <FieldLabel>Nombre</FieldLabel>
              <input className={FIELD} autoFocus={!editing} required maxLength={120} aria-label="Nombre"
                placeholder={kind === "elaborado" ? "Empanada de carne" : "Coca-Cola 1,5 L"}
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div data-tour="product-kind">
              <SegmentedToggle<Kind>
                ariaLabel="Tipo de producto"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "elaborado", label: "Elaborado" },
                  { value: "reventa", label: "Reventa" },
                ]}
              />
              <p className="mt-1.5 px-1.5 text-sm leading-snug text-[#4A4658]">
                {kind === "elaborado"
                  ? "Lo produce el negocio. La materia prima se carga como gasto."
                  : "Se compra hecho y se vende igual: entra al stock con la compra."}
              </p>
            </div>
            <div>
              <FieldLabel>Se vende por</FieldLabel>
              <SegmentedToggle<Unit>
                className="mt-1"
                ariaLabel="Unidad"
                value={unit}
                onChange={setUnit}
                options={(Object.keys(UNIT_LABELS) as Unit[]).map(u => ({ value: u, label: UNIT_LABELS[u] }))}
              />
            </div>
            {editing && (
              <button type="button" disabled={saving} onClick={() => save({ is_active: !product!.is_active })}
                className="min-h-[44px] px-1.5 font-semibold text-[15px] text-muted-foreground disabled:opacity-50">
                {product!.is_active ? "Archivar" : "Restaurar"}
              </button>
            )}
          </div>
          {error && <p role="alert" className="mx-3.5 mb-1 text-sm text-destructive">{error}</p>}
          <FormSheetActions onCancel={onClose} saving={saving} disabled={!name.trim()} data-tour="product-save"
            label={editing ? "Guardar" : "Crear"} />
        </form>
      </FormSheet>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Fab } from "@/components/ui/fab";
import { ProductFormModal, PRODUCT_KIND_LABELS, UNIT_LABELS } from "@/components/business/ProductFormModal";
import type { Product } from "@/lib/sales";

/**
 * El catálogo de un negocio: lo que se vende con un toque desde Ventas. Los
 * archivados quedan abajo, plegados: no se borran porque las ventas viejas los
 * siguen nombrando.
 */
export default function ProductosPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const { data } = await api.get<Product[]>("/products?include_inactive=true");
    setProducts(data);
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const active = products.filter(p => p.is_active);
  const archived = products.filter(p => !p.is_active);
  const close = () => { setEditing(null); setCreating(false); };
  const onSaved = async () => { close(); await load(); };

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Productos</h2>
        <p className="text-sm text-muted-foreground">Lo que vende el negocio. En Ventas se eligen con un toque.</p>
      </div>

      {loading ? (
        <Card className="h-32 animate-pulse" />
      ) : active.length === 0 ? (
        <Card className="p-4 md:p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Todavía no cargaste productos. Sin productos igual podés vender: en Ventas se pone el total.
          </p>
          <Button onClick={() => setCreating(true)}>Agregar producto</Button>
        </Card>
      ) : (
        <Card className="p-0 divide-y overflow-hidden">
          {active.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3" data-testid="product-row">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {PRODUCT_KIND_LABELS[p.kind]} · por {UNIT_LABELS[p.unit].toLowerCase()}
                </p>
              </div>
              <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">
                {p.sale_price !== null && p.sale_price !== "" ? formatARS(p.sale_price) : "Sin precio"}
              </span>
              <button onClick={() => setEditing(p)} title="Editar"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent shrink-0">
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          ))}
        </Card>
      )}

      {archived.length > 0 && (
        <div className="space-y-2">
          <button onClick={() => setShowArchived(v => !v)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            Archivados ({archived.length})
            <ChevronDown className={`w-4 h-4 transition-transform ${showArchived ? "rotate-180" : ""}`} />
          </button>
          {showArchived && (
            <Card className="p-0 divide-y overflow-hidden">
              {archived.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <p className="text-sm text-muted-foreground truncate flex-1">{p.name}</p>
                  <button onClick={() => setEditing(p)} className="text-xs text-primary hover:underline shrink-0">
                    Ver o restaurar
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      <Fab label="Nuevo producto" onClick={() => setCreating(true)} />

      {(creating || editing) && (
        <ProductFormModal product={editing ?? undefined} onSaved={onSaved} onClose={close} />
      )}
    </div>
  );
}

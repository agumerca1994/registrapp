"use client";

import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MoreVertical } from "lucide-react";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Fab } from "@/components/ui/fab";
import { ProductFormModal, PRODUCT_KIND_LABELS, UNIT_LABELS } from "@/components/business/ProductFormModal";
import { StockMovementModal, type StockAction } from "@/components/business/StockMovementModal";
import { StockHistoryModal } from "@/components/business/StockHistoryModal";
import type { StockLevel } from "@/components/business/types";
import type { Product } from "@/lib/sales";

const MENU_ITEM = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-accent outline-none cursor-pointer";

const qty = (n: number | string) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 });

/**
 * El catálogo de un negocio y su stock. Lo que se vende con un toque desde
 * Ventas; los que llevan stock muestran cuánto hay, y en rojo cuando quedó en
 * negativo (se vendió algo cuya producción no se cargó). Los archivados quedan
 * abajo, plegados: no se borran porque las ventas viejas los siguen nombrando.
 */
export default function ProductosPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const [products, setProducts] = useState<Product[]>([]);
  const [levels, setLevels] = useState<Record<number, StockLevel>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<{ action: StockAction; productId?: number } | null>(null);
  const [history, setHistory] = useState<Product | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const [p, s] = await Promise.all([
      api.get<Product[]>("/products?include_inactive=true"),
      api.get<StockLevel[]>("/stock").catch(() => ({ data: [] as StockLevel[] })),
    ]);
    setProducts(p.data);
    setLevels(Object.fromEntries(s.data.map(l => [l.product_id, l])));
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const active = products.filter(p => p.is_active);
  const archived = products.filter(p => !p.is_active);
  const close = () => { setEditing(null); setCreating(false); setMoving(null); };
  const onSaved = async () => { close(); await load(); };

  const stockLine = (p: Product) => {
    const level = levels[p.id];
    if (!p.track_stock || !level) return null;
    const n = Number(level.on_hand);
    if (level.alert === "negativo") {
      return <span className="text-rose-700 font-medium">Stock {qty(n)}: cargá la producción</span>;
    }
    return (
      <span className={level.alert === "bajo" ? "text-amber-700 font-medium" : ""}>
        Hay {qty(n)}{level.alert === "bajo" ? " (poco)" : ""}
      </span>
    );
  };

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Productos</h2>
          <p className="text-sm text-muted-foreground">Lo que vende el negocio y cuánto hay.</p>
        </div>
        {active.length > 0 && (
          <Button variant="outline" className="shrink-0" onClick={() => setMoving({ action: "produccion" })}>
            Cargar producción
          </Button>
        )}
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
                  {stockLine(p) ?? <>{PRODUCT_KIND_LABELS[p.kind]} · por {UNIT_LABELS[p.unit].toLowerCase()}</>}
                </p>
              </div>
              <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">
                {p.sale_price !== null && p.sale_price !== "" ? formatARS(p.sale_price) : "Sin precio"}
              </span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button title="Acciones" aria-label={`Acciones de ${p.name}`}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 outline-none">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} className="bg-card border rounded-xl shadow-lg p-1 w-48 z-50">
                    <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setMoving({ action: "produccion", productId: p.id })}>
                      {p.kind === "reventa" ? "Ingreso" : "Producción"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setMoving({ action: "conteo", productId: p.id })}>
                      Contar lo que queda
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setMoving({ action: "merma", productId: p.id })}>
                      Merma
                    </DropdownMenu.Item>
                    {p.track_stock && (
                      <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setHistory(p)}>
                        Movimientos
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Separator className="h-px bg-border my-1" />
                    <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setEditing(p)}>
                      Editar
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
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
      {moving && (
        <StockMovementModal
          // Un producto de reventa no se "produce": entra.
          action={moving.action === "produccion" && products.find(p => p.id === moving.productId)?.kind === "reventa" ? "compra" : moving.action}
          products={moving.productId ? products : (active.some(p => p.kind === "elaborado") ? active.filter(p => p.kind === "elaborado") : active)}
          productId={moving.productId}
          onSaved={onSaved}
          onClose={close}
        />
      )}
      {history && (
        <StockHistoryModal productId={history.id} productName={history.name}
          onChanged={load} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

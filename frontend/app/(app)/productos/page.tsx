"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MoreVertical } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { isEmployee } from "@/lib/account";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { Fab } from "@/components/ui/fab";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import ProductTour from "@/components/ProductTour";
import { productsIntroSteps } from "@/components/business/tours";
import { EmptyState, GLASS_MENU, GLASS_MENU_ITEM, LoadError, SCREEN_TITLE } from "@/components/business/ui";
import { ProductFormModal, PRODUCT_KIND_LABELS, UNIT_LABELS } from "@/components/business/ProductFormModal";
import { StockMovementModal, type StockAction } from "@/components/business/StockMovementModal";
import { StockHistoryModal } from "@/components/business/StockHistoryModal";
import type { StockLevel } from "@/components/business/types";
import type { Product } from "@/lib/sales";

const qty = (n: number | string) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 });

/**
 * El catálogo de un negocio y su stock. Lo que se vende con un toque desde
 * Ventas; los que llevan stock muestran cuánto hay, y en rojo cuando quedó en
 * negativo (se vendió algo cuya producción no se cargó). Los archivados quedan
 * abajo, plegados: no se borran porque las ventas viejas los siguen nombrando.
 */
export default function ProductosPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const reaccionar = useReaccion();
  // Un empleado lleva el stock (producción, conteos, merma) pero no arma el
  // catálogo: crear y editar productos es del dueño y los socios.
  const router = useRouter();
  const { appUser } = useAuth();
  const canEdit = !isEmployee(appUser);
  const [products, setProducts] = useState<Product[]>([]);
  const [levels, setLevels] = useState<Record<number, StockLevel>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<{ action: StockAction; productId?: number } | null>(null);
  const [history, setHistory] = useState<Product | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const wantsProduce = useRef(false);

  const load = async () => {
    const [p, s] = await Promise.all([
      api.get<Product[]>("/products?include_inactive=true"),
      api.get<StockLevel[]>("/stock").catch(() => ({ data: [] as StockLevel[] })),
    ]);
    setProducts(p.data);
    setLevels(Object.fromEntries(s.data.map(l => [l.product_id, l])));
    // `?produccion=1`, el acceso de Inicio. Sin productos no hay nada que cargar.
    if (wantsProduce.current) {
      wantsProduce.current = false;
      if (p.data.some(x => x.is_active)) setMoving({ action: "produccion" });
    }
  };
  // Sin esto, un error de red se leía como "todavía no cargaste productos".
  const retry = () => {
    setLoading(true);
    setLoadError(false);
    load().catch(() => setLoadError(true)).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("produccion") === "1") {
      wantsProduce.current = true;
      router.replace("/productos");
    }
    retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = products.filter(p => p.is_active);
  const archived = products.filter(p => !p.is_active);
  const close = () => { setEditing(null); setCreating(false); setMoving(null); };
  const onSaved = async () => { close(); await load(); };
  const stockSaved = (action: StockAction) => {
    reaccionar("guardado", action === "merma" ? "Merma cargada"
      : action === "conteo" ? "Conteo guardado"
      : action === "compra" ? "Ingreso cargado" : "Producción cargada");
    return onSaved();
  };
  const steps = useMemo(() => productsIntroSteps({ canEdit }), [canEdit]);
  // Un producto de reventa no se "produce": entra.
  const movingAction: StockAction = moving?.action === "produccion" && products.find(p => p.id === moving.productId)?.kind === "reventa"
    ? "compra" : moving?.action ?? "produccion";

  const stockLine = (p: Product) => {
    const level = levels[p.id];
    if (!p.track_stock || !level) return null;
    const n = Number(level.on_hand);
    if (level.alert === "negativo") {
      return <span className="text-destructive font-medium">Stock {qty(n)}: cargá la producción</span>;
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        {level.alert === "bajo" && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />}
        Hay {qty(n)}{level.alert === "bajo" ? " (poco)" : ""}
      </span>
    );
  };

  return (
    <div className="space-y-3 md:space-y-5 md:pb-16">
      {!loading && !loadError && active.length > 0 && <ProductTour tourId="products-intro" steps={steps} />}
      <div className="flex items-center justify-between gap-3">
        <h1 className={SCREEN_TITLE}>Productos</h1>
        {active.length > 0 && (
          <button data-tour="products-produce" onClick={() => setMoving({ action: "produccion" })}
            className="shrink-0 h-11 px-4 rounded-full bg-ink text-background font-semibold text-[14.5px] active:scale-[0.97] transition-transform duration-100">
            Cargar producción
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-px" aria-busy="true">
          {[0, 1, 2].map(i => <div key={i} className="h-[64px] rounded-2xl bg-ink/[0.04] animate-pulse mb-1" />)}
          <span className="sr-only">Cargando los productos</span>
        </div>
      ) : loadError ? (
        <LoadError message="No se pudo cargar la lista de productos." onRetry={retry} />
      ) : active.length === 0 ? (
        canEdit
          ? <EmptyState text="Todavía no cargaste productos. Sin productos igual podés vender: en Ventas se pone el total."
              action="Agregar producto" onAction={() => setCreating(true)} />
          : <EmptyState text="Todavía no hay productos cargados. Los carga el dueño o un socio." />
      ) : (
        <MotionList className="px-2" data-tour="products-list">
          {active.map((p, i) => (
            <div key={p.id} className="min-h-[64px] py-2 flex items-center gap-2 border-b border-border last:border-b-0" data-testid="product-row">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[15.5px] text-foreground truncate">{p.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {stockLine(p) ?? <>{PRODUCT_KIND_LABELS[p.kind]}, por {UNIT_LABELS[p.unit].toLowerCase()}</>}
                </p>
              </div>
              <span className={`shrink-0 tabular-nums ${p.sale_price !== null && p.sale_price !== "" ? "font-medium text-base text-foreground" : "text-sm text-muted-foreground"}`}>
                {p.sale_price !== null && p.sale_price !== "" ? ledgerAmount(p.sale_price) : "Sin precio"}
              </span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button title="Acciones" aria-label={`Acciones de ${p.name}`} data-tour={i === 0 ? "products-menu" : undefined}
                    className="-mr-2 w-11 h-11 shrink-0 rounded-full text-muted-foreground flex items-center justify-center active:bg-ink/[0.06] outline-none">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} className={GLASS_MENU}>
                    <DropdownMenu.Item className={GLASS_MENU_ITEM} onSelect={() => setMoving({ action: "produccion", productId: p.id })}>
                      {p.kind === "reventa" ? "Ingreso" : "Producción"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={GLASS_MENU_ITEM} onSelect={() => setMoving({ action: "conteo", productId: p.id })}>
                      Contar lo que queda
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={GLASS_MENU_ITEM} onSelect={() => setMoving({ action: "merma", productId: p.id })}>
                      Merma
                    </DropdownMenu.Item>
                    {p.track_stock && (
                      <DropdownMenu.Item className={GLASS_MENU_ITEM} onSelect={() => setHistory(p)}>
                        Movimientos
                      </DropdownMenu.Item>
                    )}
                    {canEdit && (
                      <>
                        <DropdownMenu.Separator className="h-px bg-ink/[0.08] my-1" />
                        <DropdownMenu.Item className={GLASS_MENU_ITEM} onSelect={() => setEditing(p)}>
                          Editar
                        </DropdownMenu.Item>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          ))}
        </MotionList>
      )}

      {canEdit && archived.length > 0 && (
        <MotionList className="px-2">
          <button onClick={() => setShowArchived(v => !v)} aria-expanded={showArchived}
            className="inline-flex items-center gap-1 min-h-[44px] text-[15px] font-medium text-muted-foreground">
            Archivados ({archived.length})
            <ChevronDown className={`w-4 h-4 transition-transform ${showArchived ? "rotate-180" : ""}`} />
          </button>
          {showArchived && archived.map(p => (
            <div key={p.id} className="min-h-[52px] flex items-center gap-3 border-b border-border last:border-b-0">
              <p className="text-[15px] text-muted-foreground truncate flex-1">{p.name}</p>
              <button onClick={() => setEditing(p)} className="min-h-[44px] text-sm font-semibold text-[#3B2FB3] shrink-0">
                Ver o restaurar
              </button>
            </div>
          ))}
        </MotionList>
      )}

      {canEdit && <Fab label="Nuevo producto" data-tour="products-add" onClick={() => setCreating(true)} />}

      {(creating || editing) && (
        <ProductFormModal product={editing ?? undefined} onClose={close}
          onSaved={saved => {
            reaccionar("guardado", !editing ? "Producto creado"
              : saved.is_active === editing.is_active ? "Producto guardado"
              : saved.is_active ? "Producto restaurado" : "Producto archivado");
            return onSaved();
          }} />
      )}
      {moving && (
        <StockMovementModal
          action={movingAction}
          products={moving.productId ? products : (active.some(p => p.kind === "elaborado") ? active.filter(p => p.kind === "elaborado") : active)}
          productId={moving.productId}
          onSaved={() => stockSaved(movingAction)}
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

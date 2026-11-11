"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { Fab } from "@/components/ui/fab";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import ProductTour from "@/components/ProductTour";
import { PAYEES_INTRO_STEPS } from "@/components/business/tours";
import { EmptyState, LoadError, SCREEN_TITLE } from "@/components/business/ui";
import { SegmentedToggle } from "@/components/ui/form";
import { PayeeFormModal } from "@/components/business/PayeeFormModal";
import { PAYEE_KIND_LABELS, type Payee } from "@/components/business/types";

type Filter = "todos" | "proveedor" | "empleado";

interface Category { id: number; name: string }
interface Spend { total: number; total_usd: number }

/**
 * Proveedores y empleados de un negocio: a quién se le paga. Una sola lista
 * con un filtro y no dos pantallas, porque para el libro son lo mismo (ver
 * models/business.py). El monto de cada uno es lo pagado en el mes en curso,
 * por fecha de pago, y lleva a sus gastos.
 */
export default function ProveedoresPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const reaccionar = useReaccion();
  const [payees, setPayees] = useState<Payee[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [spend, setSpend] = useState<Record<number, Spend>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>("todos");
  const [editing, setEditing] = useState<Payee | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const now = new Date();
  const monthLabel = format(now, "MMMM", { locale: es });

  const load = async () => {
    const [p, c, s] = await Promise.all([
      api.get<Payee[]>("/payees?include_inactive=true"),
      api.get<Category[]>("/expenses/categories"),
      api.get(`/business/summary/${now.getFullYear()}/${now.getMonth() + 1}`).catch(() => null),
    ]);
    setPayees(p.data);
    setCategories(c.data);
    const bySpend: Record<number, Spend> = {};
    for (const row of s?.data?.spend_by_payee ?? []) {
      bySpend[row.payee_id] = { total: Number(row.total), total_usd: Number(row.total_usd) };
    }
    setSpend(bySpend);
  };

  // Sin esto, un error de red se leía como "todavía no cargaste proveedores".
  const retry = () => {
    setLoading(true);
    setLoadError(false);
    load().catch(() => setLoadError(true)).finally(() => setLoading(false));
  };
  useEffect(() => {
    retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = payees.filter(p => p.is_active);
  const archived = payees.filter(p => !p.is_active);
  // "Otro" sólo en Todos: no es ni proveedor ni empleado.
  const visible = filter === "todos" ? active : active.filter(p => p.kind === filter);
  const categoryName = (id: number | null) => categories.find(c => c.id === id)?.name;
  const anyPaid = visible.some(p => spend[p.id]?.total || spend[p.id]?.total_usd);

  const close = () => { setEditing(null); setCreating(false); };
  const onSaved = async (payee: Payee) => {
    reaccionar("guardado", editing
      ? (payee.is_active === editing.is_active ? "Cambios guardados" : payee.is_active ? "Restaurado" : "Archivado")
      : payee.kind === "empleado" ? "Empleado agregado"
      : payee.kind === "proveedor" ? "Proveedor agregado" : "Agregado a la lista");
    close();
    await load();
  };

  return (
    <div className="space-y-3 md:space-y-5 md:pb-16">
      {!loading && !loadError && active.length > 0 && <ProductTour tourId="payees-intro" steps={PAYEES_INTRO_STEPS} />}
      <div>
        <h1 className={SCREEN_TITLE}>Proveedores y empleados</h1>
        <p className="mt-0.5 text-[15px] leading-snug text-muted-foreground">
          Elegilos al cargar un gasto y vas a ver cuánto se le pagó a cada uno.
        </p>
      </div>

      <div data-tour="payees-filter" className="max-w-sm">
        <SegmentedToggle<Filter>
          ariaLabel="Mostrar"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "todos", label: "Todos" },
            { value: "proveedor", label: "Proveedores" },
            { value: "empleado", label: "Empleados" },
          ]}
        />
      </div>

      {loading ? (
        <div aria-busy="true">
          {[0, 1, 2].map(i => <div key={i} className="h-[64px] rounded-2xl bg-ink/[0.04] animate-pulse mb-1" />)}
          <span className="sr-only">Cargando la lista</span>
        </div>
      ) : loadError ? (
        <LoadError message="No se pudo cargar la lista de proveedores y empleados." onRetry={retry} />
      ) : visible.length === 0 ? (
        <EmptyState
          text={active.length === 0
            ? "Todavía no cargaste proveedores ni empleados."
            : filter === "empleado" ? "No hay empleados cargados." : "No hay proveedores cargados."}
          action={filter === "empleado" ? "Agregar empleado" : "Agregar proveedor"}
          onAction={() => setCreating(true)} />
      ) : (
        <MotionList className="px-2" data-tour="payees-list">
          {anyPaid && <p className="font-marca text-xs text-muted-foreground text-right pb-0.5">Pagado en {monthLabel}</p>}
          {visible.map(p => {
            const paid = spend[p.id];
            // El tipo va en texto en la segunda línea y no como chip junto al
            // nombre: en el celular el chip y el monto dejaban el nombre en
            // "Distrib…". En un filtro ya se sabe qué es cada uno.
            const detail = [
              filter === "todos" ? PAYEE_KIND_LABELS[p.kind] : null,
              categoryName(p.default_category_id),
              p.notes,
            ].filter(Boolean).join(", ");
            return (
              <div key={p.id} className="min-h-[64px] flex items-stretch gap-2 border-b border-border last:border-b-0" data-testid="payee-row">
                <button type="button" data-no-press onClick={() => setEditing(p)} title="Editar"
                  className="flex-1 min-w-0 py-2 text-left active:opacity-60 transition-opacity">
                  <span className="block font-semibold text-[15.5px] text-foreground truncate">{p.name}</span>
                  {detail && <span className="block text-sm text-muted-foreground truncate">{detail}</span>}
                </button>
                {/* Sin nada pagado en el mes no hay monto que mostrar; sus gastos están en su formulario. */}
                {!!(paid?.total || paid?.total_usd) && (
                  <Link href={`/expenses?payee_id=${p.id}`} title="Ver sus gastos"
                    className="shrink-0 pl-2 flex flex-col items-end justify-center text-right font-medium text-base tabular-nums text-foreground active:opacity-60 transition-opacity">
                    {!!paid.total && <span>{ledgerAmount(paid.total)}</span>}
                    {!!paid.total_usd && <span className="text-sm">{ledgerAmount(paid.total_usd, "USD")}</span>}
                  </Link>
                )}
              </div>
            );
          })}
        </MotionList>
      )}

      {archived.length > 0 && (
        <MotionList className="px-2">
          <button onClick={() => setShowArchived(v => !v)} aria-expanded={showArchived}
            className="inline-flex items-center gap-1 min-h-[44px] text-[15px] font-medium text-muted-foreground">
            Archivados ({archived.length})
            <ChevronDown className={`w-4 h-4 transition-transform ${showArchived ? "rotate-180" : ""}`} />
          </button>
          {showArchived && archived.map(p => (
            <div key={p.id} className="min-h-[52px] flex items-center gap-3 border-b border-border last:border-b-0">
              <p className="text-[15px] text-muted-foreground truncate flex-1">
                {p.name}, {PAYEE_KIND_LABELS[p.kind].toLowerCase()}
              </p>
              <button onClick={() => setEditing(p)} className="min-h-[44px] text-sm font-semibold text-[#3B2FB3] shrink-0">
                Ver o restaurar
              </button>
            </div>
          ))}
        </MotionList>
      )}

      <Fab label="Nuevo proveedor o empleado" data-tour="payees-add" onClick={() => setCreating(true)} />

      {(creating || editing) && (
        <PayeeFormModal
          payee={editing ?? undefined}
          categories={categories}
          defaultKind={filter === "empleado" ? "empleado" : "proveedor"}
          onSaved={onSaved}
          onClose={close}
        />
      )}
    </div>
  );
}

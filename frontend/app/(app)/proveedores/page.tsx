"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, Pencil } from "lucide-react";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Fab } from "@/components/ui/fab";
import { Button } from "@/components/ui/button";
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
  const [payees, setPayees] = useState<Payee[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [spend, setSpend] = useState<Record<number, Spend>>({});
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = payees.filter(p => p.is_active);
  const archived = payees.filter(p => !p.is_active);
  // "Otro" sólo en Todos: no es ni proveedor ni empleado.
  const visible = filter === "todos" ? active : active.filter(p => p.kind === filter);
  const categoryName = (id: number | null) => categories.find(c => c.id === id)?.name;

  const close = () => { setEditing(null); setCreating(false); };
  const onSaved = async () => { close(); await load(); };

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Proveedores y empleados</h2>
        <p className="text-sm text-muted-foreground">
          A quién le paga el negocio. Elegilos al cargar un gasto y vas a ver cuánto se le pagó a cada uno.
        </p>
      </div>

      <SegmentedToggle<Filter>
        ariaLabel="Mostrar"
        className="max-w-sm"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "todos", label: "Todos" },
          { value: "proveedor", label: "Proveedores" },
          { value: "empleado", label: "Empleados" },
        ]}
      />

      {loading ? (
        <Card className="h-32 animate-pulse" />
      ) : visible.length === 0 ? (
        <Card className="p-4 md:p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            {active.length === 0
              ? "Todavía no cargaste proveedores ni empleados."
              : filter === "empleado" ? "No hay empleados cargados." : "No hay proveedores cargados."}
          </p>
          <Button onClick={() => setCreating(true)}>
            {filter === "empleado" ? "Agregar empleado" : "Agregar proveedor"}
          </Button>
        </Card>
      ) : (
        <Card className="p-0 divide-y overflow-hidden">
          {visible.map(p => {
            const paid = spend[p.id];
            // El tipo va en texto en la segunda línea y no como chip junto al
            // nombre: en el celular el chip, el monto y el lápiz dejaban el
            // nombre en "Distrib…". En un filtro ya se sabe qué es cada uno.
            const detail = [
              filter === "todos" ? PAYEE_KIND_LABELS[p.kind] : null,
              categoryName(p.default_category_id),
              p.notes,
            ].filter(Boolean).join(" · ");
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3" data-testid="payee-row">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{p.name}</p>
                  {detail && <p className="text-xs text-muted-foreground truncate mt-0.5">{detail}</p>}
                </div>
                <Link href={`/expenses?payee_id=${p.id}`} title="Ver sus gastos"
                  className="text-right shrink-0 rounded-lg px-2 py-1 -my-1 hover:bg-accent transition-colors">
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {paid?.total ? formatARS(paid.total) : "—"}
                  </p>
                  {!!paid?.total_usd && <p className="text-xs text-emerald-600 tabular-nums">{formatUSD(paid.total_usd)}</p>}
                  <p className="text-[11px] text-muted-foreground">en {monthLabel}</p>
                </Link>
                <button onClick={() => setEditing(p)} title="Editar"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent shrink-0">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            );
          })}
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
                  <p className="text-sm text-muted-foreground truncate flex-1">
                    {p.name} <span className="text-xs">({PAYEE_KIND_LABELS[p.kind]})</span>
                  </p>
                  <button onClick={() => setEditing(p)} className="text-xs text-primary hover:underline shrink-0">
                    Ver o restaurar
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      <Fab label="Nuevo proveedor o empleado" onClick={() => setCreating(true)} />

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

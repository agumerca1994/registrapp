"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { MoreVertical } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Fab } from "@/components/ui/fab";
import { PrivacyMenuItem } from "@/components/ui/privacy-toggle";
import {
  SummaryCard, SummaryHeader, SummarySection, SummaryGrid, SummaryCell, SummaryFigure,
} from "@/components/ui/summary-card";
import { MonthPill } from "@/components/dashboard/MonthPill";
import { BreakdownBarsCard } from "@/components/dashboard/BreakdownBarsCard";

interface CategoryRow {
  category_name: string; color: string | null;
  total: number; total_usd: number; ars_equivalent: number;
}

interface PayeeSpend {
  payee_id: number; name: string; kind: "proveedor" | "empleado" | "otro";
  total: number; total_usd: number; count: number;
}

interface BusinessSummary {
  period: string;
  total_income: number;
  total_expenses: number;
  total_expenses_usd: number;
  balance: number;
  expenses_by_category: CategoryRow[];
  spend_by_payee: PayeeSpend[];
}

// El color dice qué es cada uno, no quién: proveedores y empleados se leen de
// un vistazo como dos grupos en la misma lista.
const PAYEE_COLORS = { proveedor: "#3b82f6", empleado: "#8b5cf6", otro: "#94a3b8" } as const;

/**
 * Inicio de un negocio. Por ahora el lado de los gastos: cuánto salió en el
 * mes, en qué y a quién. El resultado (ventas − egresos) llega con las ventas.
 * Mismas reglas que el dashboard del hogar: por fecha de pago, sin mezclar
 * monedas, y los montos se ocultan con el mismo interruptor.
 */
export default function BusinessHome() {
  const router = useRouter();
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<BusinessSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/business/summary/${year}/${month}`)
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year, month]);

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es });

  const expensesArs = Number(data?.total_expenses ?? 0);
  const expensesUsd = Number(data?.total_expenses_usd ?? 0);
  const empty = !!data && expensesArs === 0 && expensesUsd === 0;

  return (
    <div className="max-w-6xl space-y-4 md:space-y-6">
      <div className="flex justify-end">
        <MonthPill label={periodLabel} onPrev={prev} onNext={next} />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button title="Más acciones"
              className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none">
              <MoreVertical className="w-5 h-5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4}
              className="bg-card border rounded-xl shadow-lg p-1 w-44 z-50">
              <DropdownMenu.Item asChild>
                <PrivacyMenuItem />
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {loading ? (
        <Card variant="hero" className="h-40 animate-pulse" />
      ) : data ? (
        <>
          <SummaryCard>
            <SummaryHeader title={`Gastos de ${periodLabel}`} />
            <SummarySection label="Pagado en el mes" />
            <SummaryGrid>
              <SummaryCell figure>
                <SummaryFigure
                  amount={expensesArs} format={formatARS}
                  sub={expensesUsd > 0 ? `+ ${formatUSD(expensesUsd)} en dólares` : "por fecha de pago"}
                />
              </SummaryCell>
            </SummaryGrid>
          </SummaryCard>

          {empty ? (
            <Card className="p-4 md:p-5 space-y-1">
              <p className="text-sm font-medium text-foreground">Todavía no hay gastos en {periodLabel}.</p>
              <p className="text-sm text-muted-foreground">
                Cargalos con el botón <span className="font-semibold">+</span>, o por WhatsApp
                escribiendo, por ejemplo, <span className="font-mono">45 lucas alquiler</span>.
              </p>
            </Card>
          ) : (
            <div className={data.spend_by_payee.length > 0 ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}>
              {data.expenses_by_category.length > 0 && (
                <BreakdownBarsCard
                  title={`Egresos por categoría — ${periodLabel}`}
                  rows={data.expenses_by_category.map((cat) => ({
                    key: cat.category_name, label: cat.category_name, color: cat.color,
                    total: cat.total, total_usd: cat.total_usd, ars_equivalent: cat.ars_equivalent,
                  }))}
                />
              )}
              {data.spend_by_payee.length > 0 && (
                <BreakdownBarsCard
                  title={`Proveedores y empleados — ${periodLabel}`}
                  rows={data.spend_by_payee.map((p) => ({
                    key: String(p.payee_id), label: p.name, color: PAYEE_COLORS[p.kind],
                    // Sin cotización acá: las barras van por pesos, y lo pagado
                    // en dólares se muestra al lado sin sumarse.
                    total: p.total, total_usd: p.total_usd, ars_equivalent: Number(p.total),
                  }))}
                  footnote={null}
                />
              )}
            </div>
          )}

          {!empty && data.spend_by_payee.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Asigná cada gasto a un proveedor o empleado para ver a quién se le pagó.{" "}
              <Link href="/proveedores" className="text-primary font-medium hover:underline">
                Cargar proveedores y empleados
              </Link>
            </p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">No hay datos para este mes.</p>
      )}

      <Fab label="Registrar gasto" onClick={() => router.push("/expenses?nuevo=1")} />
    </div>
  );
}

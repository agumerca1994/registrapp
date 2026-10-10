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
  SummaryCard, SummaryHeader, SummarySection, SummaryGrid, SummaryCell, SummaryFigure, ChainRow, SummaryTotal,
} from "@/components/ui/summary-card";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/sales";
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
  sales_total: number;
  sales_by_method: { method: PaymentMethod; total: number }[];
  top_products: { product_id: number | null; name: string; qty: number; revenue: number }[];
}

// El color dice qué es cada uno, no quién: proveedores y empleados se leen de
// un vistazo como dos grupos en la misma lista.
const PAYEE_COLORS = { proveedor: "#3b82f6", empleado: "#8b5cf6", otro: "#94a3b8" } as const;
const METHOD_COLORS: Record<PaymentMethod, string> = {
  efectivo: "#10b981", mercadopago: "#0ea5e9", debito: "#6366f1",
  credito: "#8b5cf6", transferencia: "#f59e0b", otro: "#94a3b8",
};

// El signo va pegado al monto, nunca al rótulo (regla de summary-card).
const signedARS = (n: number) => (n < 0 ? `−${formatARS(-n)}` : formatARS(n));

/**
 * Inicio de un negocio: cómo cerró el mes. La respuesta es el resultado
 * (ventas − egresos); la cuenta que llega a él está detrás de "Ver detalle",
 * como en el dashboard del hogar. Mismas reglas que ahí: por fecha de pago,
 * sin mezclar monedas, y los montos se ocultan con el mismo interruptor.
 */
export default function BusinessHome() {
  const router = useRouter();
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<BusinessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);

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

  const income = Number(data?.total_income ?? 0);
  const expensesArs = Number(data?.total_expenses ?? 0);
  const expensesUsd = Number(data?.total_expenses_usd ?? 0);
  const result = Number(data?.balance ?? 0);
  // "Ventas" sólo si todo lo que entró son ventas; si hubo otro ingreso, no.
  const incomeLabel = Number(data?.sales_total ?? 0) === income ? "Ventas" : "Ingresos";
  const empty = !!data && income === 0 && expensesArs === 0 && expensesUsd === 0;

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
            <SummaryHeader title={`Resultado de ${periodLabel}`}
              open={showDetail} onToggle={() => setShowDetail(v => !v)} />
            <SummarySection label={`${incomeLabel} − egresos`} />
            <SummaryGrid>
              <SummaryCell figure>
                <SummaryFigure amount={result} format={signedARS} sub="por fecha de pago" />
              </SummaryCell>
              {showDetail && (
                <SummaryCell className="border-t border-border/60">
                  <ChainRow label={incomeLabel} sign="+" value={formatARS(income)} />
                  <ChainRow label="Egresos" sign="−" value={formatARS(expensesArs)} />
                </SummaryCell>
              )}
            </SummaryGrid>
            {showDetail && <SummaryTotal label="Resultado" items={[signedARS(result)]} />}
          </SummaryCard>
          {expensesUsd > 0 && (
            <p className="text-xs text-muted-foreground -mt-2 md:-mt-4">
              Además se pagaron {formatUSD(expensesUsd)}, que no entran en el resultado en pesos.
            </p>
          )}

          {empty ? (
            <Card className="p-4 md:p-5 space-y-1">
              <p className="text-sm font-medium text-foreground">Todavía no hay movimientos en {periodLabel}.</p>
              <p className="text-sm text-muted-foreground">
                Cargá una venta con el botón <span className="font-semibold">+</span> o cerrá el día
                en <Link href="/ventas" className="text-primary font-medium hover:underline">Ventas</Link>.
                Los gastos van en <Link href="/expenses" className="text-primary font-medium hover:underline">Egresos</Link>,
                o por WhatsApp: <span className="font-mono">45 lucas alquiler</span>.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.sales_by_method.length > 0 && (
                <BreakdownBarsCard
                  title={`Ventas por medio de pago — ${periodLabel}`}
                  rows={data.sales_by_method.map((m) => ({
                    key: m.method, label: PAYMENT_METHOD_LABELS[m.method], color: METHOD_COLORS[m.method],
                    total: m.total, total_usd: 0, ars_equivalent: Number(m.total),
                  }))}
                />
              )}
              {data.top_products.length > 0 && (
                <BreakdownBarsCard
                  title={`Lo más vendido — ${periodLabel}`}
                  rows={data.top_products.map((p, i) => ({
                    key: `${p.product_id ?? "libre"}-${i}`,
                    label: `${p.name} × ${Number(p.qty).toLocaleString("es-AR")}`,
                    color: "#f97316",
                    total: p.revenue, total_usd: 0, ars_equivalent: Number(p.revenue),
                  }))}
                />
              )}
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
                />
              )}
            </div>
          )}

          {!empty && expensesArs > 0 && data.spend_by_payee.length === 0 && (
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

      {/* Lo de todos los días en un comercio es vender: el `+` de Inicio abre una
          venta. Los gastos tienen su `+` en Egresos. */}
      <Fab label="Nueva venta" onClick={() => router.push("/ventas?nueva=1")} />
    </div>
  );
}

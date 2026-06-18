"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { formatARS, formatPct } from "@/lib/utils";
import { TrendingUp, TrendingDown, Wallet, Percent } from "lucide-react";

interface MonthSummary {
  period: string;
  total_income: number;
  total_expenses: number;
  balance: number;
  mortgage_payment: number | null;
  uva_value: number | null;
  inflation_pct: number | null;
  expenses_by_category: { category_name: string; total: number; color?: string }[];
}

function StatCard({ label, value, icon: Icon, positive }: {
  label: string; value: string; icon: React.ElementType; positive?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border p-3 md:p-5 flex items-center gap-3">
      <div className={`p-2 md:p-3 rounded-lg shrink-0 ${positive === false ? "bg-red-50 text-red-500" : positive ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"}`}>
        <Icon className="w-4 h-4 md:w-5 md:h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm md:text-lg font-bold text-gray-900 truncate">{value}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MonthSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/dashboard/summary/${year}/${month}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [year, month]);

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es });

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 capitalize truncate">{periodLabel}</h2>
        <div className="flex gap-1 md:gap-2 shrink-0">
          <button onClick={prev} className="px-2 md:px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">‹</button>
          <button onClick={next} className="px-2 md:px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">›</button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Cargando...</div>
      ) : data ? (
        <>
          {/* Stat cards — 2 cols on mobile, 4 on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <StatCard label="Ingresos" value={formatARS(data.total_income)} icon={TrendingUp} positive={true} />
            <StatCard label="Egresos" value={formatARS(data.total_expenses)} icon={TrendingDown} positive={false} />
            <StatCard label="Balance" value={formatARS(data.balance)} icon={Wallet} positive={data.balance >= 0} />
            {data.inflation_pct !== null && (
              <StatCard label="Inflación" value={formatPct(data.inflation_pct)} icon={Percent} />
            )}
          </div>

          {/* Mortgage */}
          {data.mortgage_payment && (
            <div className="bg-white rounded-xl border p-4 md:p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-700">Cuota hipotecaria</p>
                {data.total_income > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatPct((data.mortgage_payment / data.total_income) * 100)} del ingreso
                  </p>
                )}
              </div>
              <p className="text-xl md:text-2xl font-bold text-primary shrink-0">{formatARS(data.mortgage_payment)}</p>
            </div>
          )}

          {/* Expenses by category */}
          {data.expenses_by_category.length > 0 && (
            <div className="bg-white rounded-xl border p-4 md:p-5">
              <h3 className="font-semibold text-gray-900 mb-3 text-sm md:text-base">Egresos por categoría</h3>
              <div className="space-y-2.5">
                {data.expenses_by_category.map((cat) => (
                  <div key={cat.category_name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || "#6366f1" }} />
                        <span className="text-sm text-gray-700 truncate">{cat.category_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className="text-sm font-medium">{formatARS(cat.total)}</span>
                        <span className="text-xs text-muted-foreground">
                          ({formatPct((cat.total / data.total_expenses) * 100)})
                        </span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(cat.total / data.total_expenses) * 100}%`,
                          backgroundColor: cat.color || "#6366f1",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">No hay datos para este mes.</p>
      )}
    </div>
  );
}

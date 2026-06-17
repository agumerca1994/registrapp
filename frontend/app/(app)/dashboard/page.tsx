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
    <div className="bg-white rounded-xl border p-5 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${positive === false ? "bg-red-50 text-red-500" : positive ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-gray-900">{value}</p>
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

  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es });

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 capitalize">{periodLabel}</h2>
        <div className="flex gap-2">
          <button onClick={() => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); }}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">‹ Anterior</button>
          <button onClick={() => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); }}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">Siguiente ›</button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Cargando...</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Ingresos" value={formatARS(data.total_income)} icon={TrendingUp} positive={true} />
            <StatCard label="Egresos" value={formatARS(data.total_expenses)} icon={TrendingDown} positive={false} />
            <StatCard label="Balance" value={formatARS(data.balance)} icon={Wallet}
              positive={data.balance >= 0 ? true : false} />
            {data.inflation_pct !== null && (
              <StatCard label="Inflación del mes" value={formatPct(data.inflation_pct)} icon={Percent} />
            )}
          </div>

          {data.mortgage_payment && (
            <div className="bg-white rounded-xl border p-5">
              <p className="text-sm font-medium text-gray-700">Cuota hipotecaria</p>
              <p className="text-2xl font-bold text-primary mt-1">{formatARS(data.mortgage_payment)}</p>
              {data.total_income > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatPct((data.mortgage_payment / data.total_income) * 100)} del ingreso total
                </p>
              )}
            </div>
          )}

          {data.expenses_by_category.length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Egresos por categoría</h3>
              <div className="space-y-3">
                {data.expenses_by_category.map((cat) => (
                  <div key={cat.category_name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: cat.color || "#6366f1" }}
                      />
                      <span className="text-sm text-gray-700">{cat.category_name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">{formatARS(cat.total)}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({formatPct((cat.total / data.total_expenses) * 100)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">No hay datos para este mes.</p>
      )}
    </div>
  );
}

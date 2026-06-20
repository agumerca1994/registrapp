"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import api from "@/lib/api";
import { formatARS, formatPct } from "@/lib/utils";
import { TrendingUp, TrendingDown, Wallet, Percent } from "lucide-react";

interface MonthSummary {
  period: string;
  total_income: number;
  total_expenses: number;
  balance: number;
  mortgage_payment: number | null;
  mortgage_is_projected: boolean;
  uva_value: number | null;
  inflation_pct: number | null;
  expenses_by_category: { category_name: string; total: number; color?: string }[];
}

interface HistoryPoint { period: string; total_income: number; }

interface MacroPoint {
  period_date: string;
  inflation_monthly_pct: number | null;
  usd_official: number | null;
}

interface ExpenseEntry { id: number; category_id: number; amount: number; }
interface ExpenseCategory { id: number; name: string; color?: string; }
interface IncomeEntry { id: number; source_id: number; amount: number; }
interface IncomeSource { id: number; name: string; }

const PIE_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#f43f5e","#06b6d4"];

function fmtPeriod(p: string): string {
  try { return format(parseISO(`${p}-01`), "MMM yy", { locale: es }); }
  catch { return p; }
}

function StatCard({ label, value, icon: Icon, positive }: {
  label: string; value: string; icon: React.ElementType; positive?: boolean;
}) {
  const incomePieData = (() => {
    const total = incEntries.reduce((s, e) => s + Number(e.amount), 0);
    if (total === 0) return [];
    return incSources
      .map((src, i) => ({
        name: src.name,
        value: incEntries.filter(e => e.source_id === src.id).reduce((s, e) => s + Number(e.amount), 0),
        color: PIE_COLORS[i % PIE_COLORS.length],
        pct: 0,
      }))
      .filter(d => d.value > 0)
      .map(d => ({ ...d, pct: parseFloat(((d.value / total) * 100).toFixed(1)) }));
  })();

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PctTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium text-gray-700 mb-1.5">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{Number(p.value).toFixed(1)}%</strong>
        </p>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieCustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium" style={{ color: d.payload.color }}>{d.name}</p>
      <p className="text-gray-700">{formatARS(d.value)}</p>
      <p className="text-muted-foreground">{d.payload.pct}%</p>
    </div>
  );
}

export default function DashboardPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MonthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [macro, setMacro] = useState<MacroPoint[]>([]);
  const [expEntries, setExpEntries] = useState<ExpenseEntry[]>([]);
  const [expCategories, setExpCategories] = useState<ExpenseCategory[]>([]);
  const [incEntries, setIncEntries] = useState<IncomeEntry[]>([]);
  const [incSources, setIncSources] = useState<IncomeSource[]>([]);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/dashboard/summary/${year}/${month}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/history"),
      api.get("/macro"),
      api.get("/expenses/entries"),
      api.get("/expenses/categories"),
      api.get("/income/entries"),
      api.get("/income/sources"),
    ]).then(([h, m, e, c, ie, is_]) => {
      setHistoryData(h.data);
      setMacro(m.data);
      setExpEntries(e.data);
      setExpCategories(c.data);
      setIncEntries(ie.data);
      setIncSources(is_.data);
    }).finally(() => setChartsLoading(false));
  }, []);

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es });

  const incomeTrendData = (() => {
    if (historyData.length < 2) return [];
    return historyData.slice(1).map((curr, i) => {
      const p = historyData[i];
      const prevInc = Number(p.total_income);
      const currInc = Number(curr.total_income);
      const incChg = prevInc > 0 ? ((currInc - prevInc) / prevInc) * 100 : 0;
      const macroRow = macro.find(r => r.period_date.startsWith(curr.period));
      const prevMacroRow = macro.find(r => r.period_date.startsWith(p.period));
      const usdCurr = macroRow?.usd_official != null ? Number(macroRow.usd_official) : null;
      const usdPrev = prevMacroRow?.usd_official != null ? Number(prevMacroRow.usd_official) : null;
      const usdChg = usdCurr != null && usdPrev != null && usdPrev > 0
        ? ((usdCurr - usdPrev) / usdPrev) * 100 : null;
      return {
        label: fmtPeriod(curr.period),
        Ingreso: parseFloat(incChg.toFixed(1)),
        Inflacion: macroRow?.inflation_monthly_pct != null
          ? parseFloat(Number(macroRow.inflation_monthly_pct).toFixed(1)) : null,
        Dolar: usdChg != null ? parseFloat(usdChg.toFixed(1)) : null,
      };
    });
  })();

  const pieData = (() => {
    const total = expEntries.reduce((s, e) => s + Number(e.amount), 0);
    if (total === 0) return [];
    return expCategories
      .map((c, i) => ({
        name: c.name,
        value: expEntries.filter(e => e.category_id === c.id).reduce((s, e) => s + Number(e.amount), 0),
        color: c.color || PIE_COLORS[i % PIE_COLORS.length],
        pct: 0,
      }))
      .filter(d => d.value > 0)
      .map(d => ({ ...d, pct: parseFloat(((d.value / total) * 100).toFixed(1)) }));
  })();

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">

      <div className="flex items-center gap-2">
        <button onClick={prev} className="p-2 rounded-lg border hover:bg-gray-50 text-gray-600 text-sm font-bold leading-none">&#8249;</button>
        <span className="text-sm md:text-base font-semibold text-gray-800 capitalize min-w-[130px] text-center">{periodLabel}</span>
        <button onClick={next} className="p-2 rounded-lg border hover:bg-gray-50 text-gray-600 text-sm font-bold leading-none">&#8250;</button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="bg-white rounded-xl border p-4 h-20 animate-pulse" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Ingresos" value={formatARS(data.total_income)} icon={TrendingUp} positive={true} />
            <StatCard label="Egresos" value={formatARS(data.total_expenses)} icon={TrendingDown} positive={false} />
            <StatCard label="Balance" value={formatARS(data.balance)} icon={Wallet} positive={data.balance >= 0} />
            {data.inflation_pct !== null && (
              <StatCard label="Inflación" value={formatPct(data.inflation_pct)} icon={Percent} />
            )}
          </div>

          {data.mortgage_payment && (
            <div className="bg-white rounded-xl border p-4 md:p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Cuota hipotecaria
                  {data.mortgage_is_projected && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">(estimado)</span>
                  )}
                </p>
                {data.total_income > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatPct((data.mortgage_payment / data.total_income) * 100)} del ingreso
                  </p>
                )}
              </div>
              <p className="text-xl md:text-2xl font-bold text-primary shrink-0">{formatARS(data.mortgage_payment)}</p>
            </div>
          )}

          {data.expenses_by_category.length > 0 && (
            <div className="bg-white rounded-xl border p-4 md:p-5">
              <h3 className="font-semibold text-gray-900 mb-3 text-sm md:text-base">
                {"Egresos por categoría"} — {periodLabel}
              </h3>
              <div className="space-y-2.5">
                {data.expenses_by_category.map(cat => (
                  <div key={cat.category_name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || "#6366f1" }} />
                        <span className="text-sm text-gray-700 truncate">{cat.category_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className="text-sm font-medium">{formatARS(cat.total)}</span>
                        <span className="text-xs text-muted-foreground">({formatPct((cat.total / data.total_expenses) * 100)})</span>
                      </div>
                    </div>
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full"
                        style={{ width: `${(cat.total / data.total_expenses) * 100}%`, backgroundColor: cat.color || "#6366f1" }} />
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

      {mounted && !chartsLoading && (
        <div className="space-y-4">
          {incomeTrendData.length > 0 && (
            <div className="bg-white rounded-xl border p-4 md:p-5">
              <h3 className="font-semibold text-gray-900 mb-4 text-sm md:text-base">
                {"Variación mensual: Ingreso / Inflación / Dólar"}
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={incomeTrendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} width={42} />
                  <Tooltip content={<PctTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Ingreso" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="Inflacion" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls />
                  <Line type="monotone" dataKey="Dolar" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {pieData.length > 0 && (
            <div className="bg-white rounded-xl border p-4 md:p-5">
              <h3 className="font-semibold text-gray-900 mb-4 text-sm md:text-base">
                {"Distribución de egresos por categoría"}
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieCustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {incomePieData.length > 0 && (
            <div className="bg-white rounded-xl border p-4 md:p-5">
              <h3 className="font-semibold text-gray-900 mb-4 text-sm md:text-base">
                {"Distribución de ingresos por fuente"}
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={incomePieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {incomePieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieCustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  LineChart, Line, BarChart, Bar,
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
  uva_value: number | null;
  inflation_pct: number | null;
  expenses_by_category: { category_name: string; total: number; color?: string }[];
}

interface HistoryPoint {
  period: string;
  total_income: number;
  total_expenses: number;
  mortgage_payment: number | null;
  uva_value: number | null;
  inflation_pct: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function abbrevARS(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function fmtPeriod(p: string): string {
  try { return format(parseISO(`${p}-01`), "MMM yy", { locale: es }); }
  catch { return p; }
}

function xInterval(len: number): number {
  if (len <= 8) return 0;
  if (len <= 16) return 1;
  if (len <= 30) return 2;
  return Math.floor(len / 10);
}

// ── Stat card ─────────────────────────────────────────────────────────────────

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

// ── Chart helpers ─────────────────────────────────────────────────────────────

function ChartPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${active ? "bg-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
      {label}
    </button>
  );
}

function ChartTooltip({ active, payload, label, isPct }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[];
  label?: string; isPct?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium text-gray-700 mb-1.5">{label ? fmtPeriod(label) : ""}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{isPct ? formatPct(p.value) : formatARS(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

// ── Individual charts ─────────────────────────────────────────────────────────

function IncomeVsMortgageChart({ data }: { data: HistoryPoint[] }) {
  const d = data.filter(p => p.mortgage_payment !== null);
  if (!d.length) return <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de cuota hipotecaria</p>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="period" tickFormatter={fmtPeriod} interval={xInterval(d.length)} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={abbrevARS} tick={{ fontSize: 11 }} width={60} />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="total_income" name="Sueldo neto" stroke="#22c55e" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="mortgage_payment" name="Cuota hipotecaria" stroke="#f97316" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function MortgagePctChart({ data }: { data: HistoryPoint[] }) {
  const d = data
    .filter(p => p.mortgage_payment !== null && Number(p.total_income) > 0)
    .map(p => ({
      period: p.period,
      pct: Math.round((Number(p.mortgage_payment) / Number(p.total_income)) * 1000) / 10,
    }));
  if (!d.length) return <p className="text-sm text-muted-foreground py-8 text-center">Sin datos suficientes</p>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="period" tickFormatter={fmtPeriod} interval={xInterval(d.length)} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} width={45} domain={[0, "auto"]} />
        <Tooltip content={<ChartTooltip isPct />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="pct" name="% cuota/sueldo" stroke="#8b5cf6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function IncomeVsExpensesChart({ data }: { data: HistoryPoint[] }) {
  const d = data.filter(p => Number(p.total_income) > 0 || Number(p.total_expenses) > 0);
  if (!d.length) return <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de ingresos/egresos</p>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="period" tickFormatter={fmtPeriod} interval={xInterval(d.length)} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={abbrevARS} tick={{ fontSize: 11 }} width={60} />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="total_income" name="Ingresos" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={20} />
        <Bar dataKey="total_expenses" name="Egresos" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function UvaChart({ data }: { data: HistoryPoint[] }) {
  const d = data.filter(p => p.uva_value !== null);
  if (!d.length) return <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de UVA</p>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="period" tickFormatter={fmtPeriod} interval={xInterval(d.length)} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={abbrevARS} tick={{ fontSize: 11 }} width={60} />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="uva_value" name="Valor UVA" stroke="#3b82f6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const CHART_OPTIONS = [
  { key: "incomeVsMortgage", label: "Sueldo vs Cuota" },
  { key: "mortgagePct",      label: "% Cuota/Sueldo" },
  { key: "incomeVsExpenses", label: "Ingresos vs Egresos" },
  { key: "uva",              label: "Evolución UVA" },
] as const;

type ChartKey = typeof CHART_OPTIONS[number]["key"];

export default function DashboardPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MonthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [visible, setVisible] = useState<Record<ChartKey, boolean>>({
    incomeVsMortgage: true,
    mortgagePct: true,
    incomeVsExpenses: true,
    uva: true,
  });

  useEffect(() => {
    setLoading(true);
    api.get(`/dashboard/summary/${year}/${month}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => {
    api.get("/dashboard/history").then(r => setHistoryData(r.data));
  }, []);

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es });
  const toggleChart = (key: ChartKey) => setVisible(v => ({ ...v, [key]: !v[key] }));

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">

      {/* ── Monthly summary ── */}
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
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

          {data.expenses_by_category.length > 0 && (
            <div className="bg-white rounded-xl border p-4 md:p-5">
              <h3 className="font-semibold text-gray-900 mb-3 text-sm md:text-base">Egresos por categoría</h3>
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

      {/* ── Historical charts ── */}
      <div className="pt-2 border-t">
        <div className="flex items-center justify-between mb-3 gap-2 pt-4">
          <h3 className="text-base md:text-lg font-bold text-gray-900">Gráficos históricos</h3>
          {historyData.length > 0 && (
            <span className="text-xs text-muted-foreground">{historyData.length} meses de datos</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {CHART_OPTIONS.map(o => (
            <ChartPill key={o.key} label={o.label} active={visible[o.key]} onClick={() => toggleChart(o.key)} />
          ))}
        </div>

        {historyData.length === 0 ? (
          <div className="bg-white rounded-xl border p-10 text-center text-sm text-muted-foreground">
            No hay datos históricos aún.
          </div>
        ) : !CHART_OPTIONS.some(o => visible[o.key]) ? (
          <div className="bg-white rounded-xl border p-8 text-center text-sm text-muted-foreground">
            Seleccioná al menos un gráfico.
          </div>
        ) : (
          <div className="space-y-4">
            {visible.incomeVsMortgage && (
              <div className="bg-white rounded-xl border p-4 md:p-5">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">Sueldo neto vs Cuota hipotecaria</h4>
                <IncomeVsMortgageChart data={historyData} />
              </div>
            )}
            {visible.mortgagePct && (
              <div className="bg-white rounded-xl border p-4 md:p-5">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">% de la cuota sobre el sueldo</h4>
                <MortgagePctChart data={historyData} />
              </div>
            )}
            {visible.incomeVsExpenses && (
              <div className="bg-white rounded-xl border p-4 md:p-5">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">Ingresos vs Egresos por mes</h4>
                <IncomeVsExpensesChart data={historyData} />
              </div>
            )}
            {visible.uva && (
              <div className="bg-white rounded-xl border p-4 md:p-5">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">Evolución del valor UVA</h4>
                <UvaChart data={historyData} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

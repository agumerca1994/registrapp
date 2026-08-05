"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import api from "@/lib/api";
import { formatARS, formatUSD, formatPct } from "@/lib/utils";
import Link from "next/link";
import { TrendingUp, TrendingDown, Gauge, CircleDollarSign, Home, CalendarDays, ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import ProductTour from "@/components/ProductTour";
import type { Step } from "react-joyride";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";

const DASHBOARD_TOUR_STEPS: Step[] = [
  {
    target: "[data-tour='nav-dashboard']",
    content: "Este es tu Dashboard: un resumen mensual de ingresos, egresos y balance.",
    placement: "right",
    skipBeacon: true,
  },
  {
    target: "[data-tour='nav-income']",
    content: "En Ingresos registrás tus sueldos u otras entradas de dinero, con bruto/deducciones/neto.",
    placement: "right",
  },
  {
    target: "[data-tour='nav-expenses']",
    content: "En Egresos cargás tus gastos del mes, organizados por categoría.",
    placement: "right",
  },
  {
    target: "[data-tour='nav-shared']",
    content: "Gastos compartidos te permite dividir un gasto con otras personas, del hogar o invitadas por WhatsApp/email.",
    placement: "right",
  },
  {
    target: "[data-tour='nav-tarjetas']",
    content: "En Tarjetas administrás tus resúmenes de tarjeta de crédito, incluyendo compras en cuotas.",
    placement: "right",
  },
  {
    target: "[data-tour='nav-calendario']",
    content: "El Calendario de pagos te muestra los vencimientos de tarjetas y tus recordatorios de pago.",
    placement: "right",
  },
];

interface MonthSummary {
  period: string;
  total_income: number;
  total_expenses: number;
  total_expenses_usd: number;
  balance: number;
  fx_bought_ars: number;
  fx_sold_ars: number;
  ars_available: number;
  usd_holding: number;
  usd_holding_ars: number | null;
  usd_rate: number | null;
  usd_rate_type: string;
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

interface ExpenseEntry { id: number; category_id: number; amount: number; expense_date: string; description: string | null; currency: string; }
interface ExpenseCategory { id: number; name: string; color?: string; }
interface IncomeEntry { id: number; source_id: number; amount: number; period_date: string; }
interface IncomeSource { id: number; name: string; }

interface MortgageLoan { id: number; is_active: boolean; total_cuotas: number; }
interface MortgageSummary {
  loan: MortgageLoan;
  cuota_numero: number;
  pct_completado: number;
  cuota_pesos_calculado: number | null;
  next_payment_date: string;
}

// Brand-derived categorical palette (violet primary first, then a set of
// distinct accents already used elsewhere in the app for chips/statuses).
const PIE_COLORS = ["#5B4FE9","#10b981","#f59e0b","#f43f5e","#0ea5e9","#14b8a6","#f97316","#ec4899","#8b5cf6","#64748b"];

function fmtPeriod(p: string): string {
  try { return format(parseISO(`${p}-01`), "MMM yy", { locale: es }); }
  catch { return p; }
}

const STAT_TONES = {
  positive: "bg-emerald-50 text-emerald-600",
  negative: "bg-rose-50 text-rose-600",
  usd: "bg-amber-50 text-amber-600",
  neutral: "bg-accent text-primary",
} as const;

// Balance now lives in its own hero panel above this row, so every stat
// here is a secondary/flat tile — borderless, just icon + text, per the v3
// mockup (no card around secondary stats).
function StatCard({ label, value, sub, icon: Icon, tone = "neutral" }: {
  label: string; value: string; sub?: string; icon: React.ElementType; tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className="p-3 md:p-5 flex items-center gap-3">
      <div className={`p-2 md:p-3 rounded-xl shrink-0 ${STAT_TONES[tone]}`}>
        <Icon className="w-4 h-4 md:w-5 md:h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm md:text-base font-bold text-foreground break-words">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function compactAmount(n: number): string {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

interface DonutDatum { name: string; value: number; color: string; pct: number }

// Donut with the total centered inside the ring + a custom side legend,
// replacing Recharts' default below-chart legend — matches the v3 mockup's
// "Distribución de Gastos" / "Fuentes de Ingreso" treatment.
function DonutChartCard({ title, subtitle, data, centerLabel, formatValue = formatARS, currencyPrefix = "$" }: {
  title: string; subtitle: string; data: DonutDatum[]; centerLabel: string;
  formatValue?: (n: number) => string; currencyPrefix?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card className="p-4 md:p-5">
      <h3 className="font-semibold text-foreground mb-4 text-sm md:text-base">
        {title} — {subtitle}
      </h3>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="relative shrink-0 w-full sm:w-[220px] h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
                innerRadius={68} outerRadius={100} paddingAngle={2} stroke="none">
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip content={<PieCustomTooltip formatValue={formatValue} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6 text-center">
            <span className="text-xs text-muted-foreground">{centerLabel}</span>
            <span className="text-lg font-display font-bold text-foreground">{currencyPrefix}{compactAmount(total)}</span>
          </div>
        </div>
        <div className="flex-1 w-full min-w-0 space-y-2">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
              <span className="flex-1 text-foreground truncate">{d.name}</span>
              <span className="text-muted-foreground shrink-0">{d.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PctTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium text-foreground mb-1.5">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{Number(p.value).toFixed(1)}%</strong>
        </p>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieCustomTooltip({ active, payload, formatValue = formatARS }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-card border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium" style={{ color: d.payload.color }}>{d.name}</p>
      <p className="text-foreground">{formatValue(d.value)}</p>
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
  const [prevBalance, setPrevBalance] = useState<number | null>(null);
  const [mortgageSummary, setMortgageSummary] = useState<MortgageSummary | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setLoading(true);
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    Promise.all([
      api.get(`/dashboard/summary/${year}/${month}`),
      api.get(`/dashboard/summary/${prevYear}/${prevMonth}`).catch(() => null),
    ]).then(([curr, prev]) => {
      setData(curr.data);
      setPrevBalance(prev?.data?.balance != null ? Number(prev.data.balance) : null);
    }).finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => {
    api.get("/mortgage/loans").then(async (res) => {
      const active = (res.data as MortgageLoan[]).find(l => l.is_active);
      if (!active) return;
      const sumRes = await api.get(`/mortgage/loans/${active.id}/summary`);
      setMortgageSummary(sumRes.data);
    }).catch(() => {});
  }, []);

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/history"),
      api.get("/macro"),
      api.get(`/expenses/entries?year=${currentYear}&month=${currentMonth}`),
      api.get("/expenses/categories"),
      api.get(`/income/entries?year=${currentYear}&month=${currentMonth}`),
      api.get("/income/sources"),
    ]).then(([h, m, e, c, ie, is_]) => {
      setHistoryData(h.data);
      setMacro(m.data);
      setExpEntries(e.data);
      setExpCategories(c.data);
      setIncEntries(ie.data);
      setIncSources(is_.data);
    }).finally(() => setChartsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const currentMonthLabel = format(new Date(currentYear, currentMonth - 1, 1), "MMMM yyyy", { locale: es });

  const balanceChangePct = data && prevBalance != null && prevBalance !== 0
    ? ((Number(data.balance) - prevBalance) / Math.abs(prevBalance)) * 100
    : null;

  // Last 4 months with real income — filtered before slicing so future
  // income-less months (e.g. credit card installment cuotas propagated
  // years ahead, which still create real ExpenseEntry-only history points)
  // never crowd out the tenant's actual income trend.
  const quarterlyTrend = historyData.filter(h => Number(h.total_income) > 0).slice(-4);

  const pieData = (() => {
    const arsEntries = expEntries.filter(e => e.currency !== "USD");
    const total = arsEntries.reduce((s, e) => s + Number(e.amount), 0);
    if (total === 0) return [];
    return expCategories
      .map((c, i) => ({
        name: c.name,
        value: arsEntries.filter(e => e.category_id === c.id).reduce((s, e) => s + Number(e.amount), 0),
        color: c.color || PIE_COLORS[i % PIE_COLORS.length],
        pct: 0,
      }))
      .filter(d => d.value > 0)
      .map(d => ({ ...d, pct: parseFloat(((d.value / total) * 100).toFixed(1)) }));
  })();

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

  const usdPieData = (() => {
    const usdEntries = expEntries.filter(e => e.currency === "USD");
    const total = usdEntries.reduce((s, e) => s + Number(e.amount), 0);
    if (total === 0) return [];
    const byDesc = new Map<string, number>();
    usdEntries.forEach(e => {
      const key = e.description?.trim() || "Sin descripción";
      byDesc.set(key, (byDesc.get(key) || 0) + Number(e.amount));
    });
    const sorted = Array.from(byDesc.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 8);
    const restTotal = sorted.slice(8).reduce((s, [, v]) => s + v, 0);
    const rows = top.map(([name, value], i) => ({ name, value, color: PIE_COLORS[i % PIE_COLORS.length] }));
    if (restTotal > 0) rows.push({ name: "Otros", value: restTotal, color: "#9ca3af" });
    return rows.map(d => ({ ...d, pct: parseFloat(((d.value / total) * 100).toFixed(1)) }));
  })();

  return (
    <div className="max-w-6xl space-y-4 md:space-y-6">
      <ProductTour tourId="dashboard-intro" steps={DASHBOARD_TOUR_STEPS} requireDesktop />

      <div className="flex justify-end">
        <div className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card shadow-chip pl-3 pr-1.5 py-1.5">
          <CalendarDays className="w-4 h-4 text-primary shrink-0" />
          <button onClick={prev} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-foreground capitalize px-0.5 min-w-[100px] text-center">{periodLabel}</span>
          <button onClick={next} className="p-1 rounded-full hover:bg-accent text-muted-foreground transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Card variant="hero" className="h-40 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
          </div>
        </div>
      ) : data ? (
        <>
          {/* Hero — the screen's one 3D element: this month's balance */}
          <Card variant="hero" className="p-5 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Balance de {periodLabel}
                </p>
                <p className="text-4xl md:text-5xl font-display font-bold text-foreground mt-1">
                  {formatARS(data.balance)}
                </p>
                {balanceChangePct !== null && (
                  <p className={`mt-2 text-sm font-medium flex items-center gap-1 ${balanceChangePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {balanceChangePct >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {balanceChangePct >= 0 ? "+" : ""}{balanceChangePct.toFixed(1)}% vs mes anterior
                  </p>
                )}
                {/* Buying dollars isn't an expense, so it stays out of `balance`
                    — but it does move real pesos. Without this line the balance
                    reads as more pesos than are actually left. */}
                {(data.fx_bought_ars > 0 || data.fx_sold_ars > 0) && (
                  <div className="mt-3 pt-3 border-t border-border/60 space-y-1 text-sm">
                    {data.fx_bought_ars > 0 && (
                      <p className="flex justify-between gap-4 text-muted-foreground">
                        <span>− Compra de dólares</span>
                        <span className="font-medium tabular-nums">{formatARS(data.fx_bought_ars)}</span>
                      </p>
                    )}
                    {data.fx_sold_ars > 0 && (
                      <p className="flex justify-between gap-4 text-muted-foreground">
                        <span>+ Venta de dólares</span>
                        <span className="font-medium tabular-nums">{formatARS(data.fx_sold_ars)}</span>
                      </p>
                    )}
                    <p className="flex justify-between gap-4 font-semibold text-foreground">
                      <span>= Pesos disponibles</span>
                      <span className="tabular-nums">{formatARS(data.ars_available)}</span>
                    </p>
                  </div>
                )}
              </div>
              {mounted && quarterlyTrend.length > 1 && (
                <div className="w-full md:w-64 rounded-2xl bg-accent p-4 flex flex-col">
                  <p className="text-xs font-medium text-primary mb-2">Ingresos — últimos meses</p>
                  <div className="h-20">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={quarterlyTrend} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <Bar dataKey="total_income" fill="#5B4FE9" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Ingresos" value={formatARS(data.total_income)} icon={TrendingUp} tone="positive" />
            <StatCard label="Egresos" value={formatARS(data.total_expenses)} icon={TrendingDown} tone="negative" />
            {data.total_expenses_usd > 0 && (
              <StatCard label="Egresos USD" value={formatUSD(data.total_expenses_usd)} icon={CircleDollarSign} tone="usd" />
            )}
            {data.usd_holding !== 0 && (
              <Link href="/divisas" className="rounded-xl hover:bg-accent/50 transition-colors">
                <StatCard
                  label="Tenencia USD"
                  value={formatUSD(data.usd_holding)}
                  sub={data.usd_holding_ars !== null ? `≈ ${formatARS(data.usd_holding_ars)}` : undefined}
                  icon={Wallet}
                  tone="usd"
                />
              </Link>
            )}
            {data.inflation_pct !== null && (
              <StatCard label="Inflación" value={formatPct(data.inflation_pct)} icon={Gauge} />
            )}
          </div>

          {(mortgageSummary || data.expenses_by_category.length > 0 || data.total_expenses_usd > 0) && (
            <div className={mortgageSummary && (data.expenses_by_category.length > 0 || data.total_expenses_usd > 0) ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}>
              {mortgageSummary && (
                <Card className="p-4 md:p-5 space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Home className="w-4 h-4 text-primary shrink-0" />
                    <h3 className="font-semibold text-foreground text-sm md:text-base">Hipoteca</h3>
                    <Chip tone="neutral">
                      Próximo vencimiento: {(() => {
                        try { return format(parseISO(mortgageSummary.next_payment_date), "d MMM", { locale: es }); }
                        catch { return mortgageSummary.next_payment_date; }
                      })()}
                    </Chip>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5 text-sm">
                      <span className="text-muted-foreground">Progreso del crédito</span>
                      <span className="font-medium text-foreground">{mortgageSummary.pct_completado}% completado</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(mortgageSummary.pct_completado, 100)}%` }} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Cuota {mortgageSummary.cuota_numero} de {mortgageSummary.loan.total_cuotas}
                    </p>
                    {mortgageSummary.cuota_pesos_calculado != null && (
                      <p className="text-lg font-bold text-foreground">{formatARS(mortgageSummary.cuota_pesos_calculado)}</p>
                    )}
                  </div>
                  <Button asChild variant="outline" className="w-full">
                    <a href="/mortgage">Ver detalles de hipoteca</a>
                  </Button>
                </Card>
              )}

              {(data.expenses_by_category.length > 0 || data.total_expenses_usd > 0) && (
                <Card className="p-4 md:p-5">
                  <h3 className="font-semibold text-foreground mb-3 text-sm md:text-base">
                    {"Egresos por categoría"} — {periodLabel}
                  </h3>
                  <div className="space-y-2.5">
                    {data.expenses_by_category.map(cat => (
                      <div key={cat.category_name}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || "#6366f1" }} />
                            <span className="text-sm text-foreground truncate">{cat.category_name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className="text-sm font-medium">{formatARS(cat.total)}</span>
                            <span className="text-xs text-muted-foreground">({formatPct((cat.total / data.total_expenses) * 100)})</span>
                          </div>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full"
                            style={{ width: `${(cat.total / data.total_expenses) * 100}%`, backgroundColor: cat.color || "#6366f1" }} />
                        </div>
                      </div>
                    ))}
                    {data.total_expenses_usd > 0 && (
                      <div className={data.expenses_by_category.length > 0 ? "pt-2.5 border-t" : ""}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#22c55e" }} />
                            <span className="text-sm text-foreground truncate">Consumo en dólares</span>
                          </div>
                          <span className="text-sm font-medium shrink-0 ml-2">{formatUSD(data.total_expenses_usd)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">No hay datos para este mes.</p>
      )}

      {mounted && !chartsLoading && (
        <div className="space-y-4">
          {false && incomeTrendData.length > 0 && (
            <Card className="p-4 md:p-5">
              <h3 className="font-semibold text-foreground mb-4 text-sm md:text-base">
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
            </Card>
          )}

          {(pieData.length > 0 || incomePieData.length > 0 || usdPieData.length > 0) && (
            // Uniform grid for every donut card — each cell is the same fixed
            // size whether it has 1, 2 or 3 items; a lone chart never
            // stretches to fill the row, the leftover cell just stays empty.
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {pieData.length > 0 && (
                <DonutChartCard
                  title="Distribución de egresos por categoría"
                  subtitle={currentMonthLabel}
                  data={pieData}
                  centerLabel="Total"
                />
              )}

              {incomePieData.length > 0 && (
                <DonutChartCard
                  title="Distribución de ingresos por fuente"
                  subtitle={currentMonthLabel}
                  data={incomePieData}
                  centerLabel="Ingresos"
                />
              )}

              {usdPieData.length > 0 && (
                <DonutChartCard
                  title="Gastos en dólares por descripción"
                  subtitle={currentMonthLabel}
                  data={usdPieData}
                  centerLabel="Total USD"
                  formatValue={formatUSD}
                  currencyPrefix="U$D "
                />
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

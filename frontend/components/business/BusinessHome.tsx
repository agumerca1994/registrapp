"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowRight, CalendarDays, ChefHat, Contact, CreditCard } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { MotionList } from "@/components/ui/motion-list";
import { formatARS, formatARSRound, formatUSD } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Fab } from "@/components/ui/fab";
import { SegmentedToggle } from "@/components/ui/form";
import { SummaryCard, SummaryHeader, SummaryGrid, SummaryCell, SummaryFigure, ChainRow, SummaryTotal } from "@/components/ui/summary-card";
import { PAYMENT_METHOD_LABELS, businessToday, type DaySummary, type PaymentMethod, type Product } from "@/lib/sales";
import { MonthPill } from "@/components/dashboard/MonthPill";
import type { BreakdownRow } from "@/components/dashboard/BreakdownBarsCard";
import { BreakdownStrip } from "@/components/movimientos/BreakdownStrip";
import ProductTour from "@/components/ProductTour";
import { homeIntroSteps } from "@/components/business/tours";
import { BlockFigure, LoadError, SECTION_TITLE } from "@/components/business/ui";
import { GLASS, GlassEye, HOME_BLOCK, HOME_BLOCK_TOP } from "@/components/ui/glass";
import { ClosePanel } from "@/components/sales/ClosePanel";
import { SaleRow } from "@/components/sales/SaleRow";

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
  stock_alerts: { product_id: number; name: string; on_hand: number | string; alert: "negativo" | "bajo" }[];
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

/** "Efectivo $ 38.000 y Mercado Pago $ 22.800": lo que más entró, sin que la línea crezca con los medios. */
function methodsLine(day: DaySummary): string {
  const rows = day.by_method
    .map(m => ({ label: PAYMENT_METHOD_LABELS[m.method], amount: Number(m.counted ?? m.ticketed) }))
    .filter(m => m.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const shown = rows.slice(0, 2).map(m => `${m.label} ${formatARSRound(m.amount)}`);
  return rows.length > 2 ? `${shown.join(", ")} y ${rows.length - 2} más.` : `${shown.join(" y ")}.`;
}

function Shortcuts() {
  const items = [
    { href: "/productos?produccion=1", label: "Producción", icon: ChefHat },
    { href: "/proveedores", label: "Proveedores", icon: Contact },
    { href: "/tarjetas", label: "Tarjetas", icon: CreditCard },
    { href: "/calendario", label: "Calendario", icon: CalendarDays },
  ];
  return (
    <nav aria-label="Accesos rápidos" data-tour="home-shortcuts" className="mt-3.5 grid grid-cols-4 gap-1.5">
      {items.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="flex flex-col items-center gap-[7px] text-[13px] font-medium active:scale-[0.97] transition-transform duration-100">
          <span className="w-[54px] h-[54px] rounded-full bg-white/15 border border-white/25 flex items-center justify-center">
            <Icon className="w-[22px] h-[22px]" strokeWidth={1.8} />
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}

const MAX_RESOLVE = 3;

/** Lo que espera algo de hoy: lo que avisa el día y el stock. Tres a la vista, el resto en su pantalla. */
function ToResolve({ day, alerts }: { day: DaySummary | null; alerts: BusinessSummary["stock_alerts"] }) {
  const rows = [
    // Una fila, por muchos avisos que haya: el detalle está en Ventas.
    ...(day?.warnings.length ? [{
      key: "cierre", href: "/ventas", title: "Revisá el cierre de hoy",
      sub: day.warnings.length === 1 ? day.warnings[0] : `${day.warnings.length} avisos sobre lo contado y lo vendido`,
      wrap: true, danger: false,
    }] : []),
    ...alerts.map(a => ({
      key: `p${a.product_id}`,
      href: "/productos",
      title: a.name,
      sub: a.alert === "negativo"
        ? `${Number(a.on_hand).toLocaleString("es-AR")}: cargá la producción`
        : `Quedan ${Number(a.on_hand).toLocaleString("es-AR")}`,
      wrap: false,
      danger: a.alert === "negativo",
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <section data-tour="home-stock" className="rounded-3xl pt-3.5 px-2.5 pb-2.5 bg-accent border border-[#CFC9E4]">
      <h2 className="mx-2 mb-2.5 font-marca text-xs font-normal text-[#3B2FB3]">{rows.length} para resolver</h2>
      <MotionList className="space-y-1.5">
        {rows.slice(0, MAX_RESOLVE).map(row => (
          <Link key={row.key} href={row.href} className="min-h-[58px] flex items-center gap-3 pl-3.5 pr-2 py-[7px] rounded-2xl bg-white">
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-[15.5px] truncate">{row.title}</span>
              <span className={`block text-sm ${row.wrap ? "leading-snug" : "truncate"} ${row.danger ? "text-destructive font-medium" : "text-muted-foreground"}`}>{row.sub}</span>
            </span>
            <span className="h-9 pl-3 pr-[5px] flex items-center gap-2 rounded-full bg-secondary text-sm font-medium shrink-0">
              Ver
              <span className="w-[26px] h-[26px] rounded-full bg-ink text-background flex items-center justify-center">
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.4} />
              </span>
            </span>
          </Link>
        ))}
      </MotionList>
      {rows.length > MAX_RESOLVE && (
        <Link href="/productos" className="flex items-center justify-center min-h-[44px] mt-1 text-[15px] font-semibold text-[#3B2FB3]">
          Y {rows.length - MAX_RESOLVE} más
        </Link>
      )}
    </section>
  );
}

const SALES_SHOWN = 3;

function TodaySales({ day, products }: { day: DaySummary; products: Product[] }) {
  const router = useRouter();
  if (day.tickets.length === 0) return null;
  return (
    <MotionList as="section" className="px-2">
      <h2 className={`${SECTION_TITLE} mb-1`}>Las de hoy</h2>
      {day.tickets.slice(0, SALES_SHOWN).map(t => (
        <SaleRow key={t.id} sale={t} products={products} onOpen={() => router.push("/ventas")} />
      ))}
      {day.tickets.length > SALES_SHOWN && (
        <Link href="/ventas" className="mt-2 min-h-[56px] flex items-center justify-between gap-3 rounded-full border border-border bg-card pl-5 pr-2 text-[15.5px] font-semibold active:scale-[0.99] transition-transform duration-100">
          Ver las {day.tickets.length} ventas
          <span className="w-10 h-10 rounded-full bg-ink text-background flex items-center justify-center shrink-0">
            <ArrowRight className="w-[18px] h-[18px]" />
          </span>
        </Link>
      )}
    </MotionList>
  );
}

type BreakdownKey = "metodos" | "productos" | "categorias" | "pagos";

/** Los cuatro desgloses del mes en un solo lugar de altura fija: cuatro tarjetas de barras mandaban todo lo demás fuera de la pantalla. */
function MonthBreakdowns({ data, monthLabel }: { data: BusinessSummary; monthLabel: string }) {
  const router = useRouter();
  const tabs = ([
    {
      key: "metodos", tab: "Cobros", title: `Ventas por medio de pago · ${monthLabel}`, go: () => "/ventas",
      rows: data.sales_by_method.map(m => ({
        key: m.method, label: PAYMENT_METHOD_LABELS[m.method], color: METHOD_COLORS[m.method],
        total: m.total, total_usd: 0, ars_equivalent: Number(m.total),
      })),
    },
    {
      key: "productos", tab: "Productos", title: `Lo más vendido · ${monthLabel}`, go: () => "/productos",
      rows: data.top_products.map((p, i) => ({
        key: `${p.product_id ?? "libre"}-${i}`,
        label: `${p.name} × ${Number(p.qty).toLocaleString("es-AR")}`,
        color: "#5B4FE9",
        total: p.revenue, total_usd: 0, ars_equivalent: Number(p.revenue),
      })),
    },
    {
      key: "categorias", tab: "Egresos", title: `Egresos por categoría · ${monthLabel}`, go: () => "/expenses",
      rows: data.expenses_by_category.map(cat => ({
        key: cat.category_name, label: cat.category_name, color: cat.color,
        total: cat.total, total_usd: cat.total_usd, ars_equivalent: cat.ars_equivalent,
      })),
    },
    {
      key: "pagos", tab: "A quién", title: `Proveedores y empleados · ${monthLabel}`, go: (k: string) => `/expenses?payee_id=${k}`,
      rows: data.spend_by_payee.map(p => ({
        key: String(p.payee_id), label: p.name, color: PAYEE_COLORS[p.kind],
        // Sin cotización acá: las barras van por pesos, y lo pagado
        // en dólares se muestra al lado sin sumarse.
        total: p.total, total_usd: p.total_usd, ars_equivalent: Number(p.total),
      })),
    },
  ] satisfies { key: BreakdownKey; tab: string; title: string; go: (k: string) => string; rows: BreakdownRow[] }[]).filter(t => t.rows.length > 0);

  const [picked, setPicked] = useState<BreakdownKey | null>(null);
  const current = tabs.find(t => t.key === picked) ?? tabs[0];
  if (!current) return null;
  return (
    <div className="space-y-2.5" data-tour="home-breakdowns">
      {tabs.length > 1 && (
        <SegmentedToggle<BreakdownKey> ariaLabel="Desglose del mes" value={current.key} onChange={setPicked}
          options={tabs.map(t => ({ value: t.key, label: t.tab }))} />
      )}
      {/* Tocar una fila lleva a lo suyo: acá no hay una tabla abajo para filtrar. */}
      <BreakdownStrip key={current.key} title={current.title} rows={current.rows} picked={null}
        onPick={k => { if (k) router.push(current.go(k)); }} />
    </div>
  );
}

/**
 * Inicio de un negocio: primero el día (cuánto se vendió, el cierre, lo que hay
 * que resolver), y más abajo el mes. El mes sigue siendo el resultado (ventas −
 * egresos), con la cuenta detrás de "Ver detalle". Mismas reglas que en el hogar:
 * por fecha de pago, sin mezclar monedas, y los montos se ocultan con el mismo
 * interruptor.
 */
export default function BusinessHome() {
  const router = useRouter();
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const { appUser } = useAuth();
  const now = new Date();
  const today = businessToday();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<BusinessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthFailed, setMonthFailed] = useState(false);
  const [monthTry, setMonthTry] = useState(0);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [dayState, setDayState] = useState<"loading" | "ok" | "failed">("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setLoading(true);
    setMonthFailed(false);
    api.get(`/business/summary/${year}/${month}`)
      .then((res) => setData(res.data))
      .catch(() => { setData(null); setMonthFailed(true); })
      .finally(() => setLoading(false));
  }, [year, month, monthTry]);

  const loadDay = () => {
    setDayState("loading");
    api.get<DaySummary>(`/sales/day/${today}`)
      .then(({ data }) => { setDay(data); setDayState("ok"); })
      .catch(() => setDayState("failed"));
  };
  useEffect(() => {
    loadDay();
    api.get<Product[]>("/products").then(({ data }) => setProducts(data)).catch(() => setProducts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: es });
  const pillLabel = format(new Date(year, month - 1, 1), "MMM yyyy", { locale: es }).replace(".", "");

  const income = Number(data?.total_income ?? 0);
  const expensesArs = Number(data?.total_expenses ?? 0);
  const expensesUsd = Number(data?.total_expenses_usd ?? 0);
  const result = Number(data?.balance ?? 0);
  // "Ventas" sólo si todo lo que entró son ventas; si hubo otro ingreso, no.
  const incomeLabel = Number(data?.sales_total ?? 0) === income ? "Ventas" : "Ingresos";
  const emptyMonth = !!data && income === 0 && expensesArs === 0 && expensesUsd === 0;
  const alerts = data?.stock_alerts ?? [];
  const dayHasAny = !!day && (day.tickets.length > 0 || !!day.close);

  const hasStock = alerts.length > 0 || (day?.warnings.length ?? 0) > 0;
  const steps = useMemo(() => homeIntroSteps({ hasStock }), [hasStock]);
  // Una pantalla vacía no lleva guía: queda para cuando haya algo que mostrar.
  const tourReady = !!data && !!day && (dayHasAny || !emptyMonth);

  return (
    <div className="space-y-4 md:space-y-6 md:pb-16">
      {tourReady && <ProductTour tourId="home-intro" steps={steps} />}

      <section className={HOME_BLOCK} style={HOME_BLOCK_TOP}>
        <header className="flex items-end justify-between gap-3 px-1.5">
          <div className="min-w-0">
            <p className="font-marca text-xs text-white/90">{format(parseISO(today), "EEE d MMM", { locale: es }).replace(/\./g, "")}</p>
            <h1 className="mt-1 text-[26px] font-medium leading-[1.1] tracking-[-0.035em] truncate">{appUser?.tenant_name || "Tu negocio"}</h1>
          </div>
          <GlassEye />
        </header>

        <div className="lg:grid lg:grid-cols-2 lg:gap-10 lg:items-end">
          <div className="px-1.5 pt-4" data-tour="home-today">
            {dayState === "failed" ? (
              <>
                <p className="text-[22px] font-medium leading-tight tracking-[-0.025em]">No pudimos traer las ventas de hoy.</p>
                <button onClick={loadDay} className="mt-3 h-11 px-5 rounded-full bg-white text-[#2A2178] font-semibold text-[15px]">Probar de nuevo</button>
              </>
            ) : !day ? (
              <div className="animate-pulse" aria-busy="true">
                <div className="h-4 w-32 rounded-full bg-white/20" />
                <div className="mt-2.5 h-12 w-56 rounded-2xl bg-white/20" />
                <span className="sr-only">Cargando las ventas de hoy</span>
              </div>
            ) : dayHasAny ? (
              <>
                <p className="text-[16.5px] font-medium">{day.close ? "Contaste hoy" : "Vendiste hoy"}</p>
                <BlockFigure amount={Number(day.total)} className="mt-0.5 text-[clamp(2.75rem,14.5vw,3.625rem)]" />
                <p className="mt-1 text-[15px] leading-snug">{methodsLine(day)}</p>
              </>
            ) : (
              <>
                <p className="text-[32px] font-medium leading-[1.08] tracking-[-0.035em]">Todavía no vendiste hoy.</p>
                <p className="mt-1.5 text-[15.5px] leading-snug">Cargá la primera, o mandale al bot “vendí 3 empanadas a 4500”.</p>
                <Link href="/ventas?nueva=1" className="mt-3 inline-flex items-center justify-center h-11 px-5 rounded-full bg-white text-[#2A2178] font-semibold text-[15px] active:scale-[0.97] transition-transform duration-100">
                  Cargar una venta
                </Link>
              </>
            )}
          </div>
          {day && (
            <div className="mt-3.5 lg:mt-0">
              <ClosePanel summary={day} href="/ventas?cerrar=1" data-tour="home-close" />
            </div>
          )}
        </div>
        {!day && dayState === "loading" && <div className={`mt-3.5 h-[74px] ${GLASS} animate-pulse`} />}
        <Shortcuts />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <ToResolve day={day} alerts={alerts} />
          {day && <TodaySales day={day} products={products} />}
        </div>

        <div className="space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2 px-2">
            <h2 className={SECTION_TITLE}>El mes</h2>
            <span data-tour="home-month"><MonthPill compact label={pillLabel} onPrev={prev} onNext={next} /></span>
          </div>

          {loading && !data ? (
            <Card variant="hero" className="h-[136px] animate-pulse" />
          ) : monthFailed ? (
            <LoadError message="No se pudo cargar el resumen del mes." onRetry={() => setMonthTry(n => n + 1)} />
          ) : data && (
            <>
              <div data-tour="home-result">
                <SummaryCard>
                  {/* Un mes sin movimientos no tiene resultado: "$ 0,00" no le dice nada a nadie. */}
                  <SummaryHeader title={`Resultado de ${periodLabel}`} open={showDetail} onToggle={emptyMonth ? undefined : () => setShowDetail(v => !v)} />
                  {emptyMonth ? (
                    <p className="px-4 md:px-6 pt-2.5 pb-3.5 border-t border-border/60 text-[15px] leading-snug text-muted-foreground">
                      Todavía no hay movimientos en {periodLabel}. Las ventas se cargan con el <span className="font-semibold">+</span> o
                      cerrando el día en <Link href="/ventas" className="text-[#3B2FB3] font-semibold">Ventas</Link>.
                      Los gastos van en <Link href="/expenses" className="text-[#3B2FB3] font-semibold">Egresos</Link>,
                      o por WhatsApp: <span className="font-marca text-sm">45 lucas alquiler</span>.
                    </p>
                  ) : (
                    <>
                      <SummaryGrid>
                        <SummaryCell figure className="border-t border-border/60 pt-2.5 min-h-0">
                          <SummaryFigure value={result < 0 ? `−${formatARSRound(-result)}` : formatARSRound(result)} sub={`${incomeLabel} menos egresos, por fecha de pago`} />
                        </SummaryCell>
                        {showDetail && (
                          <SummaryCell className="border-t border-border/60">
                            <ChainRow label={incomeLabel} sign="+" value={formatARS(income)} />
                            <ChainRow label="Egresos" sign="−" value={formatARS(expensesArs)} />
                          </SummaryCell>
                        )}
                      </SummaryGrid>
                      {showDetail && <SummaryTotal label="Resultado" items={[signedARS(result)]} />}
                    </>
                  )}
                </SummaryCard>
              </div>
              {expensesUsd > 0 && (
                <p className="px-2 text-sm text-muted-foreground">
                  Además se pagaron {formatUSD(expensesUsd)}, que no entran en el resultado en pesos.
                </p>
              )}

              {!emptyMonth && <MonthBreakdowns data={data} monthLabel={periodLabel} />}

              {!emptyMonth && expensesArs > 0 && data.spend_by_payee.length === 0 && (
                <p className="px-2 text-sm text-muted-foreground">
                  Asigná cada gasto a un proveedor o empleado para ver a quién se le pagó.{" "}
                  <Link href="/proveedores" className="text-[#3B2FB3] font-semibold">Cargar proveedores y empleados</Link>
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Lo de todos los días en un comercio es vender: el `+` de Inicio abre una
          venta. Los gastos tienen su `+` en Egresos. */}
      <Fab label="Nueva venta" data-tour="home-add" onClick={() => router.push("/ventas?nueva=1")} />
    </div>
  );
}

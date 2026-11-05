"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowRight, CalendarDays, Eye, EyeOff, FileUp, Home, Users2 } from "lucide-react";
import type { Step } from "react-joyride";
import api from "@/lib/api";
import { features } from "@/lib/features";
import { formatARSRound, formatUSD, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAmountsHidden, usePrivacy } from "@/contexts/PrivacyContext";
import { GLASS, GlassEye, HOME_BLOCK, HOME_BLOCK_TOP } from "@/components/ui/glass";
import { usePendingShared } from "@/contexts/PendingSharedContext";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import { Card } from "@/components/ui/card";
import { useCountUp } from "@/components/ui/count-up";
import { Fab } from "@/components/ui/fab";
import { MotionList } from "@/components/ui/motion-list";
import ProductTour from "@/components/ProductTour";

// Muestra lo que hay en esta pantalla, en el orden en que se mira, y en el celular
// igual que en la compu. Lo que no se ve en una pantalla se saltea (ProductTour).
const tourSteps = (hasPeriods: boolean): Step[] => [
  {
    target: "[data-tour='home-figure']",
    title: "Lo que importa hoy",
    content: "Esta cifra cambia con el mes: lo que sale en los próximos días, lo que te queda para gastar o cómo va a cerrar.",
  },
  ...(hasPeriods ? [{
    target: "[data-tour='home-period']",
    title: "Hoy, semana o mes",
    content: "Mirá lo que gastaste en la escala que te sirva. A principio de mes, el mes todavía no dice mucho.",
  }] : []),
  {
    target: "[data-tour='home-shortcuts']",
    title: "A un toque",
    content: "Lo que más se usa, sin pasar por el menú.",
  },
  {
    target: "[data-tour='home-next']",
    title: "Lo que viene",
    content: "Los vencimientos de tus tarjetas, la hipoteca y tus recordatorios, antes de que lleguen.",
  },
  {
    target: "[data-tour='nav-movimientos']",
    title: "Movimientos",
    content: "Todo lo que entró y salió en el mes, con su detalle.",
  },
  {
    // En el celular es el + de la barra; en la compu, el botón flotante.
    target: "[data-tour='nav-add'], [data-tour='dashboard-registrar']",
    title: "Cargá lo que pasó",
    content: "Un gasto, un ingreso o una compra de dólares. También podés mandárselo al bot por WhatsApp.",
  },
];

interface Upcoming {
  kind: "card" | "mortgage" | "reminder";
  title: string;
  date: string;
  amount: string | null;
  amount_usd: string;
  estimated: boolean;
  detail: string | null;
}

interface Today {
  today: string;
  moment: "no_income" | "running" | "closing";
  is_empty: boolean;
  month_end: string;
  days_left: number;
  left_to_spend: string;
  per_day: string;
  next_10_days: string;
  last_month_income: string;
  last_month_close: string;
  next_month_committed: string;
  spent_today: string;
  spent_today_usd: string;
  spent_week: string;
  spent_prev_week: string;
  spent_mtd: string;
  spent_mtd_prev: string;
  week: { date: string; total: string }[];
  paid_month: string;
  upcoming: Upcoming[];
  usd_holding: string;
  usd_holding_ars: string | null;
}

type Period = "hoy" | "semana" | "mes";

const monthName = (iso: string, plusMonths = 0) => {
  const d = parseISO(iso);
  return format(new Date(d.getFullYear(), d.getMonth() + plusMonths, 1), "MMMM", { locale: es });
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** La cifra del encabezado: qué dice, según el momento del mes. Comparar un mes recién empezado contra uno entero sólo asusta. */
function headline(t: Today): { label: string; amount: number; lines: string[] } {
  const usd = Number(t.usd_holding);
  const dollars = usd > 0 ? `Tenés ${formatUSD(usd).replace(",00", "")} guardados.` : null;
  const left = Number(t.left_to_spend);
  const lastMonth = capitalize(monthName(t.today, -1));

  if (t.moment === "no_income") {
    const soon = t.upcoming.filter(i => i.amount && differenceInCalendarDays(parseISO(i.date), parseISO(t.today)) <= 10);
    if (Number(t.next_10_days) > 0) {
      const names = soon.slice(0, 2).map(i => `${i.kind === "mortgage" ? "la hipoteca" : i.title} el ${format(parseISO(i.date), "d")}`);
      const list = capitalize(names.join(" y ")) + (soon.length > 2 ? ` y ${soon.length - 2} más.` : ".");
      return { label: "En los próximos 10 días salen", amount: Number(t.next_10_days), lines: [list, dollars].filter(Boolean) as string[] };
    }
    return {
      label: `Llevás gastado en ${monthName(t.today)}`,
      amount: Number(t.spent_mtd),
      lines: ["En los próximos 10 días no vence nada.", dollars].filter(Boolean) as string[],
    };
  }

  if (t.moment === "closing") {
    return {
      label: `${capitalize(monthName(t.today))} va a cerrar en`,
      amount: left,
      lines: [
        `${t.days_left === 1 ? "Queda 1 día" : `Quedan ${t.days_left} días`}. ${lastMonth} cerró en ${formatARSRound(t.last_month_close)}.`,
        dollars,
      ].filter(Boolean) as string[],
    };
  }

  const pace = Number(t.spent_mtd_prev) - Number(t.spent_mtd);
  const paceLine = Number(t.spent_mtd_prev) > 0 && Math.abs(pace) >= 1
    ? `Vas ${formatARSRound(Math.abs(pace))} ${pace > 0 ? "abajo" : "arriba"} de ${monthName(t.today, -1)}.`
    : "";
  if (left < 0) {
    return {
      label: "Para cubrir lo de este mes te faltan",
      amount: Math.abs(left),
      lines: ["Sumá el ingreso si todavía no lo cargaste.", dollars].filter(Boolean) as string[],
    };
  }
  return {
    label: `Te queda para gastar hasta el ${format(parseISO(t.month_end), "d")}`,
    amount: left,
    lines: [`Unos ${formatARSRound(t.per_day)} por día. ${paceLine}`.trim(), dollars].filter(Boolean) as string[],
  };
}

function Greeting({ date }: { date?: string }) {
  const { appUser } = useAuth();
  const name = appUser?.first_name || appUser?.display_name?.trim().split(/\s+/)[0];
  return (
    <header className="flex items-end justify-between gap-3 px-2.5">
      <div className="min-w-0">
        <p className="font-marca text-xs text-white/90 min-h-4">{date && format(parseISO(date), "EEE d MMM", { locale: es })}</p>
        <h1 className="mt-1.5 text-[34px] font-medium leading-[1.05] tracking-[-0.035em] truncate">{name ? `Hola, ${name}` : "Hola"}</h1>
      </div>
      <GlassEye />
    </header>
  );
}

const FIELD_CLASS = HOME_BLOCK;
const FIELD_TOP = HOME_BLOCK_TOP;

function Figure({ amount, className = "" }: { amount: number; className?: string }) {
  const counted = useCountUp(amount);
  const text = formatARSRound(Math.round(counted));
  return (
    <p className={`font-medium leading-[1.08] tracking-[-0.045em] tabular-nums ${amount >= 10_000_000 ? "text-[2.75rem]" : "text-[clamp(2.75rem,14.5vw,3.625rem)]"} ${className}`}>
      {text}
    </p>
  );
}

function Shortcuts() {
  const third = features.reconcile
    ? { href: "/tarjetas/resumenes", label: "Resumen", icon: FileUp }
    : { href: "/mortgage", label: "Hipoteca", icon: Home };
  const items = [{ href: "/shared", label: "Compartir", icon: Users2 }, third, { href: "/calendario", label: "Calendario", icon: CalendarDays }];
  const circle = "w-[58px] h-[58px] rounded-full bg-white/15 border border-white/25 flex items-center justify-center";
  const link = "flex flex-col items-center gap-[7px] text-[13.5px] font-medium active:scale-[0.97] transition-transform duration-100";
  return (
    <nav aria-label="Accesos rápidos" data-tour="home-shortcuts" className="mt-[18px] grid grid-cols-4 gap-1.5">
      <Link href="/divisas" className={link}><span className={`${circle} text-[17px] font-semibold`}>U$</span>Dólares</Link>
      {items.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className={link}>
          <span className={circle}><Icon className="w-[23px] h-[23px]" strokeWidth={1.8} /></span>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** La misma cuenta en la escala que sirva hoy: a principio de mes, "el mes" no dice nada. */
function SpendPanel({ t }: { t: Today }) {
  const [period, setPeriod] = useState<Period>("hoy");
  const view: Record<Period, { seg: string; label: string; amount: string }> = {
    hoy: { seg: "Hoy", label: "Gastaste hoy", amount: t.spent_today },
    semana: { seg: "Semana", label: "Últimos 7 días", amount: t.spent_week },
    mes: { seg: "Mes", label: `Salió en ${monthName(t.today)}`, amount: t.paid_month },
  };
  const usdToday = period === "hoy" && Number(t.spent_today_usd) > 0;
  return (
    <div data-tour="home-period" className={`mt-[18px] ${GLASS} pt-3.5 px-3 pb-3`}>
      <div className="flex items-baseline justify-between gap-3 px-1.5 pb-3">
        <span className="text-[15px]">{view[period].label}</span>
        <span className="text-[22px] font-semibold tracking-[-0.025em] tabular-nums text-right">
          {formatARSRound(view[period].amount)}
          {usdToday && <span className="block text-sm font-medium tracking-normal">+ {formatUSD(t.spent_today_usd)}</span>}
        </span>
      </div>
      <div role="group" aria-label="Período" className="relative grid grid-cols-3 p-1 rounded-full bg-[rgba(20,14,70,0.32)]">
        {/* La tira de SegmentedToggle, con los colores que van sobre el violeta. */}
        <span aria-hidden="true" className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-white transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(${(Object.keys(view) as Period[]).indexOf(period) * 100}%)` }} />
        {(Object.keys(view) as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p}
            className={`relative h-10 rounded-full text-[14.5px] font-semibold transition-colors duration-200 ${period === p ? "text-[#2A2178]" : "text-white"}`}>
            {view[p].seg}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToResolve() {
  const { pending: shared } = usePendingShared();
  const { pending: statements } = usePendingStatements();
  const rows = [
    ...shared.map(s => {
      const mine = s.splits.find(split => split.mine);
      const creator = s.splits.find(split => split.user_id === s.created_by_user_id)?.member_name;
      const amount = mine?.amount ?? s.total_amount;
      return {
        key: `s${s.id}`,
        href: "/shared",
        title: creator ? `${creator.split(" ")[0]} te compartió ${s.title}` : `Te compartieron ${s.title}`,
        sub: `Tu parte: ${s.currency === "USD" ? formatUSD(amount) : formatARSRound(amount)}`,
      };
    }),
    ...statements.map(s => ({
      key: `r${s.id}`,
      href: `/conciliar/${s.id}`,
      title: `Revisá el resumen${s.bank ? ` de ${s.bank}` : ""}`,
      sub: s.pending_count > 0
        ? `${s.pending_count} ${s.pending_count === 1 ? "diferencia" : "diferencias"} con lo cargado`
        : "Falta elegir la tarjeta",
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <section className="rounded-3xl pt-3.5 px-2.5 pb-2.5 bg-accent border border-[#CFC9E4]">
      <h2 className="mx-2 mb-2.5 font-marca text-xs font-normal text-[#3B2FB3]">{rows.length} para resolver</h2>
      <MotionList className="space-y-1.5">
        {rows.slice(0, 3).map(row => (
          <Link key={row.key} href={row.href}
            className="min-h-[58px] flex items-center gap-3 pl-3.5 pr-2 py-[7px] rounded-2xl bg-white">
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-[15.5px] truncate">{row.title}</span>
              <span className="block text-sm text-muted-foreground truncate">{row.sub}</span>
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
    </section>
  );
}

function upcomingDetail(item: Upcoming, today: string): string {
  if (item.detail) return item.detail;
  if (item.kind === "reminder") return "Recordatorio";
  if (item.estimated) return "Vencimiento estimado";
  const days = differenceInCalendarDays(parseISO(item.date), parseISO(today));
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `Vence en ${days} días`;
}

const UPCOMING_HREF = { card: "/tarjetas", mortgage: "/mortgage", reminder: "/calendario" };

function WhatsNext({ t }: { t: Today }) {
  return (
    <section data-tour="home-next" className="px-2">
      <h2 className="mb-1 text-[22px] font-medium tracking-[-0.03em]">Lo que viene</h2>
      {t.upcoming.length === 0 ? (
        <p className="py-3 text-[15px] text-muted-foreground">No vence nada en los próximos 45 días. Cuando cargues una tarjeta o un recordatorio, aparece acá.</p>
      ) : (
        <div className="divide-y divide-border">
          {t.upcoming.map((item, i) => (
            <Link key={i} href={UPCOMING_HREF[item.kind]} className="min-h-[66px] flex items-center gap-3.5">
              <span className="w-[42px] shrink-0">
                <span className="block font-fecha italic text-[32px] leading-none text-[#3B2FB3]">{format(parseISO(item.date), "d")}</span>
                <span className="font-marca text-xs text-muted-foreground">{format(parseISO(item.date), "MMM", { locale: es })}</span>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-[15.5px] truncate">{item.title}</span>
                <span className="block text-sm text-muted-foreground truncate">{upcomingDetail(item, t.today)}</span>
              </span>
              <span className="font-medium text-base tabular-nums text-right shrink-0">
                {item.amount !== null && Number(item.amount) > 0 && <span className="block">{formatARSRound(item.amount)}</span>}
                {Number(item.amount_usd) > 0 && <span className="block">{formatUSD(item.amount_usd)}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Week({ t }: { t: Today }) {
  const max = Math.max(...t.week.map(d => Number(d.total)), 1);
  return (
    <Card className="p-[18px]">
      <h2 className="text-[22px] font-medium tracking-[-0.03em]">Cómo viene la semana</h2>
      <p className="mt-0.5 mb-3.5 text-[14.5px] text-muted-foreground">
        {formatARSRound(t.spent_week)} en 7 días. Los 7 anteriores: {formatARSRound(t.spent_prev_week)}.
      </p>
      <div role="img" aria-label={`Consumo por día en los últimos 7 días. En total, ${formatARSRound(t.spent_week)}.`}
        className="grid grid-cols-7 gap-[7px] items-end h-[72px]">
        {t.week.map((d, i) => (
          <span key={d.date}
            className={`rounded-lg ${i === t.week.length - 1 ? "bg-primary" : "bg-accent"}`}
            style={{ height: `${Math.max(8, (Number(d.total) / max) * 100)}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[7px] mt-1.5 text-center font-marca text-xs text-muted-foreground">
        {t.week.map((d, i) => (
          <span key={d.date} className={i === t.week.length - 1 ? "text-[#3B2FB3] font-medium" : ""}>
            {format(parseISO(d.date), "EEEEE", { locale: es }).toUpperCase()}
          </span>
        ))}
      </div>
    </Card>
  );
}

function NextMonth({ t }: { t: Today }) {
  return (
    <Card className="p-[18px]">
      <h2 className="text-[15px] font-medium text-muted-foreground">{capitalize(monthName(t.today, 1))} ya tiene comprometidos</h2>
      <p className="mt-1 text-[34px] font-medium leading-tight tracking-[-0.035em] tabular-nums">{formatARSRound(t.next_month_committed)}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Las tarjetas y la hipoteca, hasta ahora.</p>
    </Card>
  );
}

function MonthLink({ t }: { t: Today }) {
  return (
    <Link href="/expenses" className="min-h-[56px] flex items-center justify-between gap-3 rounded-full border border-border bg-card pl-5 pr-2 text-[15.5px] font-semibold active:scale-[0.99] transition-transform duration-100">
      Ver {monthName(t.today)} completo
      <span className="w-10 h-10 rounded-full bg-ink text-background flex items-center justify-center shrink-0">
        <ArrowRight className="w-[18px] h-[18px]" />
      </span>
    </Link>
  );
}

/** Al bajar, la cifra sigue a la vista en una píldora de vidrio, con lo que pasa por debajo desenfocado. */
function StickyFigure({ visible, label, amount }: { visible: boolean; label: string; amount: number }) {
  const { hidden, toggle } = usePrivacy();
  return (
    <div aria-hidden={!visible}
      className={`md:hidden fixed left-3 right-3 z-30 h-[62px] pl-5 pr-2 rounded-full bg-card/95 supports-[backdrop-filter]:bg-card/75 backdrop-blur-lg backdrop-saturate-150 border border-border/90 shadow-flota flex items-center justify-between gap-3 transition-all duration-200 ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3 pointer-events-none"}`}
      style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[#3F3B4B] truncate">{label}</span>
        <span className="block font-semibold text-xl leading-tight tracking-[-0.03em] tabular-nums">{formatARSRound(amount)}</span>
      </span>
      <button onClick={toggle} tabIndex={visible ? 0 : -1} aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
        className="w-[46px] h-[46px] shrink-0 rounded-full bg-ink/[0.07] flex items-center justify-center">
        {hidden ? <EyeOff className="w-[21px] h-[21px]" strokeWidth={1.8} /> : <Eye className="w-[21px] h-[21px]" strokeWidth={1.8} />}
      </button>
    </div>
  );
}

export default function HouseholdHome() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const fieldRef = useRef<HTMLElement>(null);
  const { count: sharedCount } = usePendingShared();

  const load = useCallback(() => {
    setError("");
    api.get<Today>("/dashboard/today")
      .then(({ data }) => setData(data))
      .catch(e => setError(getErrorMessage(e, "No pudimos traer tus números.")));
  }, []);

  // Aceptar un compartido desde el aviso cambia las cuentas de la pantalla que está debajo.
  useEffect(() => { load(); }, [load, sharedCount]);

  const hasField = !!data;
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), { rootMargin: "-72px 0px 0px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasField]);

  const fab = (
    <Fab label="Registrar egreso" data-tour="dashboard-registrar" onClick={() => router.push("/expenses?nuevo=1")} />
  );

  if (error && !data) {
    return (
      <div className="space-y-4">
        <section className={FIELD_CLASS} style={FIELD_TOP}>
          <Greeting />
          <div className="px-2.5 pt-6">
            <p className="text-[22px] font-medium leading-tight tracking-[-0.025em]">No pudimos traer tus números.</p>
            <p className="mt-1 text-[15.5px]">Tus datos están bien. Fijate si tenés conexión y probá de nuevo.</p>
            <button onClick={load} className="mt-4 h-[50px] px-5 rounded-full bg-white text-[#2A2178] font-semibold text-[15.5px]">Probar de nuevo</button>
          </div>
        </section>
        {fab}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <section className={FIELD_CLASS} style={FIELD_TOP}>
          <Greeting />
          <div className="px-2.5 pt-6 animate-pulse">
            <div className="h-4 w-52 rounded-full bg-white/20" />
            <div className="mt-3 h-12 w-64 rounded-2xl bg-white/20" />
            <div className="mt-3 h-4 w-44 rounded-full bg-white/20" />
          </div>
          <div className={`mt-[18px] h-[116px] ${GLASS} animate-pulse`} />
        </section>
        <span className="sr-only">Cargando tus números</span>
        {fab}
      </div>
    );
  }

  // Cuenta recién creada: una sola idea y un solo botón.
  if (data.is_empty) {
    return (
      <div className="space-y-4">
        {/* Sin guía: todavía no hay nada que mostrar. Aparece cuando cargue algo. */}
        <section className={`${FIELD_CLASS} min-h-[440px] flex flex-col`} style={FIELD_TOP}>
          <Greeting date={data.today} />
          <div className="px-2.5 pt-8 flex-1 flex flex-col">
            <p className="text-[40px] font-medium leading-[1.05] tracking-[-0.04em]">Contame el último gasto que hiciste.</p>
            <p className="mt-3 text-[17px] leading-snug">Con eso ya arranca tu semana. Lo demás lo vamos sumando.</p>
            <div className="mt-auto pt-8">
              <Link href="/expenses?nuevo=1" className="flex items-center justify-center h-14 rounded-full bg-white text-[#2A2178] font-semibold text-[17px]">Cargar un gasto</Link>
              <p className="mt-3 text-center text-[15px]">O escribile al bot: “verdulería 12 lucas”.</p>
            </div>
          </div>
        </section>
        {fab}
      </div>
    );
  }

  const head = headline(data);
  return (
    <div className="space-y-4 md:space-y-6">
      <ProductTour tourId="dashboard-intro" steps={tourSteps(data.moment !== "no_income")} />
      <StickyFigure visible={scrolled} label={head.label} amount={head.amount} />

      <section ref={fieldRef} className={FIELD_CLASS} style={FIELD_TOP}>
        <Greeting date={data.today} />
        {/* En una pantalla ancha, dos columnas: estirado a todo el ancho, el selector mide un metro. */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-10 lg:items-end">
          <div data-tour="home-figure" className="px-2.5 pt-6">
            <p className="text-[16.5px] font-medium">{head.label}</p>
            <Figure amount={head.amount} className="mt-0.5" />
            {head.lines.map(line => <p key={line} className="mt-1.5 text-[15.5px] leading-snug">{line}</p>)}
          </div>
          <div>
            {data.moment === "no_income" ? (
              <div className={`mt-[18px] ${GLASS} p-4`}>
                <p className="text-[21px] font-medium tracking-[-0.025em]">¿Ya cobraste?</p>
                <p className="mt-0.5 mb-3.5 text-[15px] leading-snug">
                  Con el ingreso de {monthName(data.today)} te digo cuánto te queda para gastar.
                  {Number(data.last_month_income) > 0 && ` En ${monthName(data.today, -1)} fue ${formatARSRound(data.last_month_income)}.`}
                </p>
                <Link href="/income?nuevo=1" className="inline-flex items-center gap-3 h-[50px] pl-5 pr-[7px] rounded-full bg-white text-[#2A2178] font-semibold text-[15.5px]">
                  Cargar el ingreso
                  <span className="w-9 h-9 rounded-full bg-[#2A2178] text-white flex items-center justify-center">
                    <ArrowRight className="w-[17px] h-[17px]" />
                  </span>
                </Link>
              </div>
            ) : (
              <SpendPanel t={data} />
            )}
          </div>
        </div>
        <Shortcuts />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 items-start md:pb-16">
        <div className="space-y-4 min-w-0">
          <ToResolve />
          <WhatsNext t={data} />
        </div>
        <div className="space-y-4 min-w-0">
          {data.moment === "closing" && <NextMonth t={data} />}
          <Week t={data} />
          <MonthLink t={data} />
        </div>
      </div>
      {fab}
    </div>
  );
}

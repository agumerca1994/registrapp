"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, TriangleAlert } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { isEmployee } from "@/lib/account";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS } from "@/lib/utils";
import { Fab } from "@/components/ui/fab";
import ProductTour from "@/components/ProductTour";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { salesIntroSteps } from "@/components/business/tours";
import { BlockFigure, EmptyState, LoadError, SECTION_TITLE } from "@/components/business/ui";
import { BLOCK, GLASS } from "@/components/ui/glass";
import { ClosePanel } from "@/components/sales/ClosePanel";
import { DayPill } from "@/components/sales/DayPill";
import { SaleRow } from "@/components/sales/SaleRow";
import { SaleSheet } from "@/components/sales/SaleSheet";
import SaleFormModal from "@/components/sales/SaleFormModal";
import DailyCloseModal from "@/components/sales/DailyCloseModal";
import {
  PAYMENT_METHOD_LABELS, businessToday, draftFromSale,
  type DaySummary, type Product, type Sale,
} from "@/lib/sales";

/**
 * Las ventas de un día, en las dos formas que tiene un negocio de llevarlas:
 * venta por venta (tickets) y el cierre del día (lo contado). Con tickets, el
 * cierre se precarga con ellos; sin tickets, el cierre es todo. El día suma lo
 * contado si cerró, y si no la suma de las ventas (services/business/sales.py).
 */
export default function VentasPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const reaccionar = useReaccion();
  const { appUser } = useAuth();
  const today = businessToday();
  // Un empleado trabaja sobre hoy y ayer (core/access.assert_staff_day).
  const yesterday = format(addDays(parseISO(today), -1), "yyyy-MM-dd");
  const employee = isEmployee(appUser);
  const [day, setDay] = useState(today);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [form, setForm] = useState<null | { sale?: Sale }>(null);
  const [formKey, setFormKey] = useState(0);
  const [closing, setClosing] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [allWarnings, setAllWarnings] = useState(false);
  const wantsClose = useRef(false);

  const load = async () => {
    const { data } = await api.get<DaySummary>(`/sales/day/${day}`);
    setSummary(data);
    // `?cerrar=1`, la puerta de "Cerrar el día" en Inicio: el formulario necesita el resumen.
    if (wantsClose.current) { wantsClose.current = false; setClosing(true); }
  };
  const reload = () => {
    setLoading(true);
    load().catch(() => setSummary(null)).finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  useEffect(() => {
    api.get<Product[]>("/products").then(({ data }) => setProducts(data)).catch(() => setProducts([]));
  }, []);

  // `?nueva=1` abre "Nueva venta" al llegar: es la puerta del `+` de Inicio.
  // Mismo criterio que `?nuevo=1` en Egresos (ver esa pantalla).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("nueva") === "1") openNew();
    else if (params.get("cerrar") === "1") wantsClose.current = true;
    else return;
    router.replace("/ventas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => { setFormKey(k => k + 1); setForm({}); };
  const openEdit = (sale: Sale) => { setViewing(null); setFormKey(k => k + 1); setForm({ sale }); };
  const afterSave = async () => {
    reaccionar("ingreso", form?.sale ? "Venta corregida" : "Venta cargada");
    setForm(null);
    await load();
  };
  const afterClose = async () => { setClosing(false); await load(); };
  const afterDelete = async () => {
    reaccionar("borrado", "Venta eliminada");
    setViewing(null);
    await load();
  };

  const isToday = day === today;
  const date = parseISO(day);
  const dayLabel = isToday ? "hoy" : format(date, "EEEE d 'de' MMMM", { locale: es });
  const pillLabel = isToday ? "Hoy" : format(date, "EEE d MMM", { locale: es }).replace(/\./g, "");
  const tickets = summary?.tickets ?? [];
  const close = summary?.close ?? null;
  const total = Number(summary?.total ?? 0);
  const hasDay = tickets.length > 0 || !!close;
  const hasTickets = tickets.length > 0;
  const steps = useMemo(() => salesIntroSteps({ hasTickets }), [hasTickets]);

  return (
    <div className="space-y-4 md:space-y-6 md:pb-16">
      {/* Una pantalla vacía no lleva guía: queda para cuando haya algo que mostrar. */}
      {!loading && hasDay && <ProductTour tourId="sales-intro" steps={steps} />}

      <section className={BLOCK}>
        <header className="flex items-center justify-between gap-2 px-1.5">
          <h1 className="text-[26px] md:text-3xl font-medium tracking-[-0.035em]">Ventas</h1>
          <DayPill label={pillLabel} data-tour="sales-day"
            onPrev={() => setDay(format(addDays(date, -1), "yyyy-MM-dd"))}
            onNext={() => setDay(format(addDays(date, 1), "yyyy-MM-dd"))}
            prevDisabled={employee && day <= yesterday}
            nextDisabled={day >= today} />
        </header>

        {loading && !summary ? (
          <div className="mt-4 animate-pulse" aria-busy="true">
            <div className="mx-1.5 h-4 w-32 rounded-full bg-white/20" />
            <div className="mx-1.5 mt-2.5 h-11 w-52 rounded-2xl bg-white/20" />
            <div className={`mt-4 h-[74px] ${GLASS}`} />
            <span className="sr-only">Cargando las ventas</span>
          </div>
        ) : summary ? (
          <div className="lg:grid lg:grid-cols-2 lg:gap-10 lg:items-end">
            <MotionList className="px-1.5 pt-3.5">
              {/* Sin nada cargado no hay cifra: un "$ 0" gigante no le dice nada a nadie. */}
              {hasDay ? (
                <>
                  <p className="text-[15.5px] font-medium">{close ? "Contado al cerrar" : "Vendido"}</p>
                  <BlockFigure amount={total} className="mt-0.5 text-[2.75rem]" />
                </>
              ) : (
                <p className="py-1 text-[28px] font-medium leading-[1.1] tracking-[-0.03em]">{isToday ? "Todavía no vendiste hoy." : "Este día no tiene ventas."}</p>
              )}
              <div className={`mt-0.5 items-center justify-between gap-3 min-h-[36px] ${hasDay ? "flex" : "hidden"}`}>
                <span className="text-[15px]">
                  {hasTickets ? `${tickets.length} ${tickets.length === 1 ? "venta" : "ventas"}` : "Sin ventas cargadas"}
                </span>
                {summary.by_method.length > 0 && (
                  <button onClick={() => setShowDetail(v => !v)} aria-expanded={showDetail}
                    className="inline-flex items-center gap-1 min-h-[36px] text-[15px] font-semibold">
                    {showDetail ? "Ver menos" : "Ver detalle"}
                    <ChevronDown className={`w-4 h-4 transition-transform ${showDetail ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>
              {showDetail && (
                <div className="mt-1 pb-1 space-y-1 text-[15px]">
                  {summary.by_method.map(m => (
                    <p key={m.method} className="flex items-baseline justify-between gap-4">
                      <span className="truncate">{PAYMENT_METHOD_LABELS[m.method]}</span>
                      <span className="font-medium tabular-nums shrink-0">{formatARS(m.counted ?? m.ticketed)}</span>
                    </p>
                  ))}
                </div>
              )}
            </MotionList>
            <ClosePanel summary={summary} onClick={() => setClosing(true)} data-tour="sales-close" />
          </div>
        ) : null}
      </section>

      {!loading && !summary ? (
        <LoadError message="No se pudieron cargar las ventas." onRetry={reload} />
      ) : summary && (
        <>
          {summary.warnings.length > 0 && (
            <MotionList className="rounded-3xl bg-accent border border-[#CFC9E4] p-3.5 space-y-2" role="status">
              {/* El último es el más urgente (una venta después del cierre). Los demás,
                  plegados: varios avisos a la vista mandaban la lista fuera de la pantalla. */}
              {(allWarnings ? [...summary.warnings].reverse() : summary.warnings.slice(-1)).map(w => (
                <p key={w} className="flex items-start gap-2 text-[15px] leading-snug text-foreground">
                  <TriangleAlert className="w-4 h-4 text-[#3B2FB3] shrink-0 mt-0.5" />
                  {w}
                </p>
              ))}
              {summary.warnings.length > 1 && (
                <button onClick={() => setAllWarnings(v => !v)} aria-expanded={allWarnings}
                  className="min-h-[36px] pl-6 text-[15px] font-semibold text-[#3B2FB3]">
                  {allWarnings ? "Ver menos" : `Ver ${summary.warnings.length - 1 === 1 ? "el otro aviso" : `los otros ${summary.warnings.length - 1} avisos`}`}
                </button>
              )}
            </MotionList>
          )}

          <section className="px-2">
            <h2 className={`${SECTION_TITLE} mb-1 first-letter:uppercase`}>{isToday ? "Las de hoy" : `Las del ${dayLabel}`}</h2>
            <MotionList key={summary.sale_date} className="animate-page-in">
            {tickets.length === 0 ? (
              <EmptyState text={close ? "El día se cerró sin cargar venta por venta." : "Cargá la primera con el +, o cerrá el día con lo que hay en la caja."} action={close ? undefined : "Cargar una venta"} onAction={openNew} />
            ) : (
              <MotionList data-tour="sales-list">
                {tickets.map(t => <SaleRow key={t.id} sale={t} products={products} onOpen={() => setViewing(t)} />)}
              </MotionList>
            )}
            </MotionList>
          </section>
        </>
      )}

      <Fab label="Nueva venta" data-tour="sales-add" onClick={openNew} />

      {viewing && (
        <SaleSheet sale={viewing} products={products} dayClosed={!!close}
          onEdit={() => openEdit(viewing)} onDeleted={afterDelete} onClose={() => setViewing(null)} />
      )}
      {form && (
        <SaleFormModal
          key={formKey}
          sale={form.sale}
          initial={form.sale ? draftFromSale(form.sale) : undefined}
          saleDate={day}
          products={products}
          onSaved={afterSave}
          onClose={() => setForm(null)}
        />
      )}
      {closing && summary && (
        <DailyCloseModal summary={summary} title={isToday ? "Cierre de hoy" : `Cierre del ${dayLabel}`}
          products={products} onSaved={afterClose} onClose={() => setClosing(false)} />
      )}
    </div>
  );
}

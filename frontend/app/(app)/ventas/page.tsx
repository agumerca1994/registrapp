"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronRight, TriangleAlert } from "lucide-react";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Fab } from "@/components/ui/fab";
import {
  SummaryCard, SummaryHeader, SummarySection, SummaryGrid, SummaryCell, SummaryFigure, ChainRow, SummaryTotal,
} from "@/components/ui/summary-card";
import { DayPill } from "@/components/sales/DayPill";
import SaleFormModal from "@/components/sales/SaleFormModal";
import DailyCloseModal from "@/components/sales/DailyCloseModal";
import {
  PAYMENT_METHOD_LABELS, businessToday, draftFromSale, saleSummary,
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
  const today = businessToday();
  const [day, setDay] = useState(today);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<null | { sale?: Sale }>(null);
  const [formKey, setFormKey] = useState(0);
  const [closing, setClosing] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const load = async () => {
    const { data } = await api.get<DaySummary>(`/sales/day/${day}`);
    setSummary(data);
  };

  useEffect(() => {
    setLoading(true);
    load().catch(() => setSummary(null)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  useEffect(() => {
    api.get<Product[]>("/products").then(({ data }) => setProducts(data)).catch(() => setProducts([]));
  }, []);

  // `?nueva=1` abre "Nueva venta" al llegar: es la puerta del `+` de Inicio.
  // Mismo criterio que `?nuevo=1` en Egresos (ver esa pantalla).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("nueva") !== "1") return;
    openNew();
    router.replace("/ventas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => { setFormKey(k => k + 1); setForm({}); };
  const openEdit = (sale: Sale) => { setFormKey(k => k + 1); setForm({ sale }); };
  const afterSave = async () => { setForm(null); setClosing(false); await load(); };

  const isToday = day === today;
  const date = parseISO(day);
  const dayLabel = isToday ? "hoy" : format(date, "EEEE d 'de' MMMM", { locale: es });
  const pillLabel = isToday ? "Hoy" : format(date, "EEE d MMM", { locale: es });
  const tickets = summary?.tickets ?? [];
  const close = summary?.close ?? null;

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Ventas</h2>
        <DayPill label={pillLabel}
          onPrev={() => setDay(format(addDays(date, -1), "yyyy-MM-dd"))}
          onNext={() => setDay(format(addDays(date, 1), "yyyy-MM-dd"))}
          nextDisabled={day >= today} />
      </div>

      {loading ? (
        <Card variant="hero" className="h-40 animate-pulse" />
      ) : summary ? (
        <>
          <SummaryCard>
            <SummaryHeader title={isToday ? "Ventas de hoy" : `Ventas del ${dayLabel}`}
              open={showDetail} onToggle={summary.by_method.length ? () => setShowDetail(v => !v) : undefined} />
            <SummarySection label={close ? "Contado al cerrar" : "Vendido"} />
            <SummaryGrid>
              <SummaryCell figure>
                <SummaryFigure value={formatARS(summary.total)}
                  sub={`${tickets.length} venta${tickets.length !== 1 ? "s" : ""}${close ? " · día cerrado" : ""}`} />
              </SummaryCell>
              {showDetail && (
                <SummaryCell className="border-t border-border/60">
                  {summary.by_method.map(m => (
                    <ChainRow key={m.method} label={PAYMENT_METHOD_LABELS[m.method]}
                      value={formatARS(m.counted ?? m.ticketed)} />
                  ))}
                </SummaryCell>
              )}
            </SummaryGrid>
            {showDetail && <SummaryTotal label="Total" items={[formatARS(summary.total)]} />}
          </SummaryCard>

          {summary.warnings.map(w => (
            <Card key={w} className="flex items-start gap-2 border-amber-300 bg-amber-50/60 p-3" role="status">
              <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-900">{w}</p>
            </Card>
          ))}

          <Card className="p-4 md:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-sm md:text-base truncate">Cierre del día</h3>
              <Chip tone={close ? "emerald" : "amber"} className="ml-auto shrink-0">
                {close ? "Cerrado" : "Sin cerrar"}
              </Chip>
            </div>
            <p className="text-sm text-muted-foreground">
              {close
                ? `Contaste ${formatARS(close.total)}. El día suma lo contado.`
                : tickets.length
                  ? "Al terminar, contá la caja: se precarga con las ventas de cada medio."
                  : "Si no cargás venta por venta, cerrá el día con lo que hay en la caja."}
            </p>
            <Button variant={close ? "outline" : "primary"} onClick={() => setClosing(true)}>
              {close ? "Editar cierre" : "Cerrar el día"}
            </Button>
          </Card>

          <Card className="p-0 divide-y overflow-hidden">
            {tickets.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                Todavía no hay ventas cargadas {isToday ? "hoy" : "este día"}.
              </p>
            ) : tickets.map(t => (
              <button key={t.id} onClick={() => openEdit(t)} data-testid="sale-row"
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors">
                <span className="text-xs text-muted-foreground tabular-nums w-10 shrink-0">
                  {format(new Date(t.created_at + "Z"), "HH:mm")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{saleSummary(t, products)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {t.payments.map(p => PAYMENT_METHOD_LABELS[p.method]).join(" + ")}
                  </p>
                </div>
                <span className="text-sm font-semibold text-emerald-700 tabular-nums shrink-0">{formatARS(t.total)}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
              </button>
            ))}
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No se pudieron cargar las ventas.</p>
      )}

      <Fab label="Nueva venta" onClick={openNew} />

      {form && (
        <SaleFormModal
          key={formKey}
          sale={form.sale}
          initial={form.sale ? draftFromSale(form.sale) : undefined}
          saleDate={day}
          products={products}
          onSaved={afterSave}
          onDeleted={afterSave}
          onClose={() => setForm(null)}
        />
      )}
      {closing && summary && (
        <DailyCloseModal summary={summary} title={isToday ? "Cierre de hoy" : `Cierre del ${dayLabel}`}
          products={products} onSaved={afterSave} onClose={() => setClosing(false)} />
      )}
    </div>
  );
}

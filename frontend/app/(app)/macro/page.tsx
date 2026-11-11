"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, Settings2 } from "lucide-react";
import api from "@/lib/api";
import { formatPct, getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { MonthField } from "@/components/ui/form";
import { EntrySheet, SheetRow } from "@/components/movimientos/EntrySheet";
import { FormSheet } from "@/components/movimientos/FormSheet";
import { LedgerRow } from "@/components/movimientos/Ledger";

const MACRO_VAR_DEFS = [
  { key: "uva_value",                label: "UVA" },
  { key: "uvi",                      label: "UVI" },
  { key: "icl",                      label: "ICL (Alquileres)" },
  { key: "inflation_monthly_pct",    label: "Inflación mensual" },
  { key: "inflation_interanual_pct", label: "Inflación interanual" },
  { key: "usd_official",             label: "USD Oficial" },
  { key: "usd_blue",                 label: "USD Blue" },
  { key: "usd_mayorista",            label: "USD Mayorista" },
  { key: "usd_mep",                  label: "USD MEP (Bolsa)" },
  { key: "usd_ccl",                  label: "USD CCL" },
  { key: "ripte",                    label: "RIPTE" },
  { key: "smvm",                     label: "Sal. Mín. (SMVM)" },
  { key: "canasta_basica_total",     label: "Canasta Básica" },
] as const;

type MacroVarKey = typeof MACRO_VAR_DEFS[number]["key"];
const PCT_KEYS = new Set<MacroVarKey>(["inflation_monthly_pct", "inflation_interanual_pct"]);
const IDX_KEYS = new Set<MacroVarKey>(["icl"]);

interface MacroVar {
  id: number; period_date: string; source?: string;
  uva_value?: number; uvi?: number; icl?: number;
  inflation_monthly_pct?: number; inflation_interanual_pct?: number;
  usd_official?: number; usd_blue?: number; usd_mayorista?: number; usd_mep?: number; usd_ccl?: number;
  ripte?: number; smvm?: number; canasta_basica_total?: number;
}

const number = (v: number) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

// Dato público, no de la cuenta: por eso no pasa por formatARS, que lo taparía con
// "Ocultar montos".
function fmt(key: MacroVarKey, value: number): string {
  if (PCT_KEYS.has(key)) return formatPct(value);
  if (IDX_KEYS.has(key)) return number(value);
  return `$ ${number(value)}`;
}

/** El valor de una variable en un día. Sin dato (null) no se muestra: un guion no dice nada. */
function valueOf(record: MacroVar, key: MacroVarKey): number | null {
  const v = record[key];
  return v == null ? null : Number(v);
}

const THIS_YEAR = new Date().getFullYear();
const TODAY_MONTH = `${THIS_YEAR}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

const RANGE_OPTIONS = [
  { label: "7 días",  value: "7d" },
  { label: "1 mes",   value: "1m" },
  { label: "3 meses", value: "3m" },
  { label: "6 meses", value: "6m" },
  { label: "1 año",   value: "1y" },
  { label: "Todo",    value: "all" },
];

function rangeToFromDate(range: string): string | null {
  const today = new Date();
  const shift = (months: number) => {
    const d = new Date(today); d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };
  if (range === "7d") { const d = new Date(today); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }
  if (range === "1m")  return shift(1);
  if (range === "3m")  return shift(3);
  if (range === "6m")  return shift(6);
  if (range === "1y")  return shift(12);
  if (range === "all") return null;
  return null;
}

// En cada fila del historial va el dato que más se mira, de los que están prendidos.
const ROW_PRIORITY: MacroVarKey[] = [
  "usd_blue", "usd_official", "uva_value", "usd_mep", "usd_ccl", "usd_mayorista",
  "inflation_monthly_pct", "inflation_interanual_pct", "uvi", "icl", "ripte", "smvm", "canasta_basica_total",
];
const labelOf = (key: MacroVarKey) => MACRO_VAR_DEFS.find(v => v.key === key)!.label;

function rowVars(record: MacroVar, visible: Record<string, boolean>): MacroVarKey[] {
  return ROW_PRIORITY.filter(k => visible[k] !== false && valueOf(record, k) !== null);
}

// ── La ficha de un día ─────────────────────────────────────────────────────────

function MacroDetailModal({ record, visibleVars, onClose }: {
  record: MacroVar; visibleVars: Record<string, boolean>; onClose: () => void;
}) {
  const [main, ...others] = rowVars(record, visibleVars);
  return (
    <EntrySheet
      date={record.period_date}
      title={main ? labelOf(main) : "Sin datos ese día"}
      badge={{ label: "Automático" }}
      amount={main ? fmt(main, valueOf(record, main)!) : "Sin dato"}
      onClose={onClose}
      footer={null}
    >
      {others.map(key => (
        <SheetRow key={key} label={labelOf(key)}>
          <span className="tabular-nums">{fmt(key, valueOf(record, key)!)}</span>
        </SheetRow>
      ))}
    </EntrySheet>
  );
}

// ── Qué mostrar e historial ────────────────────────────────────────────────────

function ConfigSheet({ visibleVars, onToggle, backfillFrom, setBackfillFrom, backfilling, backfillError, onBackfill, onClose }: {
  visibleVars: Record<string, boolean>;
  onToggle: (key: string) => void;
  backfillFrom: string;
  setBackfillFrom: (v: string) => void;
  backfilling: boolean;
  backfillError: string;
  onBackfill: () => void;
  onClose: () => void;
}) {
  return (
    <FormSheet title="Configurar variables" onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-4 space-y-4">
        <div>
          <p className="px-1.5 mb-2 text-sm text-[#4A4658]">Variables a mostrar</p>
          <div className="flex flex-wrap gap-2">
            {MACRO_VAR_DEFS.map(({ key, label }) => {
              const on = visibleVars[key] !== false;
              return (
                <button key={key} type="button" aria-pressed={on} onClick={() => onToggle(key)}
                  className={`min-h-[40px] px-3.5 rounded-full border text-sm font-medium transition-colors active:scale-[0.97] ${
                    on ? "border-[#CFC9E4] bg-accent text-[#3B2FB3]" : "border-border bg-white/70 text-muted-foreground"
                  }`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-[22px] bg-white/70 border border-white/80 p-3.5">
          <p className="text-[15.5px] font-semibold text-foreground">Cargar datos históricos</p>
          <p className="mt-0.5 text-sm leading-snug text-[#4A4658]">
            Trae un registro por día desde el mes elegido hasta hoy y lo suma a lo que ya está cargado.
          </p>
          <MonthField className="mt-2"
            value={backfillFrom} onChange={setBackfillFrom}
            min="2016-01" max={TODAY_MONTH} disabled={backfilling} />
          <button type="button" onClick={onBackfill} disabled={backfilling || !backfillFrom}
            className="mt-2.5 w-full h-[52px] rounded-full bg-ink text-background font-semibold text-[15.5px] inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
            {backfilling ? <><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</> : "Cargar historial"}
          </button>
          {backfillError && <p role="alert" className="mt-2 text-sm text-destructive">{backfillError}</p>}
        </div>
      </div>
    </FormSheet>
  );
}

// ── Pantalla ───────────────────────────────────────────────────────────────────

const DEFAULT_VISIBLE: Record<string, boolean> = {
  uva_value: true, uvi: true, icl: false,
  inflation_monthly_pct: true, inflation_interanual_pct: true,
  usd_official: true, usd_blue: true, usd_mayorista: false, usd_mep: true, usd_ccl: true,
  ripte: true, smvm: false, canasta_basica_total: false,
};

export default function MacroPage() {
  const [records, setRecords] = useState<MacroVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillError, setBackfillError] = useState("");
  const [detailRecord, setDetailRecord] = useState<MacroVar | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [visibleVars, setVisibleVars] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);
  const [range, setRange] = useState("1m");
  const [backfillFrom, setBackfillFrom] = useState("2025-01");

  const loadDisplay = async (r: string) => {
    const from = rangeToFromDate(r);
    const url = from ? `/macro?from_date=${from}` : "/macro";
    try {
      const res = await api.get(url);
      setRecords(res.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("macro_visible_vars");
      if (saved) setVisibleVars(JSON.parse(saved));
      const savedRange = localStorage.getItem("macro_range");
      if (savedRange) setRange(savedRange);
    } catch {}
  }, []);

  useEffect(() => {
    setLoading(true);
    const r = (() => { try { return localStorage.getItem("macro_range") || "1m"; } catch { return "1m"; } })();
    loadDisplay(r).finally(() => setLoading(false));
  }, []);

  const toggleVar = (key: string) => {
    setVisibleVars(prev => {
      const next = { ...prev, [key]: prev[key] === false };
      try { localStorage.setItem("macro_visible_vars", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const changeRange = (r: string) => {
    setRange(r);
    try { localStorage.setItem("macro_range", r); } catch {}
    setLoading(true);
    loadDisplay(r).finally(() => setLoading(false));
  };

  const runBackfill = async () => {
    if (!backfillFrom) return;
    const [year, month] = backfillFrom.split("-").map(Number);
    setBackfilling(true);
    setBackfillError("");
    try {
      await api.post(`/macro/backfill?from_year=${year}&from_month=${month}`, {}, { timeout: 120000 });
      await loadDisplay(range);
      setShowConfig(false);
    } catch (e) {
      setBackfillError(getErrorMessage(e, "No se pudo traer el historial. Probá de nuevo en un rato."));
    } finally {
      setBackfilling(false);
    }
  };

  // Lo que se viene a mirar: los valores de hoy, sin tocar nada.
  const latest = records[0];
  const latestVars = latest ? MACRO_VAR_DEFS.filter(v => visibleVars[v.key] !== false && valueOf(latest, v.key) !== null) : [];

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Variables macro</h1>
          <p className="text-sm text-muted-foreground">Se actualizan solas todos los días</p>
        </div>
        <button onClick={() => setShowConfig(true)} title="Configurar variables" aria-label="Configurar variables"
          className="w-11 h-11 -mr-2 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Settings2 className="w-5 h-5" />
        </button>
      </div>

      {latestVars.length > 0 && (
        <Card className="p-4 md:p-5">
          <p className="font-marca text-xs text-muted-foreground">
            {format(parseISO(latest.period_date), "EEE d MMM", { locale: es }).replace(/\./g, "")}
          </p>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-2.5">
            {latestVars.map(({ key, label }) => (
              <div key={key} className="min-w-0">
                <p className="text-sm text-muted-foreground truncate">{label}</p>
                <p className="text-lg font-medium tracking-[-0.02em] tabular-nums text-foreground truncate">
                  {fmt(key, valueOf(latest, key)!).replace(/,00$/, "")}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ChoiceChips ariaLabel="Período" value={range} onChange={changeRange}
        options={RANGE_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />

      <section className="px-2">
        {failed ? (
          <div role="alert" className="py-4 text-[15px] text-muted-foreground">
            <p>No pudimos traer las variables.</p>
            <button onClick={() => changeRange(range)} className="mt-1 font-semibold text-foreground underline">Probar de nuevo</button>
          </div>
        ) : backfilling ? (
          <p className="py-4 flex items-center gap-2 text-[15px] text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando datos históricos día a día…
          </p>
        ) : loading ? (
          <p className="py-4 text-[15px] text-muted-foreground">Cargando…</p>
        ) : records.length === 0 ? (
          <div className="py-4 text-[15px] text-muted-foreground">
            <p>Sin datos para el período seleccionado.</p>
            <button onClick={() => setShowConfig(true)} className="mt-1 font-semibold text-foreground underline">Traer el historial</button>
          </div>
        ) : (
          <div>
            {records.map(r => {
              const [main, second] = rowVars(r, visibleVars);
              return (
                <LedgerRow key={r.id}
                  date={r.period_date}
                  title={main ? labelOf(main) : "Sin datos"}
                  sub={second ? `${labelOf(second)} ${fmt(second, valueOf(r, second)!).replace(/,00$/, "")}` : undefined}
                  amount={main ? fmt(main, valueOf(r, main)!).replace(/,00$/, "") : ""}
                  onOpen={() => setDetailRecord(r)}
                />
              );
            })}
          </div>
        )}
      </section>

      {detailRecord && (
        <MacroDetailModal record={detailRecord} visibleVars={visibleVars} onClose={() => setDetailRecord(null)} />
      )}

      {showConfig && (
        <ConfigSheet
          visibleVars={visibleVars} onToggle={toggleVar}
          backfillFrom={backfillFrom} setBackfillFrom={setBackfillFrom}
          backfilling={backfilling} backfillError={backfillError}
          onBackfill={runBackfill} onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}

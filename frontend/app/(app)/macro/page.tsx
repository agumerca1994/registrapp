"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS, formatPct, formatDate } from "@/lib/utils";
import { X, Settings2, ChevronRight, Loader2 } from "lucide-react";

const MACRO_VAR_DEFS = [
  { key: "uva_value",                label: "UVA" },
  { key: "inflation_monthly_pct",    label: "Inflación mensual" },
  { key: "inflation_interanual_pct", label: "Inflación interanual" },
  { key: "usd_official",             label: "USD Oficial" },
  { key: "usd_blue",                 label: "USD Blue" },
  { key: "usd_mayorista",            label: "USD Mayorista" },
  { key: "ripte",                    label: "RIPTE" },
  { key: "smvm",                     label: "Sal. Mín. (SMVM)" },
  { key: "canasta_basica_total",     label: "Canasta Básica" },
] as const;

type MacroVarKey = typeof MACRO_VAR_DEFS[number]["key"];
const PCT_KEYS = new Set<MacroVarKey>(["inflation_monthly_pct", "inflation_interanual_pct"]);

interface MacroVar {
  id: number; period_date: string; source?: string;
  uva_value?: number; inflation_monthly_pct?: number; inflation_interanual_pct?: number;
  usd_official?: number; usd_blue?: number; usd_mayorista?: number;
  ripte?: number; smvm?: number; canasta_basica_total?: number;
}

function fmt(key: MacroVarKey, value?: number): string {
  if (value == null) return "—";
  return PCT_KEYS.has(key) ? formatPct(value) : formatARS(value);
}

// Current year dynamic
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 2019 }, (_, i) => THIS_YEAR - i); // [2026, 2025, ..., 2020]

const RANGE_OPTIONS = [
  { label: "3 meses", value: "3m" },
  { label: "6 meses", value: "6m" },
  ...YEARS.map(y => ({ label: String(y), value: String(y) })),
  { label: "Todo", value: "all" },
];

function rangeToFromDate(range: string): string | null {
  const today = new Date();
  if (range === "3m") {
    const d = new Date(today); d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  }
  if (range === "6m") {
    const d = new Date(today); d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  }
  if (range === "all") return "2020-01-01";
  if (/^\d{4}$/.test(range)) return `${range}-01-01`;
  return null;
}

function rangeToBackfillParams(range: string): { from_year: number; from_month: number } {
  const today = new Date();
  if (range === "3m") {
    const d = new Date(today); d.setMonth(d.getMonth() - 3);
    return { from_year: d.getFullYear(), from_month: d.getMonth() + 1 };
  }
  if (range === "6m") {
    const d = new Date(today); d.setMonth(d.getMonth() - 6);
    return { from_year: d.getFullYear(), from_month: d.getMonth() + 1 };
  }
  if (range === "all") return { from_year: 2020, from_month: 1 };
  if (/^\d{4}$/.test(range)) return { from_year: parseInt(range), from_month: 1 };
  return { from_year: today.getFullYear(), from_month: 1 };
}

// ── Detail modal ───────────────────────────────────────────────────────────────

function MacroDetailModal({ record, visibleVars, onClose }: {
  record: MacroVar; visibleVars: Record<string, boolean>; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{formatDate(record.period_date)}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full mt-1.5 inline-block font-medium bg-green-50 text-green-700">
              Automático
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="divide-y text-sm">
          {MACRO_VAR_DEFS.filter(v => visibleVars[v.key] !== false).map(({ key, label }) => (
            <div key={key} className="flex justify-between py-2">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{fmt(key, record[key as keyof MacroVar] as number | undefined)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const DEFAULT_VISIBLE: Record<string, boolean> = {
  uva_value: true, inflation_monthly_pct: true, inflation_interanual_pct: true,
  usd_official: true, usd_blue: true, usd_mayorista: false,
  ripte: true, smvm: false, canasta_basica_total: false,
};

export default function MacroPage() {
  const [records, setRecords] = useState<MacroVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [detailRecord, setDetailRecord] = useState<MacroVar | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [visibleVars, setVisibleVars] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);
  const [range, setRange] = useState(String(THIS_YEAR));

  const loadDisplay = async (r: string) => {
    const from = rangeToFromDate(r);
    const url = from ? `/macro?from_date=${from}` : "/macro";
    const res = await api.get(url);
    setRecords(res.data);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("macro_visible_vars");
      if (saved) setVisibleVars(JSON.parse(saved));
      const savedRange = localStorage.getItem("macro_range");
      if (savedRange) { setRange(savedRange); }
    } catch {}
  }, []);

  // Load data on mount (no backfill on initial load)
  useEffect(() => {
    setLoading(true);
    const r = (() => {
      try { return localStorage.getItem("macro_range") || String(THIS_YEAR); } catch { return String(THIS_YEAR); }
    })();
    loadDisplay(r).finally(() => setLoading(false));
  }, []);

  const toggleVar = (key: string) => {
    setVisibleVars(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("macro_visible_vars", JSON.stringify(next));
      return next;
    });
  };

  // Chip click: backfill then display
  const selectRange = async (r: string) => {
    setRange(r);
    localStorage.setItem("macro_range", r);
    setSyncing(true);
    setLoading(true);
    try {
      const { from_year, from_month } = rangeToBackfillParams(r);
      await api.post(`/macro/backfill?from_year=${from_year}&from_month=${from_month}`, {}, { timeout: 90000 });
    } catch { /* ignore backfill errors */ }
    try {
      await loadDisplay(r);
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">Variables macro</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {syncing ? (
              <span className="flex items-center gap-1 text-blue-600">
                <Loader2 className="w-3 h-3 animate-spin" /> Actualizando datos...
              </span>
            ) : "Actualización automática diaria"}
          </p>
        </div>
        <button
          onClick={() => setShowConfig(v => !v)}
          className={`border p-1.5 rounded-lg hover:bg-gray-50 transition-colors ${showConfig ? "bg-gray-100 border-gray-300" : ""}`}
          title="Configurar variables"
        >
          <Settings2 className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      {showConfig && (
        <div className="bg-gray-50 border rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">Variables a mostrar</p>
          <div className="grid grid-cols-2 gap-2">
            {MACRO_VAR_DEFS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibleVars[key] !== false}
                  onChange={() => toggleVar(key)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Range chips — click = backfill + display */}
      <div className="space-y-1">
        <div className="flex gap-1.5 flex-wrap">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => selectRange(opt.value)}
              disabled={syncing}
              className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                range === opt.value
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">Tocá un período para cargar o actualizar esos datos</p>
      </div>

      <div className="bg-white rounded-xl border divide-y">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
            {syncing && <Loader2 className="w-4 h-4 animate-spin" />}
            {syncing ? "Cargando datos históricos..." : "Cargando..."}
          </div>
        ) : records.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground space-y-1">
            <p>Sin datos para el período seleccionado.</p>
            <p className="text-xs">Tocá el chip del período para cargarlos.</p>
          </div>
        ) : records.map(r => (
          <button
            key={r.id}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
            onClick={() => setDetailRecord(r)}
          >
            <span className="text-sm font-medium text-gray-900">{formatDate(r.period_date)}</span>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </button>
        ))}
      </div>

      {detailRecord && (
        <MacroDetailModal
          record={detailRecord}
          visibleVars={visibleVars}
          onClose={() => setDetailRecord(null)}
        />
      )}
    </div>
  );
}

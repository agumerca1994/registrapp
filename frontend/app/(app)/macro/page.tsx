"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS, formatPct, formatDate } from "@/lib/utils";
import { X, Settings2, ChevronRight } from "lucide-react";

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

// ── Detail modal ───────────────────────────────────────────────────────────────

function MacroDetailModal({
  record, visibleVars, onClose,
}: {
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
  const [detailRecord, setDetailRecord] = useState<MacroVar | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [visibleVars, setVisibleVars] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);

  useEffect(() => {
    api.get("/macro").then(r => setRecords(r.data)).finally(() => setLoading(false));
    try {
      const saved = localStorage.getItem("macro_visible_vars");
      if (saved) setVisibleVars(JSON.parse(saved));
    } catch {}
  }, []);

  const toggleVar = (key: string) => {
    setVisibleVars(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("macro_visible_vars", JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">Variables macro</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Actualización automática diaria</p>
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

      <div className="bg-white rounded-xl border divide-y">
        {loading ? (
          <p className="p-6 text-muted-foreground text-sm">Cargando...</p>
        ) : records.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">Sin datos aún — se sincronizarán automáticamente.</p>
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

"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS, formatPct, formatDate } from "@/lib/utils";
import { Trash2, X, Settings2, ChevronRight } from "lucide-react";

const MACRO_VAR_DEFS = [
  { key: "uva_value", label: "UVA" },
  { key: "inflation_monthly_pct", label: "Inflación mensual" },
  { key: "usd_official", label: "USD Oficial" },
  { key: "usd_mep", label: "USD MEP" },
] as const;

type MacroVarKey = typeof MACRO_VAR_DEFS[number]["key"];

interface MacroVar {
  id: number; period_date: string;
  uva_value?: number; inflation_monthly_pct?: number;
  usd_official?: number; usd_mep?: number; source?: string;
}

function sourceLabel(source?: string) {
  return source === "bcra_api" ? "Automático" : "Manual";
}

function formatMacroValue(key: MacroVarKey, value?: number): string {
  if (value == null) return "—";
  return key === "inflation_monthly_pct" ? formatPct(value) : formatARS(value);
}

// ── Detail modal ───────────────────────────────────────────────────────────────

function MacroDetailModal({
  record, visibleVars, onDelete, onClose,
}: {
  record: MacroVar;
  visibleVars: Record<string, boolean>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isAuto = record.source === "bcra_api";
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{formatDate(record.period_date)}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full mt-1.5 inline-block font-medium ${
              isAuto ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
            }`}>
              {sourceLabel(record.source)}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="divide-y text-sm">
          {MACRO_VAR_DEFS.filter(v => visibleVars[v.key] !== false).map(({ key, label }) => (
            <div key={key} className="flex justify-between py-2">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">
                {formatMacroValue(key, record[key as keyof MacroVar] as number | undefined)}
              </span>
            </div>
          ))}
        </div>

        <button onClick={onDelete}
          className="w-full flex items-center justify-center gap-1.5 border border-red-200 text-red-500 hover:bg-red-50 py-2.5 rounded-xl text-sm font-medium">
          <Trash2 className="w-4 h-4" /> Eliminar
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const DEFAULT_VISIBLE: Record<string, boolean> = {
  uva_value: true, inflation_monthly_pct: true, usd_official: true, usd_mep: false,
};

export default function MacroPage() {
  const [records, setRecords] = useState<MacroVar[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    period_date: "", uva_value: "", inflation_monthly_pct: "",
    usd_official: "", usd_mep: "",
  });
  const [syncDate, setSyncDate] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [detailRecord, setDetailRecord] = useState<MacroVar | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [visibleVars, setVisibleVars] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);

  const load = () => api.get("/macro").then(r => setRecords(r.data));

  useEffect(() => {
    load();
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

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este registro?")) return;
    await api.delete(`/macro/${id}`);
    setDetailRecord(null);
    load();
  };

  const handleSync = async () => {
    if (!syncDate) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      await api.post(`/macro/sync-bcra?period_date=${syncDate}`);
      setSyncMsg("Sincronizado correctamente");
      await load();
    } catch {
      setSyncMsg("Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, k === "period_date" ? v : v ? parseFloat(v) : null])
    );
    await api.put("/macro", body);
    setForm({ period_date: "", uva_value: "", inflation_monthly_pct: "", usd_official: "", usd_mep: "" });
    setShowForm(false);
    load();
  };

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">Variables macro</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowConfig(v => !v)}
              className={`border p-1.5 rounded-lg hover:bg-gray-50 transition-colors ${showConfig ? "bg-gray-100 border-gray-300" : ""}`}
              title="Configurar variables"
            >
              <Settings2 className="w-4 h-4 text-gray-600" />
            </button>
            <button onClick={() => setShowForm(true)}
              className="bg-primary text-white text-sm px-3 py-1.5 rounded-lg hover:opacity-90">
              + Cargar
            </button>
          </div>
        </div>

        {/* Config panel */}
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

        {/* Sync BCRA */}
        <div className="flex gap-2">
          <input type="date" className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
            value={syncDate} onChange={e => setSyncDate(e.target.value)} />
          <button onClick={handleSync} disabled={syncing || !syncDate}
            className="border text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 shrink-0">
            {syncing ? "Sincronizando..." : "Sync BCRA"}
          </button>
        </div>
        {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}
      </div>

      {/* Manual entry form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-gray-600">Período</label>
            <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.period_date} onChange={e => setForm(p => ({ ...p, period_date: e.target.value }))} required />
          </div>
          {MACRO_VAR_DEFS.filter(v => visibleVars[v.key] !== false).map(({ key, label }) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-600">{label}</label>
              <input type="number" step="0.0001" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form[key as keyof typeof form]}
                onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" className="bg-primary text-white px-4 py-2 rounded-lg text-sm">Guardar</button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border divide-y">
        {records.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">No hay variables macro cargadas.</p>
        ) : records.map(r => (
          <button
            key={r.id}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
            onClick={() => setDetailRecord(r)}
          >
            <span className="text-sm font-medium text-gray-900">{formatDate(r.period_date)}</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                r.source === "bcra_api" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
              }`}>
                {sourceLabel(r.source)}
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </div>
          </button>
        ))}
      </div>

      {detailRecord && (
        <MacroDetailModal
          record={detailRecord}
          visibleVars={visibleVars}
          onDelete={() => handleDelete(detailRecord.id)}
          onClose={() => setDetailRecord(null)}
        />
      )}
    </div>
  );
}

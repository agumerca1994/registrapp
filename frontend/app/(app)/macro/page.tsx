"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS, formatPct, formatDate } from "@/lib/utils";
import { Trash2 } from "lucide-react";

interface MacroVar {
  id: number; period_date: string;
  uva_value?: number; inflation_monthly_pct?: number;
  usd_official?: number; usd_mep?: number; source?: string;
}

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

  const load = () => api.get("/macro").then(r => setRecords(r.data));
  useEffect(() => { load(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este registro?")) return;
    await api.delete(`/macro/${id}`);
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
      {/* Header — stacks on mobile */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">Variables macro</h2>
          <button onClick={() => setShowForm(true)}
            className="bg-primary text-white text-sm px-3 py-1.5 rounded-lg hover:opacity-90">
            + Cargar
          </button>
        </div>
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

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-gray-600">Período</label>
            <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.period_date} onChange={e => setForm(p => ({ ...p, period_date: e.target.value }))} required />
          </div>
          {[
            ["uva_value", "Valor UVA"],
            ["inflation_monthly_pct", "Inflación mensual (%)"],
            ["usd_official", "Dólar oficial"],
            ["usd_mep", "Dólar MEP"],
          ].map(([key, label]) => (
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

      <div className="bg-white rounded-xl border divide-y">
        {records.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">No hay variables macro cargadas.</p>
        ) : records.map(r => (
          <div key={r.id} className="px-4 py-3 md:px-5 md:py-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{formatDate(r.period_date)}</p>
                {r.source && <span className="text-xs text-muted-foreground">{r.source}</span>}
              </div>
              <button onClick={() => handleDelete(r.id)} className="text-gray-400 hover:text-destructive ml-2 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
              <div>
                <p className="text-xs text-muted-foreground">UVA</p>
                <p className="text-sm font-medium">{r.uva_value ? formatARS(r.uva_value) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Inflación</p>
                <p className="text-sm font-medium">{r.inflation_monthly_pct ? formatPct(r.inflation_monthly_pct) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">USD Oficial</p>
                <p className="text-sm font-medium">{r.usd_official ? formatARS(r.usd_official) : "—"}</p>
              </div>
              {r.usd_mep && (
                <div>
                  <p className="text-xs text-muted-foreground">USD MEP</p>
                  <p className="text-sm font-medium">{formatARS(r.usd_mep)}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

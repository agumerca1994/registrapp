"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS, formatPct } from "@/lib/utils";

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

  const load = () => api.get("/macro").then(r => setRecords(r.data));
  useEffect(() => { load(); }, []);

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
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Variables macro</h2>
        <button onClick={() => setShowForm(true)}
          className="bg-primary text-white text-sm px-4 py-1.5 rounded-lg hover:opacity-90">
          + Cargar mes
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
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
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" className="bg-primary text-white px-4 py-2 rounded-lg text-sm">Guardar</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border divide-y">
        {records.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">No hay variables macro cargadas.</p>
        ) : records.map(r => (
          <div key={r.id} className="px-5 py-4 grid grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Período</p>
              <p className="text-sm font-semibold">{r.period_date}</p>
              {r.source && <span className="text-xs text-muted-foreground">{r.source}</span>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">UVA</p>
              <p className="text-sm font-medium">{r.uva_value ? formatARS(r.uva_value) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inflación</p>
              <p className="text-sm font-medium">{r.inflation_monthly_pct ? formatPct(r.inflation_monthly_pct) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">USD Oficial / MEP</p>
              <p className="text-sm font-medium">
                {r.usd_official ? formatARS(r.usd_official) : "—"} / {r.usd_mep ? formatARS(r.usd_mep) : "—"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS } from "@/lib/utils";
import { Plus } from "lucide-react";

interface MortgageRecord {
  id: number;
  period_date: string;
  payment_amount: number;
  capital: number | null;
  interest: number | null;
  uva_units: number | null;
}

const EMPTY_FORM = { period_date: "", payment_amount: "", capital: "", interest: "", uva_units: "" };

export default function MortgagePage() {
  const [records, setRecords] = useState<MortgageRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data } = await api.get("/mortgage");
    setRecords(data);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await api.put("/mortgage", {
      period_date: form.period_date,
      payment_amount: parseFloat(form.payment_amount),
      capital: form.capital ? parseFloat(form.capital) : null,
      interest: form.interest ? parseFloat(form.interest) : null,
      uva_units: form.uva_units ? parseFloat(form.uva_units) : null,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
    await load();
    setLoading(false);
  };

  const f = (v: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [v]: e.target.value }));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Hipoteca UVA</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary text-white text-sm px-4 py-1.5 rounded-lg hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Registrar cuota
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Período</label>
            <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.period_date} onChange={f("period_date")} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Monto cuota ($)</label>
            <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.payment_amount} onChange={f("payment_amount")} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Capital (opcional)</label>
            <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.capital} onChange={f("capital")} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Interés (opcional)</label>
            <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.interest} onChange={f("interest")} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Unidades UVA (opcional)</label>
            <input type="number" step="0.000001" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.uva_units} onChange={f("uva_units")} />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={loading}
              className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border divide-y">
        {records.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">No hay cuotas registradas aún.</p>
        ) : records.map(r => (
          <div key={r.id} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{r.period_date}</p>
              <p className="text-xs text-muted-foreground">
                {r.uva_units != null ? `${Number(r.uva_units).toFixed(4)} UVAs` : ""}
                {r.capital != null ? ` · Capital ${formatARS(r.capital)}` : ""}
                {r.interest != null ? ` · Interés ${formatARS(r.interest)}` : ""}
              </p>
            </div>
            <span className="text-sm font-semibold text-primary">{formatARS(r.payment_amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

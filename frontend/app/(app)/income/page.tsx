"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS } from "@/lib/utils";
import { Plus, Trash2, Pencil } from "lucide-react";

interface IncomeSource { id: number; name: string; income_type: string; }
interface IncomeEntry {
  id: number; source_id: number; amount: number;
  period_date: string; notes?: string;
  source: IncomeSource;
}

const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "Sueldo", bonus: "Bono", aguinaldo: "Aguinaldo",
  investment: "Inversión", other: "Otro",
};

const EMPTY_FORM = { source_id: "", amount: "", period_date: "", notes: "" };

export default function IncomePage() {
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newSource, setNewSource] = useState({ name: "", income_type: "salary" });
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [e, s] = await Promise.all([api.get("/income/entries"), api.get("/income/sources")]);
    setEntries(e.data);
    setSources(s.data);
  };

  useEffect(() => { load(); }, []);

  const openEdit = (entry: IncomeEntry) => {
    setEditId(entry.id);
    setForm({ source_id: String(entry.source_id), amount: String(entry.amount), period_date: entry.period_date, notes: entry.notes || "" });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload = { ...form, source_id: parseInt(form.source_id), amount: parseFloat(form.amount) };
    if (editId) {
      await api.patch(`/income/entries/${editId}`, payload);
    } else {
      await api.post("/income/entries", payload);
    }
    closeForm();
    await load();
    setLoading(false);
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/income/sources", newSource);
    setNewSource({ name: "", income_type: "salary" });
    setShowSourceForm(false);
    await load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este ingreso?")) return;
    await api.delete(`/income/entries/${id}`);
    await load();
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Ingresos</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowSourceForm(true)}
            className="text-sm border px-3 py-1.5 rounded-lg hover:bg-gray-50">
            + Fuente
          </button>
          <button onClick={() => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); }}
            className="flex items-center gap-2 bg-primary text-white text-sm px-4 py-1.5 rounded-lg hover:opacity-90">
            <Plus className="w-4 h-4" /> Registrar ingreso
          </button>
        </div>
      </div>

      {showSourceForm && (
        <form onSubmit={handleAddSource} className="bg-white rounded-xl border p-5 flex gap-3">
          <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nombre de la fuente"
            value={newSource.name} onChange={e => setNewSource(p => ({ ...p, name: e.target.value }))} required />
          <select className="border rounded-lg px-3 py-2 text-sm"
            value={newSource.income_type} onChange={e => setNewSource(p => ({ ...p, income_type: e.target.value }))}>
            {Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="submit" className="bg-primary text-white px-4 py-2 rounded-lg text-sm">Guardar</button>
          <button type="button" onClick={() => setShowSourceForm(false)} className="border px-3 py-2 rounded-lg text-sm">Cancelar</button>
        </form>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
          <div className="col-span-2 text-sm font-medium text-gray-700">
            {editId ? "Editar ingreso" : "Nuevo ingreso"}
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Fuente</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.source_id} onChange={e => setForm(p => ({ ...p, source_id: e.target.value }))} required>
                <option value="">Seleccioná una fuente</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name} ({INCOME_TYPE_LABELS[s.income_type]})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Período</label>
              <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.period_date} onChange={e => setForm(p => ({ ...p, period_date: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Monto ($)</label>
            <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Notas (opcional)</label>
            <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={closeForm} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={loading} className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border divide-y">
        {entries.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">No hay ingresos registrados aún.</p>
        ) : entries.map(entry => (
          <div key={entry.id} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{entry.source.name}</p>
              <p className="text-xs text-muted-foreground">
                {entry.period_date} · {INCOME_TYPE_LABELS[entry.source.income_type]}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-green-600">{formatARS(entry.amount)}</span>
              <button onClick={() => openEdit(entry)} className="text-gray-400 hover:text-primary">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(entry.id)} className="text-gray-400 hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

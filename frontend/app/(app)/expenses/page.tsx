"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { formatARS } from "@/lib/utils";
import { Plus, Trash2, Pencil } from "lucide-react";

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }
interface ExpenseEntry {
  id: number; category_id: number; amount: number;
  description?: string; expense_date: string; notes?: string;
  category: Category;
}

const EMPTY_FORM = { category_id: "", amount: "", description: "", expense_date: "", notes: "" };

export default function ExpensesPage() {
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [catForm, setCatForm] = useState({ name: "", color: "#6366f1", is_fixed: false });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [e, c] = await Promise.all([api.get("/expenses/entries"), api.get("/expenses/categories")]);
    setEntries(e.data);
    setCategories(c.data);
  };

  useEffect(() => { load(); }, []);

  const openEdit = (entry: ExpenseEntry) => {
    setEditId(entry.id);
    setForm({
      category_id: String(entry.category_id), amount: String(entry.amount),
      description: entry.description || "", expense_date: entry.expense_date, notes: entry.notes || "",
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload = { ...form, category_id: parseInt(form.category_id), amount: parseFloat(form.amount) };
    if (editId) {
      await api.patch(`/expenses/entries/${editId}`, payload);
    } else {
      await api.post("/expenses/entries", payload);
    }
    closeForm();
    await load();
    setLoading(false);
  };

  const handleAddCat = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/expenses/categories", catForm);
    setCatForm({ name: "", color: "#6366f1", is_fixed: false });
    setShowCatForm(false);
    await load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este egreso?")) return;
    await api.delete(`/expenses/entries/${id}`);
    await load();
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Egresos</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowCatForm(true)}
            className="text-sm border px-3 py-1.5 rounded-lg hover:bg-gray-50">
            + Categoría
          </button>
          <button onClick={() => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); }}
            className="flex items-center gap-2 bg-primary text-white text-sm px-4 py-1.5 rounded-lg hover:opacity-90">
            <Plus className="w-4 h-4" /> Registrar egreso
          </button>
        </div>
      </div>

      {showCatForm && (
        <form onSubmit={handleAddCat} className="bg-white rounded-xl border p-5 flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-600">Nombre</label>
            <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Supermercado"
              value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Color</label>
            <input type="color" className="mt-1 h-9 w-12 border rounded-lg cursor-pointer"
              value={catForm.color} onChange={e => setCatForm(p => ({ ...p, color: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={catForm.is_fixed}
              onChange={e => setCatForm(p => ({ ...p, is_fixed: e.target.checked }))} />
            Fijo
          </label>
          <button type="submit" className="bg-primary text-white px-4 py-2 rounded-lg text-sm">Guardar</button>
          <button type="button" onClick={() => setShowCatForm(false)} className="border px-3 py-2 rounded-lg text-sm">Cancelar</button>
        </form>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
          <div className="col-span-2 text-sm font-medium text-gray-700">
            {editId ? "Editar egreso" : "Nuevo egreso"}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Categoría</label>
            <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))} required>
              <option value="">Seleccioná una categoría</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Fecha</label>
            <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.expense_date} onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Monto ($)</label>
            <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Descripción</label>
            <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
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
          <p className="p-6 text-muted-foreground text-sm">No hay egresos registrados aún.</p>
        ) : entries.map(entry => (
          <div key={entry.id} className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.category.color || "#6366f1" }} />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {entry.description || entry.category.name}
                </p>
                <p className="text-xs text-muted-foreground">{entry.expense_date} · {entry.category.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-red-500">{formatARS(entry.amount)}</span>
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

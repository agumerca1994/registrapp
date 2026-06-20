"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, Trash2, CheckCircle, XCircle, Clock, Users } from "lucide-react";
import api from "@/lib/api";
import { formatARS } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface Split {
  id: number;
  user_id: number | null;
  member_name: string;
  amount: number;
  status: "pending" | "accepted" | "rejected";
  expense_entry_id: number | null;
}

interface SharedExpense {
  id: number;
  title: string;
  total_amount: number;
  category_id: number;
  split_type: "equal" | "custom";
  expense_date: string;
  locked: boolean;
  created_by_user_id: number;
  created_at: string;
  splits: Split[];
}

interface Member {
  id: number;
  display_name: string | null;
  email: string;
}

interface Category {
  id: number;
  name: string;
  color: string | null;
}

interface ParticipantRow {
  type: "member" | "external";
  user_id: number | null;
  member_name: string;
  amount: string;
}

function fmtDate(d: string) {
  try { return format(new Date(d + "T12:00:00"), "d MMM yyyy", { locale: es }); }
  catch { return d; }
}

function StatusChip({ status }: { status: string }) {
  if (status === "accepted") return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      <CheckCircle className="w-3 h-3" /> Aceptado
    </span>
  );
  if (status === "rejected") return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
      <XCircle className="w-3 h-3" /> Rechazado
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
      <Clock className="w-3 h-3" /> Pendiente
    </span>
  );
}

export default function SharedExpensesPage() {
  const { appUser } = useAuth();
  const [expenses, setExpenses] = useState<SharedExpense[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: "", color: "#6366f1" });
  const [savingCat, setSavingCat] = useState(false);

  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  const [participants, setParticipants] = useState<ParticipantRow[]>([
    { type: "member", user_id: null, member_name: "", amount: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const loadCategories = async () => {
    try {
      const res = await api.get("/expenses/categories");
      setCategories(res.data);
    } catch { /* ignore */ }
  };

  const load = async () => {
    setLoading(true);
    const [se, mem] = await Promise.allSettled([
      api.get("/shared-expenses"),
      api.get("/auth/members"),
    ]);
    if (se.status === "fulfilled") setExpenses(se.value.data);
    if (mem.status === "fulfilled") setMembers(mem.value.data);
    await loadCategories();
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const total = parseFloat(totalAmount) || 0;
  const equalShare = participants.length > 0 && total > 0
    ? (total / participants.length).toFixed(2) : "0.00";

  function updateParticipant(idx: number, patch: Partial<ParticipantRow>) {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }
  function addParticipant() {
    setParticipants(prev => [...prev, { type: "member", user_id: null, member_name: "", amount: "" }]);
  }
  function removeParticipant(idx: number) {
    if (participants.length <= 1) return;
    setParticipants(prev => prev.filter((_, i) => i !== idx));
  }
  function resetForm() {
    setTitle(""); setTotalAmount(""); setCategoryId("");
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setSplitType("equal");
    setParticipants([{ type: "member", user_id: null, member_name: "", amount: "" }]);
    setFormError("");
  }

  async function handleAddCat(e: React.FormEvent) {
    e.preventDefault();
    setSavingCat(true);
    try {
      await api.post("/expenses/categories", { ...catForm, is_fixed: false });
      setCatForm({ name: "", color: "#6366f1" });
      setShowCatForm(false);
      await loadCategories();
    } finally { setSavingCat(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const splits = participants.map(p => ({
      user_id: p.type === "member" ? p.user_id : null,
      member_name: p.member_name,
      amount: parseFloat(splitType === "equal" ? equalShare : p.amount) || 0,
    }));
    const sumAmounts = splits.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sumAmounts - total) > 0.02) {
      setFormError(`La suma de los montos (${formatARS(sumAmounts)}) no coincide con el total (${formatARS(total)})`);
      return;
    }
    if (splits.some(s => !s.member_name.trim())) {
      setFormError("Todos los participantes deben tener nombre"); return;
    }
    setSaving(true);
    try {
      await api.post("/shared-expenses", {
        title, total_amount: total, category_id: parseInt(categoryId),
        split_type: splitType, expense_date: expenseDate, splits,
      });
      resetForm(); setShowForm(false); await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(msg || "Error al crear el gasto compartido");
    } finally { setSaving(false); }
  }

  async function handleAccept(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/accept`); await load();
  }
  async function handleReject(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/reject`); await load();
  }
  async function handleDelete(sharedId: number) {
    if (!confirm("Eliminar este gasto compartido? Se borraran todos los egresos parciales asociados.")) return;
    await api.delete(`/shared-expenses/${sharedId}`); await load();
  }

  const currentUserId = appUser?.id;

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-2xl font-bold text-gray-900">Gastos compartidos</h1>
        <button
          onClick={() => { setShowForm(v => !v); resetForm(); }}
          className="flex items-center gap-2 bg-primary text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" /> Nuevo gasto
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 md:p-5 space-y-4">
          <p className="text-sm font-medium text-gray-700">Nuevo gasto compartido</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">{"Descripcion *"}</label>
              <input required value={title} onChange={e => setTitle(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="ej: Supermercado del fin de semana" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">{"Monto ($) *"}</label>
              <input required type="number" step="0.01" min="0"
                value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="0.00" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">{"Fecha *"}</label>
              <input required type="date" value={expenseDate}
                onChange={e => setExpenseDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">{"Categoria *"}</label>
                <button type="button" onClick={() => setShowCatForm(v => !v)}
                  className="text-xs text-primary hover:underline">
                  + Crear
                </button>
              </div>
              {showCatForm && (
                <form onSubmit={handleAddCat} className="mb-1 border rounded-lg p-2 bg-gray-50 space-y-2">
                  <div className="flex gap-2">
                    <input required value={catForm.name}
                      onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Nombre categoria" className="flex-1 border rounded-lg px-2 py-1.5 text-sm" />
                    <input type="color" value={catForm.color}
                      onChange={e => setCatForm(p => ({ ...p, color: e.target.value }))}
                      className="h-8 w-10 border rounded-lg cursor-pointer" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowCatForm(false)}
                      className="text-xs border px-2 py-1 rounded-lg hover:bg-white">Cancelar</button>
                    <button type="submit" disabled={savingCat}
                      className="text-xs bg-primary text-white px-2 py-1 rounded-lg disabled:opacity-60">
                      Guardar
                    </button>
                  </div>
                </form>
              )}
              <select required value={categoryId} onChange={e => setCategoryId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">{"Seleccionar..."}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!showCatForm && categories.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No hay categorias. Usa <strong>+ Crear</strong> para agregar una.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">{"Division *"}</label>
              <select value={splitType} onChange={e => setSplitType(e.target.value as "equal" | "custom")}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="equal">Equitativa</option>
                <option value="custom">Personalizada</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">{"Participantes *"}</label>
              <button type="button" onClick={addParticipant}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Agregar
              </button>
            </div>

            <div className="space-y-2">
              {participants.map((p, idx) => (
                <div key={idx} className="border rounded-lg p-2.5 bg-gray-50 space-y-2">
                  <div className="flex items-center gap-2">
                    <select value={p.type}
                      onChange={e => {
                        const t = e.target.value as "member" | "external";
                        updateParticipant(idx, { type: t, user_id: null, member_name: "" });
                      }}
                      className="border rounded-lg px-2 py-1.5 text-xs bg-white shrink-0">
                      <option value="member">Del hogar</option>
                      <option value="external">Externo</option>
                    </select>
                    <button type="button" onClick={() => removeParticipant(idx)}
                      className="ml-auto text-gray-400 hover:text-red-500 px-1 text-base leading-none">
                      x
                    </button>
                  </div>

                  {p.type === "member" ? (
                    <select required value={p.user_id ?? ""}
                      onChange={e => {
                        const id = parseInt(e.target.value);
                        const mem = members.find(m => m.id === id);
                        updateParticipant(idx, { user_id: id, member_name: mem?.display_name || mem?.email || "" });
                      }}
                      className="w-full border rounded-lg px-2 py-2 text-sm bg-white">
                      <option value="">Seleccionar miembro...</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>{m.display_name || m.email}</option>
                      ))}
                    </select>
                  ) : (
                    <input required type="text" placeholder="Nombre del externo"
                      value={p.member_name} onChange={e => updateParticipant(idx, { member_name: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm" />
                  )}

                  {splitType === "custom" ? (
                    <div>
                      <label className="text-xs text-gray-500">Monto ($)</label>
                      <input required type="number" step="0.01" min="0" placeholder="0.00"
                        value={p.amount} onChange={e => updateParticipant(idx, { amount: e.target.value })}
                        className="mt-0.5 w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs text-gray-500">Monto</span>
                      <span className="text-sm font-medium text-gray-700">
                        {total > 0 ? formatARS(parseFloat(equalShare)) : "-"}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {splitType === "equal" && total > 0 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {formatARS(total)} / {participants.length} = {formatARS(parseFloat(equalShare))} por persona
              </p>
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-60">
              {saving ? "Generando..." : "Generar gasto"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="bg-white rounded-xl border p-4 h-28 animate-pulse" />)}
        </div>
      ) : expenses.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-muted-foreground text-sm">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No hay gastos compartidos registrados.
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map(exp => {
            const myMemberSplit = exp.splits.find(s => s.user_id === currentUserId);
            const pendingCount = exp.splits.filter(s => s.user_id !== null && s.status === "pending").length;
            const isCreator = exp.created_by_user_id === currentUserId;
            return (
              <div key={exp.id} className="bg-white rounded-xl border p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{exp.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtDate(exp.expense_date)} &middot; {exp.splits.length} participantes
                      {exp.locked && (
                        <span className="ml-2 text-orange-500 font-medium">&middot; bloqueado</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="text-lg font-bold text-gray-900">{formatARS(exp.total_amount)}</p>
                    {isCreator && (
                      <button onClick={() => handleDelete(exp.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  {exp.splits.map(split => (
                    <div key={split.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-gray-700 truncate">{split.member_name}</span>
                        {split.user_id === null && (
                          <span className="text-xs text-gray-400 shrink-0">(ext)</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-gray-600">{formatARS(split.amount)}</span>
                        <StatusChip status={split.user_id === null ? "accepted" : split.status} />
                      </div>
                    </div>
                  ))}
                </div>

                {myMemberSplit?.status === "pending" && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <p className="text-sm text-gray-600 flex-1">
                      Te corresponden <strong>{formatARS(myMemberSplit.amount)}</strong>
                    </p>
                    <button onClick={() => handleAccept(exp.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                      <CheckCircle className="w-3.5 h-3.5" /> Aceptar
                    </button>
                    <button onClick={() => handleReject(exp.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border text-gray-600 rounded-lg hover:bg-gray-50">
                      <XCircle className="w-3.5 h-3.5" /> Rechazar
                    </button>
                  </div>
                )}
                {pendingCount > 0 && isCreator && (
                  <p className="text-xs text-muted-foreground pt-1 border-t">
                    {pendingCount} participante{pendingCount > 1 ? "s" : ""} aun no acepto
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, Trash2, CheckCircle, XCircle, Clock, Users, Copy, Link, MessageCircle, Smartphone, Layers } from "lucide-react";

import api from "@/lib/api";
import { formatARS, normalizePhoneNumber, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { COUNTRIES } from "@/lib/countries";

function buildPhone(prefix: string, local: string): string {
  const digits = local.replace(/\D/g, "");
  return prefix === "54" ? prefix + "9" + digits : prefix + digits;
}

// Pick a contact from device and normalize phone to prefix + local format
async function pickContactAndNormalize(availablePrefixes: string[]): Promise<{ name: string; phone: string; prefix: string; local: string } | null> {
  if (!("contacts" in navigator) || !navigator.contacts) return null;

  try {
    const contacts = navigator as unknown as { contacts: { select: (f: string[], o: object) => Promise<{ name?: string[]; tel?: string[] }[]> } };
    const [contact] = await contacts.contacts.select(["name", "tel"], { multiple: false });
    if (!contact) return null;

    const name = contact.name?.[0] ?? "";
    const rawPhone = contact.tel?.[0] ?? "";
    if (!name || !rawPhone) return null;

    const { prefix, local, isValid } = normalizePhoneNumber(rawPhone, availablePrefixes);
    if (!isValid) {
      alert(`Número no válido: ${rawPhone}. Por favor, completa manualmente.`);
      return null;
    }

    return { name, phone: buildPhone(prefix, local), prefix, local };
  } catch (err) {
    console.error("Contact picker error:", err);
    return null;
  }
}

interface Split {
  id: number;
  user_id: number | null;
  member_name: string;
  amount: number;
  status: "pending" | "accepted" | "rejected";
  expense_entry_id: number | null;
  invite_email: string | null;
  invite_token: string | null;
}

interface SharedExpense {
  id: number;
  tenant_id: number;
  title: string;
  total_amount: number;
  category_id: number;
  split_type: "equal" | "custom";
  expense_date: string;
  locked: boolean;
  created_by_user_id: number;
  created_at: string;
  installment_group_id: number | null;
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

interface AgendaContact {
  id: number;
  contact_name: string;
  contact_phone: string;
}

interface ParticipantRow {
  type: "member" | "external";
  user_id: number | null;
  member_name: string;
  amount: string;
  manual: boolean;
  invite_method: "none" | "email" | "whatsapp";
  invite_email: string;
  invite_phone_prefix: string;
  invite_phone_local: string;
}

function parseAmt(s: string): number {
  return parseFloat(s.replace(",", ".")) || 0;
}

function fmtDate(d: string) {
  try { return format(new Date(d + "T12:00:00"), "d MMM yyyy", { locale: es }); }
  catch { return d; }
}

function redistAuto(parts: ParticipantRow[], total: number): ParticipantRow[] {
  const manualSum = parts.filter(p => p.manual).reduce((s, p) => s + parseAmt(p.amount), 0);
  const remaining = Math.max(0, total - manualSum);
  const autoCount = parts.filter(p => !p.manual).length;
  if (autoCount === 0) return parts;
  const perAuto = (remaining / autoCount).toFixed(2);
  return parts.map(p => p.manual ? p : { ...p, amount: perAuto });
}

function StatusChip({ status, hasToken }: { status: string; hasToken?: boolean }) {
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
  if (hasToken) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
      <Link className="w-3 h-3" /> Invitado
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
  const [agendaContacts, setAgendaContacts] = useState<AgendaContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState("#6366f1");
  const [savingCat, setSavingCat] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  const [participants, setParticipants] = useState<ParticipantRow[]>([
    { type: "member", user_id: null, member_name: "", amount: "", manual: false, invite_method: "none", invite_email: "", invite_phone_prefix: "54", invite_phone_local: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const total = parseAmt(totalAmount);

  const loadCategories = async () => {
    try {
      const res = await api.get("/expenses/categories");
      setCategories(res.data);
    } catch { /* ignorar */ }
  };

  const load = async () => {
    setLoading(true);
    const [se, mem, contacts] = await Promise.allSettled([
      api.get("/shared-expenses"),
      api.get("/auth/members"),
      api.get("/contacts"),
    ]);
    if (se.status === "fulfilled") setExpenses(se.value.data);
    if (mem.status === "fulfilled") setMembers(mem.value.data);
    if (contacts.status === "fulfilled") setAgendaContacts(contacts.value.data);
    await loadCategories();
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Pre-cargar el primer participante con el usuario actual (appUser siempre disponible)
  useEffect(() => {
    if (!appUser) return;
    setParticipants(prev => {
      if (prev[0].user_id !== null) return prev;
      const updated: ParticipantRow[] = [
        { ...prev[0], user_id: appUser.id, member_name: appUser.display_name || appUser.email },
        ...prev.slice(1),
      ];
      return splitType === "custom" ? redistAuto(updated, total) : updated;
    });
  }, [appUser]);

  // Redistribuir automaticos cuando cambia el monto total
  useEffect(() => {
    if (splitType === "custom" && total > 0) {
      setParticipants(prev => redistAuto(prev, total));
    }
  }, [totalAmount, splitType]);

  // --- Valores derivados ---
  const equalShare = participants.length > 0 && total > 0
    ? (total / participants.length).toFixed(2) : "0.00";

  const manualSum = splitType === "custom"
    ? participants.filter(p => p.manual).reduce((s, p) => s + parseAmt(p.amount), 0)
    : 0;
  const assignedSum = splitType === "custom"
    ? participants.reduce((s, p) => s + parseAmt(p.amount), 0)
    : 0;
  const overBudget = splitType === "custom" && total > 0 && manualSum > total + 0.01;

  // --- Helpers de participantes ---
  function updateParticipant(idx: number, patch: Partial<ParticipantRow>) {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function setManualAmount(idx: number, value: string) {
    setParticipants(prev => {
      const updated = prev.map((p, i) =>
        i === idx ? { ...p, amount: value, manual: true } : p
      );
      return redistAuto(updated, total);
    });
  }

  function addParticipant() {
    setParticipants(prev => {
      const newRow: ParticipantRow = {
        type: "member", user_id: null, member_name: "", amount: "", manual: false, invite_method: "none", invite_email: "", invite_phone_prefix: "54", invite_phone_local: "",
      };
      const updated = [...prev, newRow];
      return splitType === "custom" ? redistAuto(updated, total) : updated;
    });
  }

  function removeParticipant(idx: number) {
    if (idx === 0 || participants.length <= 1) return;
    setParticipants(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      return splitType === "custom" ? redistAuto(updated, total) : updated;
    });
  }

  function handleSplitTypeChange(newType: "equal" | "custom") {
    setSplitType(newType);
    if (newType === "custom") {
      setParticipants(prev => redistAuto(prev.map(p => ({ ...p, manual: false })), total));
    } else {
      setParticipants(prev => prev.map(p => ({ ...p, amount: "", manual: false })));
    }
  }

  function resetForm() {
    setTitle(""); setTotalAmount(""); setCategoryId("");
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setSplitType("equal");
    setParticipants([{
      type: "member",
      user_id: appUser?.id ?? null,
      member_name: appUser?.display_name || appUser?.email || "",
      amount: "",
      manual: false,
      invite_method: "none",
      invite_email: "",
      invite_phone_prefix: "54",
      invite_phone_local: "",
    }]);
    setFormError("");
  }

  async function saveCat() {
    if (!catName.trim()) return;
    setSavingCat(true);
    try {
      await api.post("/expenses/categories", { name: catName, color: catColor, is_fixed: false });
      setCatName(""); setCatColor("#6366f1");
      setShowCatForm(false);
      await loadCategories();
    } finally { setSavingCat(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (overBudget) {
      setFormError("La division supera el monto total"); return;
    }
    const splits = participants.map(p => ({
      user_id: p.type === "member" ? p.user_id : null,
      member_name: p.member_name,
      amount: splitType === "equal" ? parseFloat(equalShare) : parseAmt(p.amount),
      invite_contact: p.type === "external"
        ? (p.invite_method === "email" && p.invite_email.trim() ? p.invite_email.trim()
          : p.invite_method === "whatsapp" && p.invite_phone_local.trim() ? buildPhone(p.invite_phone_prefix, p.invite_phone_local)
          : undefined)
        : undefined,
    }));
    const sumAmts = splits.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sumAmts - total) > 0.02) {
      setFormError(`La suma (${formatARS(sumAmts)}) no coincide con el total (${formatARS(total)})`);
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
      setFormError(getErrorMessage(err, "Error al crear el gasto compartido"));
    } finally { setSaving(false); }
  }

  async function handleAccept(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/accept`); await load();
  }
  async function handleReject(sharedId: number) {
    await api.post(`/shared-expenses/${sharedId}/reject`); await load();
  }
  async function handleDelete(sharedId: number, isGrouped: boolean) {
    const msg = isGrouped
      ? "Se eliminará esta cuota y todas las cuotas futuras del plan. Las cuotas ya pasadas no se van a tocar. ¿Continuar?"
      : "Eliminar este gasto compartido? Se borraran todos los egresos parciales asociados.";
    if (!confirm(msg)) return;
    try {
      await api.delete(`/shared-expenses/${sharedId}`);
      await load();
    } catch (err) {
      alert(getErrorMessage(err, "No se pudo eliminar"));
    }
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  }

  const currentUserId = appUser?.id;

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
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
              <label className="text-xs font-medium text-gray-600">Descripción *</label>
              <input required value={title} onChange={e => setTitle(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="ej: Supermercado del fin de semana" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Monto ($) *</label>
              <input
                required
                type="text"
                inputMode="decimal"
                value={totalAmount}
                onChange={e => setTotalAmount(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Fecha *</label>
              <input required type="date" value={expenseDate}
                onChange={e => setExpenseDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">Categoría *</label>
                <button type="button" onClick={() => setShowCatForm(v => !v)}
                  className="text-xs text-primary hover:underline">
                  + Crear
                </button>
              </div>
              {showCatForm && (
                <div className="mb-1 border rounded-lg p-2 bg-gray-50 space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={catName}
                      onChange={e => setCatName(e.target.value)}
                      placeholder="Nombre categoría"
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                    />
                    <input type="color" value={catColor}
                      onChange={e => setCatColor(e.target.value)}
                      className="h-8 w-10 border rounded-lg cursor-pointer" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowCatForm(false)}
                      className="text-xs border px-2 py-1 rounded-lg hover:bg-white">Cancelar</button>
                    <button type="button" disabled={savingCat || !catName.trim()} onClick={saveCat}
                      className="text-xs bg-primary text-white px-2 py-1 rounded-lg disabled:opacity-60">
                      Guardar
                    </button>
                  </div>
                </div>
              )}
              <select required value={categoryId} onChange={e => setCategoryId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Seleccionar...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!showCatForm && categories.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No hay categorías. Usa <strong>+ Crear</strong> para agregar una.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Division *</label>
              <select value={splitType} onChange={e => handleSplitTypeChange(e.target.value as "equal" | "custom")}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="equal">Equitativa</option>
                <option value="custom">Personalizada</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Participantes *</label>
              <button type="button" onClick={addParticipant}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Agregar
              </button>
            </div>

            <div className="space-y-2">
              {participants.map((p, idx) => {
                const isCreator = idx === 0;
                return (
                  <div key={idx} className="border rounded-lg p-2.5 bg-gray-50 space-y-2">
                    <div className="flex items-center gap-2">
                      {isCreator ? (
                        <span className="border rounded-lg px-2 py-1.5 text-xs bg-white text-gray-600 shrink-0">
                          Del hogar
                        </span>
                      ) : (
                        <select value={p.type}
                          onChange={e => {
                            const t = e.target.value as "member" | "external";
                            updateParticipant(idx, { type: t, user_id: null, member_name: "" });
                          }}
                          className="border rounded-lg px-2 py-1.5 text-xs bg-white shrink-0">
                          <option value="member">Del hogar</option>
                          <option value="external">Externo</option>
                        </select>
                      )}
                      {!isCreator && (
                        <button type="button" onClick={() => removeParticipant(idx)}
                          className="ml-auto text-gray-400 hover:text-red-500 px-1 text-base leading-none">
                          x
                        </button>
                      )}
                    </div>

                    {isCreator ? (
                      <p className="text-sm text-gray-700 px-1">
                        {p.member_name}
                      </p>
                    ) : p.type === "member" ? (
                      <select required value={p.user_id ?? ""}
                        onChange={e => {
                          const id = parseInt(e.target.value);
                          const mem = members.find(m => m.id === id);
                          updateParticipant(idx, { user_id: id, member_name: mem?.display_name || mem?.email || "" });
                        }}
                        className="w-full border rounded-lg px-2 py-2 text-sm bg-white">
                        <option value="">Seleccionar miembro...</option>
                        {members.filter(m => m.id !== appUser?.id).map(m => (
                          <option key={m.id} value={m.id}>{m.display_name || m.email}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="space-y-2">
                        {agendaContacts.length > 0 && (
                          <select
                            value=""
                            onChange={e => {
                              const c = agendaContacts.find(a => a.id === parseInt(e.target.value));
                              if (!c) return;
                              const { prefix, local, isValid } = normalizePhoneNumber(c.contact_phone, COUNTRIES.map(cc => cc.prefix));
                              if (!isValid) return;
                              updateParticipant(idx, {
                                member_name: c.contact_name,
                                invite_phone_prefix: prefix,
                                invite_phone_local: local,
                                invite_method: "whatsapp",
                              });
                            }}
                            className="w-full border rounded-lg px-2 py-1.5 text-xs bg-violet-50 border-violet-200 text-violet-700"
                          >
                            <option value="">📇 Elegir de la agenda...</option>
                            {agendaContacts.map(c => (
                              <option key={c.id} value={c.id}>{c.contact_name} · {c.contact_phone}</option>
                            ))}
                          </select>
                        )}
                        <div className="flex gap-2">
                          <input required type="text" placeholder="Nombre del externo"
                            value={p.member_name} onChange={e => updateParticipant(idx, { member_name: e.target.value })}
                            className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                          <button type="button"
                            onClick={async () => {
                              const result = await pickContactAndNormalize(COUNTRIES.map(c => c.prefix));
                              if (result) {
                                updateParticipant(idx, {
                                  member_name: result.name,
                                  invite_phone_prefix: result.prefix,
                                  invite_phone_local: result.local,
                                  invite_method: "whatsapp",
                                });
                              } else if (!("contacts" in navigator) || !navigator.contacts) {
                                alert("Tu navegador no permite elegir contactos del dispositivo. Completá el nombre y teléfono manualmente, o elegí uno de la agenda si ya lo compartiste antes.");
                              }
                            }}
                            title="Seleccionar contacto del dispositivo"
                            className="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-1 shrink-0"
                          >
                            <Smartphone className="w-4 h-4" />
                          </button>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1.5">Enviar invitacion</p>
                          <div className="flex gap-1.5 flex-wrap">
                            <button type="button"
                              onClick={() => updateParticipant(idx, { invite_method: "none" })}
                              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${p.invite_method === "none" ? "bg-gray-100 border-gray-300 text-gray-700 font-medium" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                              Sin invitacion
                            </button>
                            <button type="button"
                              onClick={() => updateParticipant(idx, { invite_method: "email" })}
                              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${p.invite_method === "email" ? "bg-violet-100 border-violet-400 text-violet-700 font-medium" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                              Email
                            </button>
                            <button type="button"
                              onClick={() => updateParticipant(idx, { invite_method: "whatsapp" })}
                              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors flex items-center gap-1 ${p.invite_method === "whatsapp" ? "bg-green-100 border-green-500 text-green-700 font-medium" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                              <MessageCircle className="w-3 h-3" /> WhatsApp
                            </button>
                          </div>
                        </div>

                        {p.invite_method === "email" && (
                          <div className="space-y-1">
                            <input type="email" placeholder="email@ejemplo.com"
                              value={p.invite_email}
                              onChange={e => updateParticipant(idx, { invite_email: e.target.value })}
                              className="w-full border rounded-lg px-3 py-2 text-sm" />
                            <p className="text-xs text-violet-600">Se generara un link para copiar y compartir manualmente</p>
                          </div>
                        )}

                        {p.invite_method === "whatsapp" && (
                          <div className="space-y-1">
                            <div className="flex gap-2">
                              <select
                                value={p.invite_phone_prefix}
                                onChange={e => updateParticipant(idx, { invite_phone_prefix: e.target.value, invite_phone_local: "" })}
                                className="border rounded-lg px-2 py-2 text-sm bg-white shrink-0">
                                {COUNTRIES.map(c => (
                                  <option key={c.prefix} value={c.prefix}>{c.flag} +{c.prefix}</option>
                                ))}
                              </select>
                              <input type="tel"
                                value={p.invite_phone_local}
                                onChange={e => updateParticipant(idx, { invite_phone_local: e.target.value.replace(/[^\d\s]/g, "") })}
                                placeholder={COUNTRIES.find(c => c.prefix === p.invite_phone_prefix)?.placeholder ?? ""}
                                inputMode="numeric"
                                className="flex-1 border rounded-lg px-3 py-2 text-sm min-w-0" />
                            </div>
                            {p.invite_phone_local.trim() && (
                              <p className="text-xs text-gray-400">
                                Número a enviar: +{buildPhone(p.invite_phone_prefix, p.invite_phone_local)}
                              </p>
                            )}
                            <p className="text-xs text-green-700">Se enviara una invitacion automaticamente por WhatsApp al crear el gasto</p>
                          </div>
                        )}
                      </div>
                    )}

                    {splitType === "custom" ? (
                      <div>
                        <label className="text-xs text-gray-500">Monto ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={p.amount}
                          onChange={e => setManualAmount(idx, e.target.value)}
                          className={`mt-0.5 w-full border rounded-lg px-3 py-2 text-sm ${!p.manual ? "text-gray-400 italic" : ""}`}
                        />
                        {!p.manual && parseAmt(p.amount) > 0 && (
                          <p className="text-xs text-blue-500 mt-0.5">sugerencia</p>
                        )}
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
                );
              })}
            </div>

            {splitType === "equal" && total > 0 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {formatARS(total)} / {participants.length} = {formatARS(parseFloat(equalShare))} por persona
              </p>
            )}

            {splitType === "custom" && total > 0 && (
              <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${overBudget ? "bg-red-50 text-red-600 font-medium" : "bg-blue-50 text-blue-700"}`}>
                {overBudget
                  ? `La division supera el total: asignaste ${formatARS(manualSum)} de ${formatARS(total)}`
                  : `Distribuido: ${formatARS(assignedSum)} | Restante: ${formatARS(total - assignedSum)}`
                }
              </div>
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving || overBudget}
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
          {(() => {
            const groupsMap = new Map<number, SharedExpense[]>();
            for (const exp of expenses) {
              const rootId = exp.installment_group_id ?? exp.id;
              if (!groupsMap.has(rootId)) groupsMap.set(rootId, []);
              groupsMap.get(rootId)!.push(exp);
            }
            const displayGroups = Array.from(groupsMap.entries())
              .map(([rootId, members]) => ({
                root: members.find(m => m.id === rootId) ?? members[0],
                cuotas: [...members].sort((a, b) => a.expense_date.localeCompare(b.expense_date)),
              }))
              .sort((a, b) => b.root.created_at.localeCompare(a.root.created_at));

            return displayGroups.map(({ root: exp, cuotas }) => {
              const isGrouped = cuotas.length > 1;
              const groupTotal = cuotas.reduce((s, c) => s + Number(c.total_amount), 0);
              const myMemberSplit = exp.splits.find(s => s.user_id === currentUserId);
              const pendingCount = exp.splits.filter(s => s.user_id !== null && s.status === "pending" && !s.invite_token).length;
              const isCreator = exp.created_by_user_id === currentUserId;
              const isCrossTenant = exp.tenant_id !== appUser?.tenant_id;
              return (
                <div key={exp.id} className="bg-white rounded-xl border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                        {exp.title}
                        {isGrouped && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium shrink-0">
                            <Layers className="w-3 h-3" /> {cuotas.length} cuotas
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isGrouped
                          ? `${fmtDate(cuotas[0].expense_date)} — ${fmtDate(cuotas[cuotas.length - 1].expense_date)}`
                          : fmtDate(exp.expense_date)}
                        {" "}&middot; {exp.splits.length} participantes
                        {exp.locked && (
                          <span className="ml-2 text-orange-500 font-medium">&middot; bloqueado</span>
                        )}
                        {isCrossTenant && (
                          <span className="ml-2 text-violet-500 font-medium">&middot; otro hogar</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-lg font-bold text-gray-900">{formatARS(groupTotal)}</p>
                      {isCreator && (
                        <button onClick={() => handleDelete(exp.id, isGrouped)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isGrouped && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-violet-600 hover:text-violet-700 select-none">
                        Ver detalle de las {cuotas.length} cuotas
                      </summary>
                      <div className="mt-1.5 space-y-1 border-l-2 border-violet-100 pl-2.5">
                        {cuotas.map((c, i) => (
                          <div key={c.id} className="flex items-center justify-between text-gray-500">
                            <span>Cuota {i + 1}/{cuotas.length} &middot; {fmtDate(c.expense_date)}</span>
                            <span className="font-medium text-gray-600">{formatARS(c.total_amount)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div className="space-y-1.5">
                    {exp.splits.map(split => (
                      <div key={split.id} className="flex items-center justify-between gap-x-2 gap-y-1 text-sm flex-wrap">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-gray-700 truncate">{split.member_name}</span>
                          {split.invite_email && (
                            <span className="text-xs text-gray-400 shrink-0 truncate max-w-[100px]">({split.invite_email})</span>
                          )}
                          {split.user_id === null && !split.invite_token && !split.invite_email && (
                            <span className="text-xs text-gray-400 shrink-0">(ext)</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          <span className="text-gray-600">
                            {formatARS(split.amount)}{isGrouped && <span className="text-gray-400"> /cuota</span>}
                          </span>
                          <StatusChip
                            status={split.user_id === null && !split.invite_token ? "accepted" : split.status}
                            hasToken={!!split.invite_token}
                          />
                          {split.invite_token && isCreator && (
                            <button
                              onClick={() => copyInviteLink(split.invite_token!)}
                              title="Copiar link de invitacion"
                              className={`p-1 rounded transition-colors ${copiedToken === split.invite_token ? "text-green-600" : "text-gray-400 hover:text-violet-600"}`}
                            >
                              {copiedToken === split.invite_token
                                ? <CheckCircle className="w-4 h-4" />
                                : <Copy className="w-4 h-4" />
                              }
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {myMemberSplit?.status === "pending" && !myMemberSplit?.invite_token && (
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <p className="text-sm text-gray-600 flex-1">
                        Te corresponden <strong>{formatARS(myMemberSplit.amount)}</strong>{isGrouped && ` por cuota (${cuotas.length} cuotas)`}
                      </p>
                      <button onClick={() => handleAccept(exp.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                        <CheckCircle className="w-3.5 h-3.5" /> {isGrouped ? "Aceptar todas" : "Aceptar"}
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
            });
          })()}
        </div>
      )}
    </div>
  );
}

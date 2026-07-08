"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { formatARS, formatDate, formatUSD, parseAmount, normalizePhoneNumber } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2, ChevronLeft, Pencil, X, CheckCircle, ExternalLink, Users2, Phone } from "lucide-react";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface Category { id: number; name: string; color?: string; is_fixed: boolean; }
interface CardItem {
  id: number; description: string; category_id: number; item_date: string; item_type: string;
  amount: number; installment_count?: number; installment_number?: number;
  purchase_total?: number; installment_group_id?: number; installment_root_statement_id?: number; shared_expense_id?: number; expense_entry_id?: number; currency?: string;
  category: { id: number; name: string; color?: string };
}
interface Statement {
  id: number; card_id: number; year: number; month: number; status: string;
  total: number; items: CardItem[];
}
interface Member {
  id: number; display_name: string | null; email: string;
}
interface AgendaContact {
  id: number; contact_name: string; contact_phone: string;
}
interface Card {
  id: number; bank: string; alias: string; closing_day: number; due_day: number;
}

type ItemType = "single" | "installment" | "recurring";
type AmountMode = "per_installment" | "total";

const EMPTY_ITEM = {
  description: "", category_id: "", item_date: "", item_type: "single" as ItemType,
  amount: "", installment_count: "2", purchase_total: "", amount_mode: "per_installment" as AmountMode,
  currency: "ARS" as "ARS" | "USD",
};

function itemTypeBadge(item: CardItem) {
  if (item.item_type === "single") return null;
  if (item.item_type === "recurring") return (
    <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Recurrente</span>
  );
  if (item.item_type === "installment") {
    const isChild = !!item.installment_group_id;
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${isChild ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>
        Cuota {item.installment_number}/{item.installment_count}
      </span>
    );
  }
  return null;
}


interface ShareParticipantRow {
  type: "self" | "member" | "external";
  user_id: number | null;
  member_name: string;
  contact: string;
  amount: string;
}

function ShareItemModal({ item, onClose, onDone, currentUser }: { item: CardItem; onClose: () => void; onDone: () => void; currentUser: { id: number; display_name: string | null; email: string } | null }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [agendaContacts, setAgendaContacts] = useState<AgendaContact[]>([]);
  const [participants, setParticipants] = useState<ShareParticipantRow[]>([]);
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");

  const totalAmount = Number(item.amount);

  useEffect(() => {
    api.get("/auth/members").then(r => setMembers(r.data as Member[]));
    api.get("/contacts").then(r => setAgendaContacts(r.data as AgendaContact[]));
  }, []);

  useEffect(() => {
    if (!currentUser || participants.length > 0) return;
    setParticipants([{
      type: "self",
      user_id: currentUser.id,
      member_name: currentUser.display_name || currentUser.email,
      contact: "",
      amount: "",
    }]);
  }, [currentUser]);

  const cuotasRestantes = item.item_type === "installment" && !item.installment_group_id
    ? (item.installment_count || 1) - (item.installment_number || 1) + 1
    : 0;

  const otherMembers = members.filter(m => m.id !== currentUser?.id);
  const equalShare = participants.length > 0 ? totalAmount / participants.length : 0;
  const customTotal = participants.reduce((s, p) => s + parseAmount(p.amount || "0"), 0);
  const overBudget = splitType === "custom" && customTotal > totalAmount + 0.01;

  function updateParticipant(idx: number, patch: Partial<ShareParticipantRow>) {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function addParticipant() {
    setParticipants(prev => [...prev, { type: "member", user_id: null, member_name: "", contact: "", amount: "" }]);
  }

  function removeParticipant(idx: number) {
    setParticipants(prev => prev.filter((_, i) => i !== idx));
  }

  const hasContactsApi = typeof navigator !== "undefined" && "contacts" in navigator;

  async function pickContact(idx: number) {
    if (!hasContactsApi) {
      alert("Tu navegador no permite elegir contactos del dispositivo. Completa el nombre y telefono manualmente, o elegi uno de la agenda si ya lo compartiste antes.");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contacts = await (navigator as any).contacts.select(["name", "tel"], { multiple: false });
      if (!contacts.length) return;
      const c = contacts[0];
      const name: string = c.name?.[0] || "";
      const raw: string = c.tel?.[0] || "";
      if (!raw) return;
      const norm = normalizePhoneNumber(raw);
      const phone = norm.prefix === "54" ? "549" + norm.local : norm.prefix + norm.local;
      updateParticipant(idx, { member_name: name || participants[idx].member_name, contact: phone });
    } catch { /* user cancelled */ }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (participants.length < 2) { setError("Agrega al menos 1 persona mas"); return; }
    if (participants.some(p => p.type !== "self" && !p.member_name.trim())) {
      setError("Todos los participantes deben tener nombre"); return;
    }
    setSharing(true);
    setError("");
    try {
      const splits = participants.map((p, i) => {
        const amount = splitType === "equal"
          ? (i === participants.length - 1
            ? parseFloat((totalAmount - parseFloat(equalShare.toFixed(2)) * (participants.length - 1)).toFixed(2))
            : parseFloat(equalShare.toFixed(2)))
          : parseAmount(p.amount || "0");
        return {
          user_id: p.type === "external" ? null : p.user_id,
          member_name: p.member_name,
          amount,
          ...(p.type === "external" && p.contact.trim() ? { invite_contact: p.contact.trim() } : {}),
        };
      });
      if (splitType === "custom") {
        const sum = splits.reduce((s, sp) => s + sp.amount, 0);
        if (Math.abs(sum - totalAmount) > 0.02) {
          setError("La suma no coincide con el total");
          setSharing(false); return;
        }
      }
      await api.post("/credit-cards/items/" + item.id + "/share", { splits, split_type: splitType });
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Error al compartir");
    }
    setSharing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Compartir gasto</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm space-y-0.5">
          <p className="font-medium text-gray-800">{item.description}</p>
          <p className="text-gray-500">{item.currency === "USD" ? formatUSD(item.amount) : formatARS(item.amount)} por cuota</p>
          {cuotasRestantes > 1 && (
            <p className="text-xs text-amber-600 mt-1">Se compartiran las {cuotasRestantes} cuotas del plan</p>
          )}
          {item.item_type === "recurring" && (
            <p className="text-xs text-blue-600 mt-1">Solo se comparte el mes actual</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            {(["equal", "custom"] as const).map(t => (
              <button key={t} type="button" onClick={() => setSplitType(t)}
                className={"flex-1 py-1.5 text-xs rounded-lg border transition-colors " + (splitType === t ? "bg-primary text-white border-primary" : "text-gray-600 hover:bg-gray-50")}>
                {t === "equal" ? "Division igual" : "Personalizado"}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-600">Participantes</p>
              <button type="button" onClick={addParticipant}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Agregar
              </button>
            </div>

            <div className="space-y-2">
              {participants.map((p, idx) => (
                <div key={idx} className="border rounded-lg p-2.5 bg-gray-50 space-y-2">
                  <div className="flex items-center gap-2">
                    {p.type === "self" ? (
                      <span className="border rounded-lg px-2 py-1.5 text-xs bg-white text-gray-600 shrink-0">Vos</span>
                    ) : (
                      <select
                        value={p.type}
                        onChange={e => {
                          const t = e.target.value as "member" | "external";
                          updateParticipant(idx, { type: t, user_id: null, member_name: "", contact: "" });
                        }}
                        className="border rounded-lg px-2 py-1.5 text-xs bg-white shrink-0"
                      >
                        <option value="member">Del hogar</option>
                        <option value="external">Externo</option>
                      </select>
                    )}
                    {p.type !== "self" && (
                      <button type="button" onClick={() => removeParticipant(idx)}
                        className="ml-auto text-gray-400 hover:text-red-500 px-1 text-base leading-none">x</button>
                    )}
                  </div>

                  {p.type === "self" ? (
                    <p className="text-sm text-gray-700 px-1">{p.member_name}</p>
                  ) : p.type === "member" ? (
                    <select
                      required
                      value={p.user_id ?? ""}
                      onChange={e => {
                        const id = parseInt(e.target.value);
                        const mem = otherMembers.find(m => m.id === id);
                        updateParticipant(idx, { user_id: id, member_name: mem?.display_name || mem?.email || "" });
                      }}
                      className="w-full border rounded-lg px-2 py-2 text-sm bg-white text-gray-900"
                    >
                      <option value="">Seleccionar miembro...</option>
                      {otherMembers.map(m => (
                        <option key={m.id} value={m.id}>{m.display_name || m.email}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="space-y-1.5">
                      {agendaContacts.length > 0 && (
                        <select
                          value=""
                          onChange={e => {
                            const c = agendaContacts.find(a => a.id === parseInt(e.target.value));
                            if (!c) return;
                            updateParticipant(idx, { member_name: c.contact_name, contact: c.contact_phone });
                          }}
                          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-violet-50 border-violet-200 text-violet-700"
                        >
                          <option value="">📇 Elegir de la agenda...</option>
                          {agendaContacts.map(c => (
                            <option key={c.id} value={c.id}>{c.contact_name} · {c.contact_phone}</option>
                          ))}
                        </select>
                      )}
                      <input
                        required
                        type="text"
                        placeholder="Alias (ej: Maria)"
                        value={p.member_name}
                        onChange={e => updateParticipant(idx, { member_name: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="tel"
                          placeholder="WhatsApp o email (opcional)"
                          value={p.contact}
                          onChange={e => updateParticipant(idx, { contact: e.target.value })}
                          className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                        />
                        <button
                          type="button"
                          onClick={() => pickContact(idx)}
                          title={hasContactsApi ? "Elegir de contactos" : "Selector de contactos no disponible en este navegador"}
                          className="px-3 py-2 rounded-lg shrink-0 bg-gray-100 hover:bg-gray-200 text-gray-600"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                      </div>
                      {p.contact && (
                        <p className="text-xs text-violet-600">
                          {p.contact.includes("@")
                            ? "Se generara un link de invitacion para copiar"
                            : "Se enviara una invitacion por WhatsApp"
                          }
                        </p>
                      )}
                    </div>
                  )}

                  {splitType === "custom" ? (
                    <div>
                      <label className="text-xs text-gray-500">Monto</label>
                      <input
                        required
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9.,]*"
                        placeholder="0,00"
                        value={p.amount}
                        onChange={e => updateParticipant(idx, { amount: e.target.value })}
                        className="mt-0.5 w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs text-gray-500">Monto</span>
                      <span className="text-sm font-medium text-gray-700">
                        {totalAmount > 0 ? formatARS(equalShare) : "-"}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {splitType === "equal" && totalAmount > 0 && participants.length > 1 && (
              <p className="text-xs text-gray-500 mt-1.5">
                {formatARS(totalAmount)} / {participants.length} = {formatARS(equalShare)} por persona
              </p>
            )}

            {splitType === "custom" && totalAmount > 0 && (
              <div className={"mt-2 text-xs rounded-lg px-3 py-2 " + (overBudget ? "bg-red-50 text-red-600 font-medium" : "bg-blue-50 text-blue-700")}>
                {overBudget
                  ? "La division supera el total: " + formatARS(customTotal) + " de " + formatARS(totalAmount)
                  : "Distribuido: " + formatARS(customTotal) + " | Restante: " + formatARS(totalAmount - customTotal)
                }
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={sharing || participants.length < 2 || overBudget}
              className="flex-1 bg-primary text-white py-2 rounded-lg text-sm disabled:opacity-50">
              {sharing ? "Compartiendo..." : "Compartir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteItemModal({
  item,
  onConfirm,
  onClose,
}: {
  item: CardItem;
  onConfirm: (deleteGroup: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const isInstallment = item.item_type === "installment";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Eliminar {isInstallment ? "cuotas" : "item"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        {isInstallment ? (
          <p className="text-sm text-gray-600">
            Se eliminarán <strong>todas las {item.installment_count} cuotas</strong> de &quot;{item.description}&quot; y sus gastos en todos los resumenes.
          </p>
        ) : (
          <p className="text-sm text-gray-600">Se eliminara <strong>{item.description}</strong> y su gasto en Egresos.</p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border px-4 py-2.5 rounded-xl text-sm">Cancelar</button>
          <button onClick={async () => { setDeleting(true); await onConfirm(isInstallment); setDeleting(false); }}
            disabled={deleting} className="flex-1 bg-red-500 text-white px-4 py-2.5 rounded-xl text-sm disabled:opacity-50">
            {deleting ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditItemModal({
  item,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  item: CardItem;
  categories: Category[];
  onSave: (data: { description: string; category_id: number; item_date: string; amount: number }) => Promise<void>;
  onDelete: (item: CardItem) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    description: item.description,
    category_id: String(item.category_id),
    item_date: item.item_date,
    amount: String(item.amount),
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      description: form.description,
      category_id: parseInt(form.category_id),
      item_date: form.item_date,
      amount: parseAmount(form.amount),
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Editar item</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Descripcion</label>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Categoria</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.category_id} onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Fecha</label>
              <input type="date" className={INPUT}
                value={form.item_date} onChange={(e) => setForm((p) => ({ ...p, item_date: e.target.value }))} required />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Monto ($)</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={INPUT}
                value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} required />
            </div>
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <button type="button" onClick={() => { onClose(); onDelete(item); }}
              className="px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50 border border-red-200">
              Eliminar
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
              <button type="submit" disabled={saving} className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const INPUT = "mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900";

function NewCategoryModal({ onSave, onClose }: {
  onSave: (cat: { name: string; color: string; is_fixed: boolean }) => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState({ name: "", color: "#6366f1", is_fixed: false });
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{background:"rgba(0,0,0,0.4)"}} onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Nueva categoria</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSave(form); setSaving(false); }} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Nombre</label>
            <input className={INPUT} placeholder="Supermercado" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Color</label>
              <input type="color" className="mt-1 block h-9 w-12 border rounded-lg cursor-pointer"
                value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={form.is_fixed} onChange={(e) => setForm((p) => ({ ...p, is_fixed: e.target.checked }))} />
              Fijo
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {saving ? "Guardando..." : "Crear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StatementDetailPage() {
  const { appUser } = useAuth();
  const params = useParams();
  const router = useRouter();
  const cardId = Number(params.cardId);
  const statementId = Number(params.statementId);

  const [card, setCard] = useState<Card | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [adding, setAdding] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [deleteItem, setDeleteItem] = useState<CardItem | null>(null);
  const [shareItem, setShareItem] = useState<CardItem | null>(null);
  const [editItem, setEditItem] = useState<CardItem | null>(null);

  const load = useCallback(async () => {
    const [cardRes, stmtRes, catRes] = await Promise.all([
      api.get("/credit-cards"),
      api.get(`/credit-cards/${cardId}/statements`),
      api.get("/expenses/categories"),
    ]);
    const found = (cardRes.data as Card[]).find((c) => c.id === cardId);
    setCard(found || null);
    const foundStmt = (stmtRes.data as Statement[]).find((s) => s.id === statementId);
    setStatement(foundStmt || null);
    setCategories(catRes.data);
  }, [cardId, statementId]);

  useEffect(() => { load(); }, [load]);

  const handleAmountChange = (field: "amount" | "purchase_total", value: string) => {
    if (form.item_type !== "installment") {
      setForm((p) => ({ ...p, amount: value }));
      return;
    }
    const count = parseInt(form.installment_count) || 1;
    if (field === "amount") {
      const pt = parseAmount(value) * count;
      setForm((p) => ({ ...p, amount: value, purchase_total: isNaN(pt) ? "" : pt.toFixed(2) }));
    } else {
      const amt = parseAmount(value) / count;
      setForm((p) => ({ ...p, purchase_total: value, amount: isNaN(amt) ? "" : amt.toFixed(2) }));
    }
  };

  const handleInstallmentCountChange = (value: string) => {
    const count = parseInt(value) || 1;
    setForm((p) => {
      const amt = parseAmount(p.amount);
      const pt = isNaN(amt) ? "" : (amt * count).toFixed(2);
      return { ...p, installment_count: value, purchase_total: pt };
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    const payload: Record<string, unknown> = {
      description: form.description,
      item_date: form.item_date,
      item_type: form.item_type,
      amount: parseAmount(form.amount),
      currency: form.currency,
    };
    if (form.currency === "ARS") payload.category_id = parseInt(form.category_id);
    if (form.item_type === "installment") {
      payload.installment_count = parseInt(form.installment_count);
      payload.installment_number = 1;
      payload.purchase_total = parseAmount(form.purchase_total);
    }
    await api.post(`/credit-cards/statements/${statementId}/items`, payload);
    setForm(EMPTY_ITEM);
    setShowAddForm(false);
    await load();
    setAdding(false);
  };

  const handleDeleteItem = async (deleteGroup: boolean) => {
    if (!deleteItem) return;
    await api.delete(`/credit-cards/items/${deleteItem.id}?delete_group=${deleteGroup}`);
    setDeleteItem(null);
    await load();
  };

  const handleCreateCategory = async (cat: { name: string; color: string; is_fixed: boolean }) => {
    const res = await api.post("/expenses/categories", cat);
    await load();
    setForm((p) => ({ ...p, category_id: String(res.data.id) }));
    setShowNewCat(false);
  };

    const handleEditItem = async (data: { description: string; category_id: number; item_date: string; amount: number }) => {
    if (!editItem) return;
    await api.patch(`/credit-cards/items/${editItem.id}`, data);
    setEditItem(null);
    await load();
  };

  const handleFinalize = async () => {
    if (!confirm("Al finalizar se generaran las cuotas futuras y gastos recurrentes para el siguiente mes. Continuar?")) return;
    setFinalizing(true);
    await api.post(`/credit-cards/statements/${statementId}/finalize`);
    await load();
    setFinalizing(false);
  };

  if (!card || !statement) return <div className="p-6 text-sm text-gray-500">Cargando...</div>;

  const totalByCategory = statement.items.reduce<Record<number, { name: string; color?: string; total: number }>>((acc, item) => {
    const cid = item.category.id;
    if (!acc[cid]) acc[cid] = { name: item.category.name, color: item.category.color, total: 0 };
    acc[cid].total += Number(item.amount);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <div className="sticky top-0 z-10 bg-gray-50 pt-2 pb-3 -mx-4 px-4 md:-mx-8 md:px-8">
        <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/tarjetas/${cardId}`)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900">
              {MONTH_NAMES[statement.month - 1]} {statement.year}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              statement.status === "closed" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
            }`}>
              {statement.status === "closed" ? "Cerrado" : "Abierto"}
            </span>
          </div>
          <p className="text-sm text-gray-500">{card.alias} - {card.bank}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statement.status === "open" && (
            <button onClick={handleFinalize} disabled={finalizing}
              className="flex items-center gap-1.5 text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50">
              <CheckCircle className="w-4 h-4" />
              <span className="hidden sm:inline">{finalizing ? "Finalizando..." : "Finalizar"}</span>
            </button>
          )}
          <button onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 bg-primary text-white text-sm px-3 py-1.5 rounded-lg hover:opacity-90">
            <Plus className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Agregar</span>
          </button>
        </div>
        </div>
      </div>

      {/* Add item form */}
      {showAddForm && (
        <form onSubmit={handleAddItem} className="bg-white rounded-xl border p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Nuevo item</p>

          {/* Currency toggle — always at top */}
          <div className="flex gap-2">
            {(["ARS", "USD"] as const).map(cur => (
              <button key={cur} type="button"
                onClick={() => setForm(p => ({ ...p, currency: cur, category_id: cur === "USD" ? "" : p.category_id, item_type: cur === "USD" ? "single" : p.item_type }))}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${form.currency === cur ? "bg-primary text-white border-primary" : "text-gray-600 hover:bg-gray-50"}`}>
                {cur === "ARS" ? "$ ARS" : "U$D"}
              </button>
            ))}
          </div>
          {form.currency === "USD" && (
            <p className="text-xs text-gray-500 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
              Se agrega automáticamente a la categoría <strong>Consumo en dólares</strong>
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Descripcion</label>
              <input className={INPUT} placeholder="TV Samsung"
                value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
            </div>
            {form.currency !== "USD" && (
            <div>
              <label className="text-xs font-medium text-gray-600">Categoria</label>
              <div className="flex gap-1.5">
                <select className={INPUT}
                  value={form.category_id} onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))} required={form.currency === "ARS"}>
                  <option value="">Seleccionar...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" onClick={() => setShowNewCat(true)}
                  className="mt-1 px-2.5 border rounded-lg text-gray-500 hover:bg-gray-50 shrink-0 text-lg leading-none">+</button>
              </div>
            </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-600">Fecha</label>
              <input type="date" className={INPUT}
                value={form.item_date} onChange={(e) => setForm((p) => ({ ...p, item_date: e.target.value }))} required />
            </div>
            {form.currency !== "USD" && (
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Tipo</label>
              <div className="mt-1 flex gap-2">
                {(["single","installment","recurring"] as ItemType[]).map((t) => (
                  <button key={t} type="button"
                    onClick={() => setForm((p) => ({ ...p, item_type: t }))}
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                      form.item_type === t ? "bg-primary text-white border-primary" : "text-gray-600 hover:bg-gray-50"
                    }`}>
                    {t === "single" ? "Unico" : t === "installment" ? "Cuotas" : "Recurrente"}
                  </button>
                ))}
              </div>
            </div>
            )}

            {form.item_type === "installment" ? (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600">Cant. cuotas</label>
                  <input type="number" min="2" className={INPUT}
                    value={form.installment_count} onChange={(e) => handleInstallmentCountChange(e.target.value)} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Monto por cuota ($)</label>
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={INPUT}
                    value={form.amount} onChange={(e) => handleAmountChange("amount", e.target.value)} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Monto total ($)</label>
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={INPUT}
                    value={form.purchase_total} onChange={(e) => handleAmountChange("purchase_total", e.target.value)} />
                  <p className="text-xs text-gray-400 mt-0.5">Modificar uno auto-calcula el otro</p>
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs font-medium text-gray-600">Monto ($)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" className={INPUT}
                  value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} required />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setShowAddForm(false); setForm(EMPTY_ITEM); }}
              className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={adding} className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {adding ? "Agregando..." : "Agregar"}
            </button>
          </div>
        </form>
      )}

      {/* Items list */}
      <div className="bg-white rounded-xl border divide-y">
        {statement.items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No hay items en este resumen.</p>
        ) : (
          statement.items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 px-4 py-3">
              <button
                onClick={() => item.installment_group_id
                  ? router.push(`/tarjetas/${cardId}/${item.installment_root_statement_id}`)
                  : setEditItem(item)
                }
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.category.color || "#6366f1" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 truncate">{item.description}</span>
                    {itemTypeBadge(item)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">{item.category.name}</span>
                    <span className="text-xs text-gray-300">|</span>
                    <span className="text-xs text-gray-400">{formatDate(item.item_date)}</span>
                  </div>
                </div>
              </button>
              <span className="text-sm font-semibold text-red-500 shrink-0">{item.currency === "USD" ? formatUSD(item.amount) : formatARS(item.amount)}</span>
              {!item.installment_group_id && (
                <button
                  onClick={() => !item.shared_expense_id && setShareItem(item)}
                  title={item.shared_expense_id ? "Ya compartido" : "Compartir gasto"}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    item.shared_expense_id ? "text-blue-500 cursor-default" :
                    "text-gray-300 hover:text-blue-500 hover:bg-blue-50"
                  }`}
                >
                  <Users2 className="w-4 h-4" />
                </button>
              )}
              {item.installment_group_id && (
                <span className="flex items-center gap-1 text-xs text-blue-500 shrink-0 px-1">
                  <ExternalLink className="w-3 h-3" />
                  <span className="hidden sm:inline">Original</span>
                </span>
              )}
            </div>
          ))
        )}
        {statement.items.length > 0 && (() => {
          const arsTotal = statement.items.filter(i => i.currency !== "USD").reduce((s, i) => s + Number(i.amount), 0);
          const usdTotal = statement.items.filter(i => i.currency === "USD").reduce((s, i) => s + Number(i.amount), 0);
          return (
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-b-xl flex-wrap gap-1">
              <span className="text-sm font-medium text-gray-700">Total</span>
              <div className="flex flex-col items-end gap-0.5">
                {arsTotal > 0 && <span className="text-base font-bold text-red-500">{formatARS(arsTotal)}</span>}
                {usdTotal > 0 && <span className="text-sm font-bold text-green-600">U$D {usdTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Category summary */}
      {Object.keys(totalByCategory).length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Por categoria</p>
          <div className="space-y-2">
            {Object.values(totalByCategory).sort((a, b) => b.total - a.total).map((cat) => (
              <div key={cat.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || "#6366f1" }} />
                <span className="flex-1 text-sm text-gray-700 truncate">{cat.name}</span>
                <span className="text-sm font-semibold text-gray-900">{formatARS(cat.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deleteItem && (
        <DeleteItemModal item={deleteItem} onConfirm={handleDeleteItem} onClose={() => setDeleteItem(null)} />
      )}
      {editItem && (
        <EditItemModal item={editItem} categories={categories} onSave={handleEditItem} onDelete={setDeleteItem} onClose={() => setEditItem(null)} />
      )}
      {showNewCat && <NewCategoryModal onSave={handleCreateCategory} onClose={() => setShowNewCat(false)} />}
      {shareItem && (
        <ShareItemModal item={shareItem} onClose={() => setShareItem(null)} onDone={() => { setShareItem(null); load(); }} currentUser={appUser} />
      )}
    </div>
  );
}

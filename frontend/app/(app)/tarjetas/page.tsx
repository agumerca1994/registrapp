"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { CreditCard, Plus, Pencil, Trash2, X, ChevronRight } from "lucide-react";

interface Card {
  id: number;
  bank: string;
  alias: string;
  titular?: string;
  last_4_digits?: string;
  created_at: string;
}

const EMPTY_FORM = { bank: "", alias: "", titular: "", last_4_digits: "" };
const INPUT = "mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900";

type DeleteMode = "keep" | "delete";

function CardModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Card;
  onSave: (data: typeof EMPTY_FORM) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState(
    initial
      ? {
          bank: initial.bank,
          alias: initial.alias,
          titular: initial.titular || "",
          last_4_digits: initial.last_4_digits || "",
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial ? "Editar tarjeta" : "Nueva tarjeta"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Banco</label>
              <input className={INPUT} placeholder="Galicia"
                value={form.bank} onChange={(e) => setForm((p) => ({ ...p, bank: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Alias</label>
              <input className={INPUT} placeholder="Visa Gold"
                value={form.alias} onChange={(e) => setForm((p) => ({ ...p, alias: e.target.value }))} required />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Titular (opcional)</label>
              <input className={INPUT} placeholder="Miguel Mercado"
                value={form.titular} onChange={(e) => setForm((p) => ({ ...p, titular: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Últimos 4 dígitos (opcional)</label>
              <input maxLength={4} className={INPUT} placeholder="1234"
                value={form.last_4_digits} onChange={(e) => setForm((p) => ({ ...p, last_4_digits: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="border px-4 py-2 rounded-lg text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="bg-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteCardModal({
  card,
  onConfirm,
  onClose,
}: {
  card: Card;
  onConfirm: (mode: DeleteMode) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<DeleteMode>("keep");
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Eliminar tarjeta</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-600">
          Se eliminarán <strong>{card.alias} ({card.bank})</strong> y todos sus resúmenes.
          ¿Qué hacemos con los gastos en Egresos ya generados?
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" name="mode" value="keep" checked={mode === "keep"} onChange={() => setMode("keep")} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium">Mantener los gastos</p>
              <p className="text-xs text-gray-500">Los gastos quedan en Egresos sin asociación a la tarjeta</p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" name="mode" value="delete" checked={mode === "delete"} onChange={() => setMode("delete")} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium">Eliminar todos los gastos</p>
              <p className="text-xs text-gray-500">Se borran permanentemente todos los gastos de esta tarjeta</p>
            </div>
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border px-4 py-2.5 rounded-xl text-sm">Cancelar</button>
          <button
            onClick={async () => { setDeleting(true); await onConfirm(mode); setDeleting(false); }}
            disabled={deleting}
            className="flex-1 bg-red-500 text-white px-4 py-2.5 rounded-xl text-sm disabled:opacity-50"
          >
            {deleting ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TarjetasPage() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [deleteCard, setDeleteCard] = useState<Card | null>(null);

  const load = async () => {
    const res = await api.get("/credit-cards");
    setCards(res.data);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (form: typeof EMPTY_FORM) => {
    const payload = {
      bank: form.bank,
      alias: form.alias,
      titular: form.titular || null,
      last_4_digits: form.last_4_digits || null,
    };
    if (editCard) await api.patch(`/credit-cards/${editCard.id}`, payload);
    else await api.post("/credit-cards", payload);
    setShowModal(false);
    setEditCard(null);
    await load();
  };

  const handleDelete = async (mode: DeleteMode) => {
    if (!deleteCard) return;
    await api.delete(`/credit-cards/${deleteCard.id}?keep_expenses=${mode === "keep"}`);
    setDeleteCard(null);
    await load();
  };

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900">Tarjetas de crédito</h2>
        <button
          onClick={() => { setEditCard(null); setShowModal(true); }}
          className="flex items-center gap-1 bg-primary text-white text-sm px-3 py-1.5 rounded-lg hover:opacity-90"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Nueva tarjeta</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border divide-y">
        {cards.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No hay tarjetas registradas.</p>
            <p className="text-xs mt-1">Agregá tu primera tarjeta para empezar.</p>
          </div>
        ) : (
          cards.map((card) => (
            <div key={card.id} className="flex items-center gap-3 px-4 py-4">
              <button
                className="flex-1 flex items-center gap-3 min-w-0 text-left hover:opacity-80 active:opacity-60"
                onClick={() => router.push(`/tarjetas/${card.id}`)}
              >
                <div className="bg-primary/10 p-2 rounded-lg shrink-0">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{card.alias}</p>
                  <p className="text-xs text-gray-500">
                    {card.bank}{card.last_4_digits ? ` •••• ${card.last_4_digits}` : ""}
                  </p>
                  {card.titular && <p className="text-xs text-gray-400 truncate">{card.titular}</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 ml-auto" />
              </button>
              <button onClick={() => { setEditCard(card); setShowModal(true); }} className="p-2 text-gray-400 hover:text-gray-600 shrink-0">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setDeleteCard(card)} className="p-2 text-gray-400 hover:text-red-500 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <CardModal initial={editCard || undefined} onSave={handleSave} onClose={() => { setShowModal(false); setEditCard(null); }} />
      )}
      {deleteCard && (
        <DeleteCardModal card={deleteCard} onConfirm={handleDelete} onClose={() => setDeleteCard(null)} />
      )}
    </div>
  );
}

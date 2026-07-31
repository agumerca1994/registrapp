"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { CreditCard, Plus, Pencil, Trash2, X, ChevronRight } from "lucide-react";
import { Card as UiCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Card {
  id: number;
  bank: string;
  alias: string;
  titular?: string;
  last_4_digits?: string;
  created_at: string;
}

const EMPTY_FORM = { bank: "", alias: "", titular: "", last_4_digits: "" };
const INPUT = "mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground";

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
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">{initial ? "Editar tarjeta" : "Nueva tarjeta"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Banco</label>
              <input className={INPUT} placeholder="Galicia"
                value={form.bank} onChange={(e) => setForm((p) => ({ ...p, bank: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Alias</label>
              <input className={INPUT} placeholder="Visa Gold"
                value={form.alias} onChange={(e) => setForm((p) => ({ ...p, alias: e.target.value }))} required />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Titular (opcional)</label>
              <input className={INPUT} placeholder="Miguel Mercado"
                value={form.titular} onChange={(e) => setForm((p) => ({ ...p, titular: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Últimos 4 dígitos (opcional)</label>
              <input maxLength={4} className={INPUT} placeholder="1234"
                value={form.last_4_digits} onChange={(e) => setForm((p) => ({ ...p, last_4_digits: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </UiCard>
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
      <UiCard className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Eliminar tarjeta</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground">
          Se eliminarán <strong>{card.alias} ({card.bank})</strong> y todos sus resúmenes.
          ¿Qué hacemos con los gastos en Egresos ya generados?
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
            <input type="radio" name="mode" value="keep" checked={mode === "keep"} onChange={() => setMode("keep")} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Mantener los gastos</p>
              <p className="text-xs text-muted-foreground">Los gastos quedan en Egresos sin asociación a la tarjeta</p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
            <input type="radio" name="mode" value="delete" checked={mode === "delete"} onChange={() => setMode("delete")} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Eliminar todos los gastos</p>
              <p className="text-xs text-muted-foreground">Se borran permanentemente todos los gastos de esta tarjeta</p>
            </div>
          </label>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button
            variant="destructive"
            onClick={async () => { setDeleting(true); await onConfirm(mode); setDeleting(false); }}
            disabled={deleting}
            className="flex-1"
          >
            {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </div>
      </UiCard>
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
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Tarjetas de crédito</h2>
        <Button onClick={() => { setEditCard(null); setShowModal(true); }}>
          <Plus className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Nueva tarjeta</span>
        </Button>
      </div>

      <UiCard className="p-0 md:p-0 divide-y">
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
                  <p className="font-semibold text-foreground truncate">{card.alias}</p>
                  <p className="text-xs text-muted-foreground">
                    {card.bank}{card.last_4_digits ? ` •••• ${card.last_4_digits}` : ""}
                  </p>
                  {card.titular && <p className="text-xs text-muted-foreground/70 truncate">{card.titular}</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 ml-auto" />
              </button>
              <button onClick={() => { setEditCard(card); setShowModal(true); }} className="p-2 text-muted-foreground hover:text-foreground shrink-0">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setDeleteCard(card)} className="p-2 text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </UiCard>

      {showModal && (
        <CardModal initial={editCard || undefined} onSave={handleSave} onClose={() => { setShowModal(false); setEditCard(null); }} />
      )}
      {deleteCard && (
        <DeleteCardModal card={deleteCard} onConfirm={handleDelete} onClose={() => setDeleteCard(null)} />
      )}
    </div>
  );
}

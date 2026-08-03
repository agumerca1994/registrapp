"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { CreditCard, Plus, X, Search, ArrowUp, ArrowDown, SlidersHorizontal, ChevronDown } from "lucide-react";
import { Card as UiCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCardVisual } from "@/components/CreditCardVisual";
import { ARGENTINE_BANKS } from "@/lib/banks";

const OTRO = "__otro__";

interface Card {
  id: number;
  bank: string;
  alias: string;
  titular?: string;
  last_4_digits?: string;
  created_at: string;
}

interface Member {
  id: number;
  display_name: string | null;
  email: string;
}

const EMPTY_FORM = { bank: "", alias: "", titular: "", last_4_digits: "" };
const INPUT = "mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-card text-foreground";

type DeleteMode = "keep" | "delete";

function CardModal({
  initial,
  members,
  onSave,
  onClose,
}: {
  initial?: Card;
  members: Member[];
  onSave: (data: typeof EMPTY_FORM) => Promise<void>;
  onClose: () => void;
}) {
  const memberNames = members.map((m) => m.display_name || m.email);
  const initialIsKnownBank = !initial || ARGENTINE_BANKS.some((b) => b.name === initial.bank);
  const initialIsKnownMember = !initial?.titular || memberNames.includes(initial.titular);
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
  const [bankSelect, setBankSelect] = useState(initialIsKnownBank ? (initial?.bank ?? "") : OTRO);
  const [titularMode, setTitularMode] = useState<"hogar" | "personalizado">(
    initial?.titular && !initialIsKnownMember ? "personalizado" : "hogar"
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
            <div className={bankSelect === OTRO ? "sm:col-span-2" : ""}>
              <label className="text-xs font-medium text-muted-foreground">Banco</label>
              <select
                className={INPUT}
                value={bankSelect}
                onChange={(e) => {
                  const v = e.target.value;
                  setBankSelect(v);
                  setForm((p) => ({ ...p, bank: v === OTRO ? "" : v }));
                }}
                required
              >
                <option value="" disabled>Seleccionar...</option>
                {ARGENTINE_BANKS.map((b) => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
                <option value={OTRO}>Otro...</option>
              </select>
              {bankSelect === OTRO && (
                <input
                  className={`${INPUT} mt-2`}
                  placeholder="Nombre del banco/entidad"
                  value={form.bank}
                  onChange={(e) => setForm((p) => ({ ...p, bank: e.target.value }))}
                  required
                />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Alias</label>
              <input className={INPUT} placeholder="Visa Gold"
                value={form.alias} onChange={(e) => setForm((p) => ({ ...p, alias: e.target.value }))} required />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Titular (opcional)</label>
              <div className="mt-1 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => { setTitularMode("hogar"); setForm((p) => ({ ...p, titular: "" })); }}
                  className={`px-2.5 py-1 text-xs rounded-full border-2 transition-colors ${titularMode === "hogar" ? "border-ink bg-accent text-primary font-medium" : "border-transparent text-muted-foreground/60 hover:bg-accent"}`}
                >
                  Hogar
                </button>
                <button
                  type="button"
                  onClick={() => { setTitularMode("personalizado"); setForm((p) => ({ ...p, titular: "" })); }}
                  className={`px-2.5 py-1 text-xs rounded-full border-2 transition-colors ${titularMode === "personalizado" ? "border-ink bg-accent text-primary font-medium" : "border-transparent text-muted-foreground/60 hover:bg-accent"}`}
                >
                  Personalizado
                </button>
              </div>
              {titularMode === "hogar" ? (
                <select
                  className={`${INPUT} mt-2`}
                  value={form.titular}
                  onChange={(e) => setForm((p) => ({ ...p, titular: e.target.value }))}
                >
                  <option value="">Sin especificar</option>
                  {memberNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${INPUT} mt-2`}
                  placeholder="Nombre del titular"
                  value={form.titular}
                  onChange={(e) => setForm((p) => ({ ...p, titular: e.target.value }))}
                />
              )}
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

type SortField = "titular" | "bank" | null;

function SortChip({ label, active, dir, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border-2 transition-colors ${active ? "border-ink bg-accent text-primary font-medium" : "border-transparent text-muted-foreground/60 hover:bg-accent"}`}
    >
      {label}
      {active && (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
    </button>
  );
}

function PillSelect({ value, onChange, children }: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; children: React.ReactNode }) {
  return (
    <div className="relative flex-1">
      <select
        value={value}
        onChange={onChange}
        className="w-full appearance-none rounded-full border-2 border-ink bg-card pl-3 pr-8 py-1.5 text-xs font-medium text-foreground cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
    </div>
  );
}

export default function TarjetasPage() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [deleteCard, setDeleteCard] = useState<Card | null>(null);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showCustomFilter, setShowCustomFilter] = useState(false);
  const [filterTitular, setFilterTitular] = useState("");
  const [filterBank, setFilterBank] = useState("");

  const load = async () => {
    const res = await api.get("/credit-cards");
    setCards(res.data);
  };

  useEffect(() => {
    load();
    api.get("/auth/members").then((res) => setMembers(res.data)).catch(() => {});
  }, []);

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

  const distinctTitulares = useMemo(
    () => Array.from(new Set(cards.map((c) => c.titular).filter(Boolean))) as string[],
    [cards]
  );
  const distinctBanks = useMemo(() => Array.from(new Set(cards.map((c) => c.bank))), [cards]);
  const customFilterActive = filterTitular !== "" || filterBank !== "";

  // Tap cycle: inactive -> A-Z -> Z-A -> inactive (clears the sort).
  function toggleSort(field: "titular" | "bank") {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortField(null);
  }

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards
      .filter((c) => {
        if (q) {
          const hay = `${c.bank} ${c.alias} ${c.titular || ""} ${c.last_4_digits || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filterTitular && c.titular !== filterTitular) return false;
        if (filterBank && c.bank !== filterBank) return false;
        return true;
      })
      .sort((a, b) => {
        if (!sortField) return 0;
        const av = (sortField === "titular" ? a.titular : a.bank) || "";
        const bv = (sortField === "titular" ? b.titular : b.bank) || "";
        const cmp = av.localeCompare(bv, "es");
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [cards, search, filterTitular, filterBank, sortField, sortDir]);

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">Tarjetas de crédito</h2>
        <Button onClick={() => { setEditCard(null); setShowModal(true); }}>
          <Plus className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Nueva tarjeta</span>
        </Button>
      </div>

      {cards.length === 0 ? (
        <UiCard className="p-8 text-center text-muted-foreground">
          <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay tarjetas registradas.</p>
          <p className="text-xs mt-1">Agregá tu primera tarjeta para empezar.</p>
        </UiCard>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap min-h-[30px]">
              {!searchOpen ? (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="p-1.5 -ml-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                  title="Buscar"
                >
                  <Search className="w-4 h-4" />
                </button>
              ) : (
                <div className="flex items-center gap-1.5 flex-1 min-w-[160px] border-b-2 border-ink pb-0.5">
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <input
                    autoFocus
                    className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
                    placeholder="Buscar por banco, alias o titular..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => { setSearch(""); setSearchOpen(false); }}
                    className="p-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {!searchOpen && (
                <>
                  <SortChip label="Titular" active={sortField === "titular"} dir={sortDir} onClick={() => toggleSort("titular")} />
                  <SortChip label="Banco" active={sortField === "bank"} dir={sortDir} onClick={() => toggleSort("bank")} />
                  <button
                    type="button"
                    onClick={() => setShowCustomFilter((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border-2 transition-colors ${customFilterActive ? "border-ink bg-accent text-primary font-medium" : "border-transparent text-muted-foreground/60 hover:bg-accent"}`}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    Personalizado
                  </button>
                </>
              )}
            </div>
            {showCustomFilter && !searchOpen && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <PillSelect value={filterTitular} onChange={(e) => setFilterTitular(e.target.value)}>
                  <option value="">Todos los titulares</option>
                  {distinctTitulares.map((t) => <option key={t} value={t}>{t}</option>)}
                </PillSelect>
                <PillSelect value={filterBank} onChange={(e) => setFilterBank(e.target.value)}>
                  <option value="">Todos los bancos</option>
                  {distinctBanks.map((b) => <option key={b} value={b}>{b}</option>)}
                </PillSelect>
                {customFilterActive && (
                  <button
                    type="button"
                    onClick={() => { setFilterTitular(""); setFilterBank(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 shrink-0 self-center"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            )}
          </div>

          {visibleCards.length === 0 ? (
            <UiCard className="p-8 text-center text-muted-foreground">
              <p className="text-sm">Ninguna tarjeta coincide con la búsqueda/filtro.</p>
            </UiCard>
          ) : (
            <div className="space-y-3">
              {visibleCards.map((card) => (
                <CreditCardVisual
                  key={card.id}
                  card={card}
                  onClick={() => router.push(`/tarjetas/${card.id}`)}
                  onEdit={() => { setEditCard(card); setShowModal(true); }}
                  onDelete={() => setDeleteCard(card)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showModal && (
        <CardModal initial={editCard || undefined} members={members} onSave={handleSave} onClose={() => { setShowModal(false); setEditCard(null); }} />
      )}
      {deleteCard && (
        <DeleteCardModal card={deleteCard} onConfirm={handleDelete} onClose={() => setDeleteCard(null)} />
      )}
    </div>
  );
}

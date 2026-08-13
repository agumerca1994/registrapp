"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { CreditCard, Plus, X, SlidersHorizontal } from "lucide-react";
import { Card as UiCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FIELD, FormGrid, SelectField } from "@/components/ui/form";
import {
  FilterBar, FilterRow, FilterPanel, SortChip, FilterChip, PillSelect,
  ClearFilters, CollapsibleSearch,
} from "@/components/ui/filters";
import { CreditCardVisual } from "@/components/CreditCardVisual";
import { ARGENTINE_BANKS } from "@/lib/banks";

const OTRO = "__otro__";

interface Card {
  id: number;
  bank: string;
  alias: string;
  titular?: string;
  last_4_digits?: string;
  due_day?: number | null;
  created_at: string;
}

interface Member {
  id: number;
  display_name: string | null;
  email: string;
}

const EMPTY_FORM = { bank: "", alias: "", titular: "", last_4_digits: "", due_day: "" };

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
          due_day: initial.due_day != null ? String(initial.due_day) : "",
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
          <FormGrid>
            <div className={bankSelect === OTRO ? "sm:col-span-2" : ""}>
              <label className="text-xs font-medium text-muted-foreground">Banco</label>
              <SelectField
                required
                value={bankSelect}
                onChange={(v) => {
                  setBankSelect(v);
                  setForm((p) => ({ ...p, bank: v === OTRO ? "" : v }));
                }}
                placeholder="Banco"
                options={[
                  ...ARGENTINE_BANKS.map((b) => ({ value: b.name, label: b.name })),
                  { value: OTRO, label: "Otro..." },
                ]} />
              {bankSelect === OTRO && (
                <input
                  className={FIELD}
                  placeholder="Nombre del banco/entidad"
                  value={form.bank}
                  onChange={(e) => setForm((p) => ({ ...p, bank: e.target.value }))}
                  required
                />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Alias</label>
              <input className={FIELD} placeholder="Visa Gold"
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
                <SelectField className="mt-1"
                  value={form.titular}
                  onChange={(v) => setForm((p) => ({ ...p, titular: v }))}
                  placeholder="Sin especificar"
                  options={memberNames.map((name) => ({ value: name, label: name }))} />
              ) : (
                <input
                  className={FIELD}
                  placeholder="Nombre del titular"
                  value={form.titular}
                  onChange={(e) => setForm((p) => ({ ...p, titular: e.target.value }))}
                />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Últimos 4 dígitos (opcional)</label>
              <input maxLength={4} className={FIELD} placeholder="1234"
                value={form.last_4_digits} onChange={(e) => setForm((p) => ({ ...p, last_4_digits: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Día de vencimiento (opcional)</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} className={FIELD} placeholder="7"
                value={form.due_day} onChange={(e) => setForm((p) => ({ ...p, due_day: e.target.value.replace(/[^0-9]/g, "") }))} />
              <p className="text-[11px] text-muted-foreground mt-1">
                Se usa para estimar en qué mes se paga un resumen mientras el banco
                no envió el vencimiento real. Al cargar la fecha real, la estimación se pisa.
              </p>
            </div>
          </FormGrid>
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
      due_day: form.due_day ? Number(form.due_day) : null,
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
          <FilterBar>
            <FilterRow>
              <CollapsibleSearch
                open={searchOpen}
                onOpen={() => setSearchOpen(true)}
                onClose={() => { setSearch(""); setSearchOpen(false); }}
                value={search}
                onChange={setSearch}
                placeholder="Buscar por banco, alias o titular..."
              />
              {!searchOpen && (
                <>
                  <SortChip label="Titular" active={sortField === "titular"} dir={sortDir} onClick={() => toggleSort("titular")} />
                  <SortChip label="Banco" active={sortField === "bank"} dir={sortDir} onClick={() => toggleSort("bank")} />
                  <FilterChip
                    label="Personalizado" icon={SlidersHorizontal}
                    active={customFilterActive}
                    onClick={() => setShowCustomFilter((v) => !v)}
                  />
                </>
              )}
            </FilterRow>
            {showCustomFilter && !searchOpen && (
              <FilterPanel>
                <PillSelect value={filterTitular} onChange={setFilterTitular} placeholder="Titular"
                  options={distinctTitulares.map((t) => ({ value: t, label: t }))} />
                <PillSelect value={filterBank} onChange={setFilterBank} placeholder="Banco"
                  options={distinctBanks.map((b) => ({ value: b, label: b }))} />
                {customFilterActive && (
                  <ClearFilters onClick={() => { setFilterTitular(""); setFilterBank(""); }} />
                )}
              </FilterPanel>
            )}
          </FilterBar>

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

"use client";

import { VIOLET } from "@/components/ui/glass";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Step } from "react-joyride";
import api from "@/lib/api";
import { ArrowRight, CreditCard, Plus, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { terms } from "@/lib/account";
import { formatARSRound, getErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCountUp } from "@/components/ui/count-up";
import { FIELD, FieldLabel, FormGrid, SegmentedToggle, SelectField } from "@/components/ui/form";
import {
  FilterBar, FilterRow, FilterPanel, SortChip, FilterChip, PillSelect,
  ClearFilters, CollapsibleSearch,
} from "@/components/ui/filters";
import { CreditCardVisual, type CardNextDue } from "@/components/CreditCardVisual";
import { ARGENTINE_BANKS } from "@/lib/banks";
import { features } from "@/lib/features";
import { UploadStatementButton } from "@/components/UploadStatementButton";
import { usePendingStatements } from "@/contexts/PendingStatementsContext";
import { periodLabel } from "@/app/(app)/conciliar/shared";
import ProductTour from "@/components/ProductTour";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { MotionList } from "@/components/ui/motion-list";
import { ledgerAmount } from "@/components/movimientos/Ledger";
import { FORM_SHEET_BODY, FORM_SHEET_FORM, FormSheet, FormSheetActions } from "@/components/movimientos/FormSheet";
import { DeleteChoiceSheet, ErrorNote, shortDate, totalsByCurrency } from "@/components/tarjetas/parts";

const OTRO = "__otro__";

// Lo que hay en la pantalla, en el orden en que se mira. Los dos primeros pasos
// dependen de los datos: sin un vencimiento a la vista o sin nada por revisar, no
// están. Con la pantalla vacía no hay guía (queda para cuando haya una tarjeta).
const tourSteps = (hasNext: boolean, hasPending: boolean): Step[] => [
  ...(hasNext ? [{
    target: "[data-tour='cards-next']",
    title: "Lo próximo que vence",
    content: "El resumen que sale primero, con su fecha. Si el banco todavía no mandó el vencimiento, se estima y lo dice. Tocalo para ver qué tiene.",
  }] : []),
  ...(hasPending ? [{
    target: "[data-tour='cards-pending']",
    title: "Resúmenes por revisar",
    content: "Los que subiste y todavía esperan que decidas algo.",
  }] : []),
  {
    target: "[data-tour='cards-list']",
    title: "Tus tarjetas",
    content: "Tocá una para ver sus resúmenes: el de este mes, los anteriores y los que ya tienen cuotas cargadas.",
  },
  ...(features.reconcile ? [{
    target: "[data-tour='cards-upload']",
    title: "Subí el resumen",
    content: "Subí el PDF del banco y se compara con lo que ya cargaste. No cambia nada hasta que lo confirmes.",
  }] : []),
  {
    target: "[data-tour='cards-new']",
    title: "Una tarjeta nueva",
    content: "Con el banco y un alias alcanza. Si le ponés el día de vencimiento, se estima cuándo se paga cada resumen.",
  },
];

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

interface StatementLite {
  id: number;
  due_date?: string;
  due_date_effective?: string;
  due_date_is_estimated?: boolean;
  items: { amount: number | string; currency?: string | null }[];
}

type NextDue = CardNextDue & { statementId: number };

const EMPTY_FORM = { bank: "", alias: "", titular: "", last_4_digits: "", due_day: "" };

/** El primer resumen con plata que todavía no venció. Sin fecha o sin gastos no hay nada que anticipar. */
function nextDueOf(statements: StatementLite[], today: string): NextDue | undefined {
  let next: NextDue | undefined;
  for (const s of statements) {
    const date = s.due_date || s.due_date_effective;
    if (!date || date < today) continue;
    const { ars, usd } = totalsByCurrency(s.items);
    if (ars <= 0 && usd <= 0) continue;
    if (!next || date < next.date) {
      next = { statementId: s.id, date, estimated: !!s.due_date_is_estimated, ars, usd };
    }
  }
  return next;
}

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
  const { appUser } = useAuth();
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
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo guardar la tarjeta"));
      setSaving(false);
    }
  };

  const accountWord = terms(appUser).Space;

  return (
    <FormSheet title={initial ? "Editar tarjeta" : "Nueva tarjeta"} onClose={onClose}>
      <form onSubmit={handleSubmit} className={FORM_SHEET_FORM}>
        <div className={FORM_SHEET_BODY}>
          <FormGrid>
            <div className={bankSelect === OTRO ? "sm:col-span-2" : ""}>
              <FieldLabel>Banco</FieldLabel>
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
                  aria-label="Nombre del banco o entidad"
                  placeholder="Nombre del banco o entidad"
                  value={form.bank}
                  onChange={(e) => setForm((p) => ({ ...p, bank: e.target.value }))}
                  required
                />
              )}
            </div>
            <div>
              <FieldLabel>Alias</FieldLabel>
              <input className={FIELD} placeholder="Visa Gold" aria-label="Alias"
                value={form.alias} onChange={(e) => setForm((p) => ({ ...p, alias: e.target.value }))} required />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel hint="(opcional)">Titular</FieldLabel>
              <SegmentedToggle
                ariaLabel="De dónde sale el titular"
                className="mt-1"
                value={titularMode}
                onChange={(mode) => { setTitularMode(mode); setForm((p) => ({ ...p, titular: "" })); }}
                options={[
                  { value: "hogar", label: accountWord },
                  { value: "personalizado", label: "Otro nombre" },
                ]} />
              {titularMode === "hogar" ? (
                <SelectField className="mt-1"
                  value={form.titular}
                  onChange={(v) => setForm((p) => ({ ...p, titular: v }))}
                  placeholder="Sin especificar"
                  options={memberNames.map((name) => ({ value: name, label: name }))} />
              ) : (
                <input
                  className={FIELD}
                  aria-label="Nombre del titular"
                  placeholder="Nombre del titular"
                  value={form.titular}
                  onChange={(e) => setForm((p) => ({ ...p, titular: e.target.value }))}
                />
              )}
            </div>
            <div>
              <FieldLabel hint="(opcional)">Últimos 4 dígitos</FieldLabel>
              <input maxLength={4} inputMode="numeric" pattern="[0-9]*" className={FIELD} placeholder="1234" aria-label="Últimos 4 dígitos"
                value={form.last_4_digits} onChange={(e) => setForm((p) => ({ ...p, last_4_digits: e.target.value.replace(/[^0-9]/g, "") }))} />
            </div>
            <div>
              <FieldLabel hint="(opcional)">Día de vencimiento</FieldLabel>
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} className={FIELD} placeholder="7" aria-label="Día de vencimiento"
                value={form.due_day} onChange={(e) => setForm((p) => ({ ...p, due_day: e.target.value.replace(/[^0-9]/g, "") }))} />
            </div>
          </FormGrid>
          <p className="px-1 text-xs leading-snug text-muted-foreground">
            El día de vencimiento sirve para estimar en qué mes se paga un resumen mientras
            el banco no mandó la fecha real. Cuando la cargás, la estimación se pisa.
          </p>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <FormSheetActions onCancel={onClose} saving={saving} label="Guardar" />
      </form>
    </FormSheet>
  );
}

/**
 * Los resúmenes subidos que todavía esperan algo, a un toque desde Tarjetas.
 * El historial completo (también los que ya están al día) vive en
 * /tarjetas/resumenes, adonde lleva "Ver todos" y el botón "Subir resumen".
 */
function PendingStatementsCard() {
  const { pending } = usePendingStatements();
  if (pending.length === 0) return null;
  return (
    <section data-tour="cards-pending" className="rounded-3xl pt-3.5 px-2.5 pb-2.5 bg-accent border border-[#CFC9E4]">
      <div className="mx-2 mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="font-marca text-xs font-normal text-[#3B2FB3]">Resúmenes por revisar</h3>
        <Link href="/tarjetas/resumenes" className="text-sm font-semibold text-[#3B2FB3]">Ver todos</Link>
      </div>
      <MotionList className="space-y-1.5">
        {pending.map((p) => {
          const label = [p.bank, periodLabel(p.period_year, p.period_month)].filter(Boolean).join(" · ")
            || "Resumen sin identificar";
          const state = p.status === "needs_choice" ? "Falta elegir" : `${p.pending_count} por revisar`;
          return (
            <Link key={p.id} href={`/conciliar/${p.id}`}
              className="min-h-[58px] flex items-center gap-3 pl-3.5 pr-2 py-[7px] rounded-2xl bg-white active:scale-[0.99] transition-transform duration-100">
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-[15.5px] text-foreground truncate first-letter:uppercase">{label}</span>
                <span className="block text-sm text-muted-foreground truncate">{state}</span>
              </span>
              <span className="h-9 pl-3 pr-[5px] flex items-center gap-2 rounded-full bg-secondary text-sm font-medium shrink-0">
                Ver
                <span className="w-[26px] h-[26px] rounded-full bg-ink text-background flex items-center justify-center">
                  <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.4} />
                </span>
              </span>
            </Link>
          );
        })}
      </MotionList>
    </section>
  );
}

const FIELD_BLOCK = `!mt-0 rounded-[34px] ${VIOLET} px-4 pt-4 pb-4 md:px-6 md:pt-5 md:pb-5`;

/** La cifra del bloque violeta: lo que sale primero. Un resumen, no la suma de todos. */
function NextDueFigure({ cardAlias, cardId, next, after }: {
  cardAlias: string;
  cardId: number;
  next: NextDue;
  after?: { alias: string; date: string };
}) {
  const counted = useCountUp(next.ars);
  return (
    <Link href={`/tarjetas/${cardId}/${next.statementId}`} data-tour="cards-next"
      className="block mt-3.5 active:opacity-80 transition-opacity">
      <span className="block text-[15.5px] font-medium">Lo próximo que vence</span>
      <span className="block font-medium leading-[1.08] tracking-[-0.045em] tabular-nums text-[clamp(2.5rem,12.5vw,3.25rem)]">
        {next.ars > 0 ? formatARSRound(Math.round(counted)) : ledgerAmount(next.usd, "USD")}
      </span>
      {next.ars > 0 && next.usd > 0 && (
        <span className="block text-lg font-medium tabular-nums">+ {ledgerAmount(next.usd, "USD")}</span>
      )}
      <span className="block mt-1.5 text-[15.5px] leading-snug">
        {cardAlias}, el {shortDate(next.date)}{next.estimated ? " (fecha estimada)" : ""}.
        {after && ` Después, ${after.alias} el ${shortDate(after.date)}.`}
      </span>
    </Link>
  );
}

export default function TarjetasPage() {
  useAmountsHidden();  // repinta la pantalla al ocultar/mostrar montos
  const router = useRouter();
  const reaccionar = useReaccion();
  const { count: pendingStatements } = usePendingStatements();
  const [cards, setCards] = useState<Card[]>([]);
  const [nextDue, setNextDue] = useState<Record<number, NextDue>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [deleteCard, setDeleteCard] = useState<Card | null>(null);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortField, setSortField] = useState<"titular" | "bank" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showCustomFilter, setShowCustomFilter] = useState(false);
  const [filterTitular, setFilterTitular] = useState("");
  const [filterBank, setFilterBank] = useState("");

  const load = useCallback(async () => {
    setFailed(false);
    let list: Card[];
    try {
      list = (await api.get<Card[]>("/credit-cards")).data;
    } catch {
      setFailed(true);
      setLoading(false);
      return;
    }
    setCards(list);
    // Si falla el resumen de una tarjeta, esa fila queda sin cifra: la lista sirve igual.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const results = await Promise.allSettled(
      list.map((c) => api.get<StatementLite[]>(`/credit-cards/${c.id}/statements`)),
    );
    const byCard: Record<number, NextDue> = {};
    results.forEach((r, i) => {
      const next = r.status === "fulfilled" ? nextDueOf(r.value.data, today) : undefined;
      if (next) byCard[list[i].id] = next;
    });
    setNextDue(byCard);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    api.get("/auth/members").then((res) => setMembers(res.data)).catch(() => {});
  }, [load]);

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
    reaccionar("guardado", editCard ? "Tarjeta guardada" : "Tarjeta creada");
    setShowModal(false);
    setEditCard(null);
    await load();
  };

  const handleDelete = async (keepExpenses: boolean) => {
    if (!deleteCard) return;
    await api.delete(`/credit-cards/${deleteCard.id}?keep_expenses=${keepExpenses}`);
    reaccionar("borrado", "Tarjeta eliminada");
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

  // Los vencimientos por delante, de todas las tarjetas: el primero es la cifra del bloque.
  const upcoming = cards
    .filter((c) => nextDue[c.id])
    .sort((a, b) => nextDue[a.id].date.localeCompare(nextDue[b.id].date));
  const first = upcoming[0];
  const second = upcoming[1];

  const { pending } = usePendingStatements();
  const steps = useMemo(() => tourSteps(!!first, pending.length > 0), [first, pending.length]);

  const openNew = () => { setEditCard(null); setShowModal(true); };

  // Sobre el violeta, los botones son de vidrio; sobre el papel, los de siempre.
  const actions = (onColor: boolean) => (
    <div className="flex items-center gap-1.5 shrink-0">
      {features.reconcile && (
        <div data-tour="cards-upload">
          <UploadStatementButton href="/tarjetas/resumenes" pulse={pendingStatements > 0} onColor={onColor} />
        </div>
      )}
      <Button data-tour="cards-new" onClick={openNew} aria-label="Nueva tarjeta"
        className={`w-11 h-11 p-0 sm:w-auto sm:px-4 ${onColor ? "bg-white text-[#2A2178]" : ""}`}>
        <Plus className="w-[18px] h-[18px] shrink-0" />
        <span className="hidden sm:inline">Nueva tarjeta</span>
      </Button>
    </div>
  );
  const title = "text-[26px] md:text-3xl font-display font-medium leading-tight tracking-[-0.035em] min-w-0";

  // El bloque violeta va sólo si hay una cifra que lo justifique. Mientras carga
  // se reserva, para que la lista no salte cuando llega.
  const showBlock = loading || !!first;

  return (
    <div className="space-y-4 md:space-y-6">
      {!loading && cards.length > 0 && <ProductTour tourId="cards-intro" steps={steps} />}

      {showBlock ? (
        <section className={FIELD_BLOCK}>
          <div className="flex items-center justify-between gap-2">
            <h2 className={title}>Tarjetas de crédito</h2>
            {actions(true)}
          </div>
          {first ? (
            <NextDueFigure cardAlias={first.alias} cardId={first.id} next={nextDue[first.id]}
              after={second ? { alias: second.alias, date: nextDue[second.id].date } : undefined} />
          ) : (
            <div className="mt-3.5 animate-pulse" aria-busy="true">
              <div className="h-4 w-40 rounded-full bg-white/20" />
              <div className="mt-2.5 h-11 w-56 rounded-2xl bg-white/20" />
              <div className="mt-2.5 h-4 w-48 rounded-full bg-white/20" />
              <span className="sr-only">Cargando tus tarjetas</span>
            </div>
          )}
        </section>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <h2 className={`${title} text-foreground`}>Tarjetas de crédito</h2>
          {actions(false)}
        </div>
      )}

      {features.reconcile && <PendingStatementsCard />}

      {failed ? (
        <div className="px-2 py-4">
          <p className="text-[19px] font-medium tracking-[-0.02em] text-foreground">No pudimos traer tus tarjetas.</p>
          <p className="mt-1 text-[15px] text-muted-foreground">Tus datos están bien. Fijate si tenés conexión y probá de nuevo.</p>
          <Button className="mt-3 h-11" onClick={() => { setLoading(true); load(); }}>Probar de nuevo</Button>
        </div>
      ) : loading ? null : cards.length === 0 ? (
        <div className="px-2 py-6 text-center">
          <CreditCard className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-[19px] font-medium tracking-[-0.02em] text-foreground">Todavía no cargaste ninguna tarjeta.</p>
          <p className="mt-1 text-[15px] text-muted-foreground">Cargala para ver cuánto vence y cuándo, mes a mes.</p>
          <Button className="mt-4 h-11" onClick={openNew}>Crear una tarjeta</Button>
        </div>
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
            <p className="px-2 py-6 text-[15px] text-muted-foreground">Ninguna tarjeta coincide con la búsqueda o los filtros.</p>
          ) : (
            <MotionList as="section" data-tour="cards-list" className="px-2">
              {visibleCards.map((card) => (
                <CreditCardVisual
                  key={card.id}
                  card={card}
                  next={nextDue[card.id]}
                  onClick={() => router.push(`/tarjetas/${card.id}`)}
                  onEdit={() => { setEditCard(card); setShowModal(true); }}
                  onDelete={() => setDeleteCard(card)}
                />
              ))}
            </MotionList>
          )}
        </>
      )}

      {showModal && (
        <CardModal initial={editCard || undefined} members={members} onSave={handleSave} onClose={() => { setShowModal(false); setEditCard(null); }} />
      )}
      {deleteCard && (
        <DeleteChoiceSheet
          title="Eliminar tarjeta"
          intro={<>Se eliminan <strong className="font-semibold">{deleteCard.alias} ({deleteCard.bank})</strong> y todos sus resúmenes. ¿Qué pasa con los gastos que ya figuran en Egresos?</>}
          keep="Siguen en Egresos, ya sin la tarjeta asociada."
          remove="Se borran de Egresos todos los gastos de esta tarjeta. No se puede deshacer."
          confirmLabel="Eliminar tarjeta"
          onConfirm={handleDelete}
          onClose={() => setDeleteCard(null)}
        />
      )}
    </div>
  );
}

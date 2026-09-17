"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { getErrorMessage, pickCategoryColor } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldLabel, SegmentedToggle } from "@/components/ui/form";
import NewCategoryModal from "@/components/NewCategoryModal";
import { ParticipantPicker, type PickedParticipant } from "@/components/ParticipantPicker";
import BaseFields, { type CategoryOption } from "./BaseFields";
import CardPaymentSection, { type CardsState } from "./CardPaymentSection";
import SplitSection from "./SplitSection";
import {
  buildRequest, isCard, isInstallment, newDraft, periodLabel, validateDraft,
  type CreditCardLite, type ExpenseDraft, type SplitRow,
} from "./submit";

export type ExpenseSaved =
  | { kind: "simple" }
  | { kind: "card"; card_id: number; statement_id: number; cardName: string; periodName: string; shared: boolean }
  | { kind: "shared"; people: number };

/**
 * Un solo formulario para cualquier egreso: simple, con tarjeta, compartido, o
 * con tarjeta y compartido.
 *
 * Es un solo formulario y no un menú que pregunte el tipo primero porque "con
 * tarjeta" y "compartido" no son excluyentes: un menú de tres opciones no puede
 * representar el gasto de tarjeta compartido sin inventar una cuarta, y además
 * le suma un toque al caso más común, que es el simple. Las dos preguntas van
 * abajo y arrancan en "Efectivo" / "No": un egreso simple se carga igual que
 * antes.
 *
 * Lo usan el `+` del dashboard (vía `/expenses?nuevo=1`) y el `+` de Egresos.
 * Los formularios de `/shared` y del resumen de tarjeta siguen siendo los suyos
 * por decisión del usuario.
 *
 * En edición sólo se muestran los campos base: convertir un egreso ya guardado
 * en uno de tarjeta o compartido no está soportado.
 */
export default function ExpenseFormModal({
  mode, initial, editId, categories, onCategoriesChanged, onSaved, onClose,
}: {
  mode: "create" | "edit";
  initial?: ExpenseDraft;
  editId?: number;
  categories: CategoryOption[];
  onCategoriesChanged: () => Promise<void>;
  onSaved: (result: ExpenseSaved) => void;
  onClose: () => void;
}) {
  useAmountsHidden();
  const { appUser } = useAuth();

  const selfRow = useCallback((): SplitRow | null => appUser
    ? { type: "self", user_id: appUser.id, member_name: appUser.display_name || appUser.email, contact: "", amount: "" }
    : null, [appUser]);

  const [draft, setDraft] = useState<ExpenseDraft>(
    () => initial ?? newDraft(format(new Date(), "yyyy-MM-dd"), selfRow()),
  );
  const [cardsState, setCardsState] = useState<CardsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [picker, setPicker] = useState<{ open: boolean; idx: number | null }>({ open: false, idx: null });

  // Todo cambio pasa por acá, para que las reglas que dependen de más de un
  // campo se apliquen siempre y no según qué control se tocó primero.
  const set = useCallback((patch: Partial<ExpenseDraft>) => {
    setError(null);
    setDraft(prev => {
      const next = { ...prev, ...patch };
      // El mes del resumen sigue a la fecha del gasto hasta que la persona lo
      // toca: después manda lo que eligió.
      if (!next.periodTouched && /^\d{4}-\d{2}-\d{2}$/.test(next.expense_date)) {
        next.period = next.expense_date.slice(0, 7);
      }
      // En dólares no hay cuotas: vuelve solo a un pago.
      if (next.currency === "USD" && next.plan === "installment") next.plan = "single";
      return next;
    });
  }, []);

  // La fila "Vos" necesita al usuario, que puede llegar después del primer render.
  useEffect(() => {
    const self = selfRow();
    if (self && draft.rows.length === 0 && mode === "create") set({ rows: [self] });
  }, [selfRow, draft.rows.length, mode, set]);

  const loadCards = useCallback(async () => {
    setCardsState({ status: "loading" });
    try {
      const { data } = await api.get<CreditCardLite[]>("/credit-cards");
      setCardsState({ status: "ready", cards: data });
      // Con una sola tarjeta no hay nada que elegir.
      if (data.length === 1) setDraft(prev => (prev.card_id ? prev : { ...prev, card_id: String(data[0].id) }));
    } catch {
      setCardsState({ status: "error" });
    }
  }, []);

  // Las tarjetas se piden recién la primera vez que alguien elige "Tarjeta":
  // un egreso simple no hace ningún request de más.
  useEffect(() => {
    if (draft.pay === "card" && cardsState === null) loadCards();
  }, [draft.pay, cardsState, loadCards]);

  const cards = cardsState?.status === "ready" ? cardsState.cards : null;

  const applyPick = (idx: number | null, picked: PickedParticipant) => {
    const row: SplitRow =
      picked.kind === "member" || picked.kind === "user"
        ? { type: "member", user_id: picked.user_id, member_name: picked.member_name, contact: "", amount: "" }
        : picked.kind === "invite"
          ? { type: "external", user_id: null, member_name: picked.member_name, contact: picked.contact, amount: "" }
          : { type: "external", user_id: null, member_name: picked.member_name, contact: "", amount: "" };
    set({
      rows: idx === null
        ? [...draft.rows, row]
        : draft.rows.map((r, i) => (i === idx ? { ...row, amount: r.amount } : r)),
    });
    setPicker({ open: false, idx: null });
  };

  const handleAddCat = async (cat: { name: string; color: string; is_fixed: boolean }) => {
    const { data } = await api.post("/expenses/categories", cat);
    setShowCatForm(false);
    await onCategoriesChanged();
    set({ category_id: String(data.id) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const problem = validateDraft(draft, { mode, cards });
    if (problem) { setError(problem); return; }

    const req = buildRequest(draft, mode, editId);
    setSaving(true);
    setError(null);
    try {
      const { data } = await api[req.method](req.url, req.body);
      if (req.kind === "card") {
        const card = cards?.find(c => String(c.id) === draft.card_id);
        onSaved({
          kind: "card",
          card_id: Number(draft.card_id),
          statement_id: data.statement_id,
          cardName: card ? card.alias : "tu tarjeta",
          periodName: periodLabel(draft.period),
          shared: draft.shared,
        });
      } else if (req.kind === "shared") {
        onSaved({ kind: "shared", people: draft.rows.length - 1 });
      } else {
        onSaved({ kind: "simple" });
      }
    } catch (err) {
      // No se cierra ni se pierde lo cargado: el backend guarda todo o nada,
      // así que un error acá significa que no quedó nada guardado.
      setError(getErrorMessage(err, "No se pudo guardar el egreso."));
    } finally {
      setSaving(false);
    }
  };

  const create = mode === "create";
  const blockedByCards = create && isCard(draft) && (!cards || cards.length === 0);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
        <Card className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 max-h-[92vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">{create ? "Nuevo egreso" : "Editar egreso"}</h3>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form noValidate onSubmit={handleSubmit} className="space-y-3">
            <BaseFields
              draft={draft}
              set={set}
              categories={categories}
              onNewCategory={() => setShowCatForm(true)}
              hideCategory={create && isCard(draft) && draft.currency === "USD"}
              amountLabel={create && isInstallment(draft) ? "Monto por cuota" : "Monto"}
              descriptionRequired={create && (isCard(draft) || draft.shared)}
            />

            {create && (
              <>
                <div className="space-y-2 pt-1">
                  <FieldLabel>Pago</FieldLabel>
                  <SegmentedToggle
                    ariaLabel="Pago"
                    value={draft.pay}
                    onChange={pay => set({ pay })}
                    options={[
                      { value: "cash", label: "Efectivo o débito" },
                      { value: "card", label: "Tarjeta" },
                    ]}
                  />
                  {isCard(draft) && cardsState && (
                    <CardPaymentSection draft={draft} set={set} cardsState={cardsState} onRetry={loadCards} />
                  )}
                </div>

                <div className="space-y-2">
                  <FieldLabel>¿Lo compartís?</FieldLabel>
                  <SegmentedToggle
                    ariaLabel="¿Lo compartís?"
                    value={draft.shared ? "yes" : "no"}
                    onChange={v => set({ shared: v === "yes" })}
                    options={[
                      { value: "no", label: "No" },
                      { value: "yes", label: "Sí" },
                    ]}
                  />
                  {draft.shared && (
                    <SplitSection draft={draft} set={set} onPick={idx => setPicker({ open: true, idx })} />
                  )}
                </div>
              </>
            )}

            {error && (
              <p role="alert" className="text-xs text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={saving || blockedByCards}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </form>

          {/* Fuera del <form>: el buscador del picker no frena el Enter, y
              adentro del form guardaría el egreso a mitad de elegir. */}
          <ParticipantPicker
            open={picker.open}
            onClose={() => setPicker({ open: false, idx: null })}
            onPick={p => applyPick(picker.idx, p)}
            excludeUserIds={draft.rows.map(r => r.user_id).filter((id): id is number => id !== null)}
          />
        </Card>
      </div>

      {/* Fuera del fondo del modal: si quedara adentro, tocar el fondo de este
          sub-modal subiría hasta el fondo del formulario y lo cerraría entero. */}
      {showCatForm && (
        <NewCategoryModal
          initialColor={pickCategoryColor(categories.map(c => c.color))}
          onSave={handleAddCat}
          onClose={() => setShowCatForm(false)}
        />
      )}
    </>
  );
}


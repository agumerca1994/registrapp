"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Check, Undo2 } from "lucide-react";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD, parseAmount, pickCategoryColor } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyToggle, DateField, FIELD, FieldLabel } from "@/components/ui/form";
import CategoryChips, { type CategoryLite } from "@/components/CategoryChips";
import NewCategoryModal from "@/components/NewCategoryModal";

/**
 * Alta rápida: un gasto en un paso.
 *
 * Es el destino de todos los canales de carga —el long-press del ícono, la hoja
 * de compartir de Android, el Atajo de iOS, el deep link del bot— y también
 * funciona sola, que es lo que la hace la pieza más valiosa: no depende de
 * ninguna capacidad de plataforma.
 *
 * El orden de los campos es el argumento entero de la pantalla. **Monto
 * primero, literalmente**: es lo único obligatorio que la app no puede adivinar
 * y es lo que la persona tiene en la cabeza recién salida de pagar. La
 * categoría son chips y no un listbox porque es el campo que más toques
 * costaba y el único donde el historial ya sabe la respuesta probable. La fecha
 * arranca en hoy y colapsada, porque casi nunca hay que tocarla.
 *
 * Lo que esta pantalla deliberadamente NO tiene: `notes`. Para eso está el
 * formulario completo de `/expenses`, que sigue existiendo y cubre el caso
 * "estoy sentado con la lista abierta".
 */

const SOURCE_WHITELIST = new Set(["quick", "share_target", "shortcut"]);

interface SavedEntry {
  id: number;
  amount: number;
  currency: "ARS" | "USD";
  categoryName: string;
  description: string;
  date: string;
}

interface Suggestion {
  category_id: number;
  category_name: string;
  score: number;
  matched_description: string;
}

function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}

/** Una fecha del querystring sólo se acepta en ISO y si existe de verdad. */
function sanitizeDate(raw: string | null): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return todayISO();
  const d = parseISO(raw);
  return isValid(d) ? raw : todayISO();
}

function RegistrarForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Suscribe la pantalla al provider de privacidad. Sin esta línea los importes
  // que pinta más abajo no se enmascaran nunca: las pantallas llegan como
  // `children` del provider y React no las re-renderiza cuando su estado
  // cambia. Ojo: enmascara la confirmación, NO el input de monto — ese es lo
  // que la persona está tipeando y taparlo lo haría imposible de escribir.
  useAmountsHidden();

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [description, setDescription] = useState("");

  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const [showDate, setShowDate] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedEntry | null>(null);
  const [undoing, setUndoing] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  // De qué canal vino, para la columna `source`. Se congela al montar: si el
  // usuario carga otro gasto sin recargar, el segundo ya no vino de la hoja de
  // compartir.
  const sourceRef = useRef<string>("quick");

  // ── Prellenado por querystring ─────────────────────────────────────────────
  useEffect(() => {
    const src = params.get("source");
    if (src && SOURCE_WHITELIST.has(src)) sourceRef.current = src;

    const cur = params.get("currency");
    if (cur === "USD" || cur === "ARS") setCurrency(cur);

    const amt = params.get("amount");
    // Se guarda el texto crudo y lo interpreta `parseAmount` al enviar, igual
    // que si lo hubiera tipeado una persona: es el único parser de montos
    // argentinos del frontend y duplicar su criterio acá es cómo empiezan a
    // discrepar.
    if (amt) setAmount(amt);

    setExpenseDate(sanitizeDate(params.get("date")));

    const desc = params.get("description");
    if (desc) setDescription(desc.slice(0, 255));
    // Sólo al montar: después manda lo que toca el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Categorías + más usadas ────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    const [all, recent] = await Promise.all([
      api.get("/expenses/categories"),
      api.get("/expenses/categories/recent", { params: { limit: 8 } }),
    ]);
    setCategories(all.data);
    setRecentIds((recent.data as { id: number }[]).map(c => c.id));
    return all.data as CategoryLite[];
  }, []);

  useEffect(() => {
    loadCategories()
      .catch(() => setError("No pudimos cargar las categorías."))
      .finally(() => setCatsLoading(false));
  }, [loadCategories]);

  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  // ── Sugerencia de categoría ────────────────────────────────────────────────
  // Se dispara on-blur de la descripción y cuando la descripción llega
  // prellenada, NUNCA por tecleo: colgada del onChange convierte una consulta
  // por gasto en una por letra, y ninguna caché arregla eso.
  const askSuggestion = useCallback(async (desc: string) => {
    const q = desc.trim();
    if (q.length < 3) { setSuggestion(null); return; }
    try {
      const { data } = await api.get("/expenses/categories/suggest", {
        params: { description: q },
      });
      if (!data) { setSuggestion(null); return; }
      setSuggestion(data);
      // Preseleccionar sólo si el usuario todavía no eligió: pisarle la
      // elección con una adivinanza es peor que no sugerir.
      setCategoryId(prev => (prev ? prev : String(data.category_id)));
    } catch {
      setSuggestion(null);  // una sugerencia que falla no es un error de la pantalla
    }
  }, []);

  useEffect(() => {
    const prefilled = params.get("description");
    if (prefilled) askSuggestion(prefilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = parseAmount(amount);
    if (!value || value <= 0) {
      setError("Poné un monto mayor a cero.");
      amountRef.current?.focus();
      return;
    }
    if (currency === "ARS" && !categoryId) {
      setError("Elegí una categoría.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/expenses/entries", {
        category_id: categoryId ? Number(categoryId) : null,
        amount: value,
        description: description.trim() || null,
        expense_date: expenseDate,
        currency,
        source: sourceRef.current,
      });
      setSaved({
        id: data.id,
        amount: Number(data.amount),
        currency: (data.currency ?? currency) as "ARS" | "USD",
        categoryName: data.category?.name ?? "",
        description: data.description ?? "",
        date: data.expense_date,
      });
    } catch {
      setError("No pudimos guardar el gasto. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async () => {
    if (!saved) return;
    setUndoing(true);
    try {
      await api.delete(`/expenses/entries/${saved.id}`);
      setSaved(null);          // vuelve al formulario con los valores puestos
      setTimeout(() => amountRef.current?.focus(), 0);
    } catch {
      setError("No pudimos deshacer. Buscalo en Egresos.");
    } finally {
      setUndoing(false);
    }
  };

  const handleAgain = () => {
    setSaved(null);
    setAmount("");
    setDescription("");
    setSuggestion(null);
    setCategoryId("");
    setExpenseDate(todayISO());
    sourceRef.current = "quick";
    setTimeout(() => amountRef.current?.focus(), 0);
  };

  const handleAddCat = async (cat: { name: string; color: string; is_fixed: boolean }) => {
    const { data } = await api.post("/expenses/categories", cat);
    setShowCatForm(false);
    await loadCategories();
    setCategoryId(String(data.id));
  };

  // ── Confirmación ───────────────────────────────────────────────────────────
  // No se navega a /expenses: eso es devolver a la persona a la app llena de
  // opciones justo después de haberla evitado. Y no se auto-limpia en silencio,
  // porque un formulario que se vacía solo miente sobre si guardó.
  if (saved) {
    const money = saved.currency === "USD" ? formatUSD(saved.amount) : formatARS(saved.amount);
    return (
      <div className="max-w-md mx-auto space-y-4">
        <Card className="space-y-4 text-center">
          <div className="mx-auto w-12 h-12 rounded-full border-2 border-ink bg-emerald-50 flex items-center justify-center shadow-chip">
            <Check className="w-6 h-6 text-emerald-700" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground tabular-nums">{money}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {[saved.categoryName, saved.description].filter(Boolean).join(" · ")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 first-letter:uppercase">
              {format(parseISO(saved.date), "EEEE d 'de' MMMM", { locale: es })}
            </p>
          </div>
          <div className="flex gap-2 justify-center pt-1">
            {/* Deshacer es lo que hace seguro un flujo de un toque. Sin esto el
                precio de equivocarse es abrir otra pantalla y buscar la fila. */}
            <Button type="button" variant="outline" onClick={handleUndo} disabled={undoing}>
              <Undo2 className="w-4 h-4" />
              {undoing ? "Deshaciendo..." : "Deshacer"}
            </Button>
            <Button type="button" onClick={handleAgain}>Registrar otro</Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </Card>
        <button type="button" onClick={() => router.push("/expenses")}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2">
          Ver todos los egresos
        </button>
      </div>
    );
  }

  const dateLabel = expenseDate === todayISO()
    ? "Hoy"
    : format(parseISO(expenseDate), "d 'de' MMMM", { locale: es });

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-lg font-semibold text-foreground mb-3">Registrar gasto</h1>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Monto. Grande y con el foco puesto: es la respuesta que la
              persona ya tiene y el resto de la pantalla puede esperar. */}
          <div>
            <FieldLabel>Monto</FieldLabel>
            <input
              ref={amountRef}
              type="text" inputMode="decimal" pattern="[0-9.,]*"
              placeholder="0,00"
              aria-label="Monto"
              className={`${FIELD} text-3xl font-bold text-center py-3 tabular-nums`}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
            />
          </div>

          {/* 2. Moneda: es del gasto entero, por eso va arriba y no como
              sufijo de un campo. */}
          <CurrencyToggle value={currency} onChange={setCurrency} />

          {/* 3. Categoría. */}
          <div>
            <FieldLabel hint={currency === "USD" ? "(opcional)" : undefined}>Categoría</FieldLabel>
            <div className="mt-1.5">
              <CategoryChips
                value={categoryId}
                onChange={setCategoryId}
                categories={categories}
                recentIds={recentIds}
                suggestedId={suggestion?.category_id ?? null}
                suggestedFrom={suggestion?.matched_description ?? null}
                onCreateNew={() => setShowCatForm(true)}
                loading={catsLoading}
              />
            </div>
            {currency === "USD" && !categoryId && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Sin categoría va a «Consumo en dólares».
              </p>
            )}
          </div>

          {/* 4. Fecha: colapsada, porque la respuesta es hoy casi siempre. */}
          <div>
            <FieldLabel>Fecha</FieldLabel>
            {showDate ? (
              <DateField required value={expenseDate} onChange={v => setExpenseDate(v || todayISO())} />
            ) : (
              <button type="button" onClick={() => setShowDate(true)}
                className="mt-1 flex items-center gap-2 text-sm text-foreground hover:text-primary">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                <span>{dateLabel}</span>
                <span className="text-xs text-muted-foreground underline">cambiar</span>
              </button>
            )}
          </div>

          {/* 5. Descripción: opcional, y lo que alimenta la sugerencia. */}
          <div>
            <FieldLabel hint="(opcional)">Descripción</FieldLabel>
            <input
              className={FIELD}
              placeholder="Dónde fue"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={e => askSuggestion(e.target.value)}
              maxLength={255}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button type="submit" className="w-full py-3" disabled={saving}>
            {saving ? "Guardando..." : "Guardar gasto"}
          </Button>
        </form>
      </Card>

      {showCatForm && (
        <NewCategoryModal
          initialColor={pickCategoryColor(categories.map(c => c.color))}
          onSave={handleAddCat}
          onClose={() => setShowCatForm(false)}
        />
      )}
    </div>
  );
}

export default function RegistrarPage() {
  // `useSearchParams` obliga a un límite de Suspense: sin esto el build de Next
  // falla al prerenderizar la ruta.
  return (
    <Suspense fallback={null}>
      <RegistrarForm />
    </Suspense>
  );
}

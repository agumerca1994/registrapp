"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Check, Undo2 } from "lucide-react";
import api from "@/lib/api";
import { useAmountsHidden } from "@/contexts/PrivacyContext";
import { formatARS, formatUSD, parseAmount, pickCategoryColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useReaccion } from "@/components/brand/ToodReaccion";
import { CurrencyToggle, DateField, FIELD, FieldLabel } from "@/components/ui/form";
import { AmountField } from "@/components/movimientos/FormSheet";
import CategoryChips, { type CategoryLite } from "@/components/CategoryChips";
import NewCategoryModal from "@/components/NewCategoryModal";
import { takeSharedPayload } from "@/lib/pending-draft";

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

  const [sharedNote, setSharedNote] = useState<string | null>(null);
  const [showDate, setShowDate] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedEntry | null>(null);
  const [undoing, setUndoing] = useState(false);
  const reaccionar = useReaccion();

  const amountRef = useRef<HTMLInputElement>(null);
  const focusAmount = () => amountRef.current?.focus();
  // De qué canal vino, para la columna `source`. Se congela al montar: si el
  // usuario carga otro gasto sin recargar, el segundo ya no vino de la hoja de
  // compartir.
  const sourceRef = useRef<string>("quick");
  // Guarda de una sola ejecución para el efecto que consume lo compartido.
  // Ver el comentario largo abajo: no es paranoia, es un bug que se comió un
  // comprobante entero.
  const sharedHandled = useRef(false);

  // ── Prellenado por querystring ─────────────────────────────────────────────
  useEffect(() => {
    const src = params.get("source");
    if (src && SOURCE_WHITELIST.has(src)) sourceRef.current = src;
    // La hoja de compartir de Android no manda `source` —el manifest sólo
    // puede declarar title/text/url—, así que se infiere de su presencia.
    else if (params.get("text") || params.get("title") || params.get("url")) {
      sourceRef.current = "share_target";
    }

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
    focusAmount();
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

  // ── Lo que llegó por la hoja de compartir ──────────────────────────────────
  // La app ya no lee comprobantes, pero la hoja de compartir de Android y el
  // Atajo de iOS siguen trayendo gente acá con uno. Dos cosas se siguen haciendo:
  //
  // - **Consumir el payload de IndexedDB.** El service worker lo sigue dejando
  //   ahí; si nadie lo lee, queda colgado hasta que vence y ocupa espacio sin
  //   motivo.
  // - **Decir que hay que cargarlo a mano.** Un formulario vacío después de
  //   compartir se lee como que la app ignoró lo que mandaste.
  //
  // Corre una sola vez (el `ref`) porque `takeSharedPayload` es destructiva: con
  // StrictMode una primera pasada que consume y se descarta dejaba a la segunda
  // sin nada. Ya no se pierde un dato por eso, pero sí se perdería el aviso.
  useEffect(() => {
    if (sharedHandled.current) return;
    sharedHandled.current = true;

    (async () => {
      const payload = await takeSharedPayload();
      const fromShareSheet = !!payload && (payload.files.length > 0 || !!payload.text || !!payload.title);
      const fromQuery = ["title", "text", "url"].some(k => params.get(k));
      const lost = params.get("shared") === "lost";

      if (fromShareSheet) sourceRef.current = "share_target";
      if (fromShareSheet || fromQuery || lost) {
        setSharedNote("Llegaste desde un comprobante. Completá los datos a mano.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = parseAmount(amount);
    if (!value || value <= 0) {
      setError("Poné un monto mayor a cero.");
      focusAmount();
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
      reaccionar("borrado", "Gasto deshecho");
      setSaved(null);          // vuelve al formulario con los valores puestos
      setTimeout(focusAmount, 0);
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
    setSharedNote(null);
    setCategoryId("");
    setExpenseDate(todayISO());
    sourceRef.current = "quick";
    setTimeout(focusAmount, 0);
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
    const what = [saved.categoryName, saved.description].filter((v, i, all) => v && all.indexOf(v) === i).join(" · ");
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="px-1.5">
          <p className="inline-flex items-center gap-1.5 text-[15px] font-medium text-[#3B2FB3]">
            <Check className="w-[18px] h-[18px]" strokeWidth={2.5} /> Gasto guardado
          </p>
          <p className="mt-3 text-[44px] font-medium leading-[1.1] tracking-[-0.04em] tabular-nums text-foreground break-words">{money}</p>
          {what && <p className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{what}</p>}
          <p className="mt-1 text-[15px] text-muted-foreground first-letter:uppercase">
            {format(parseISO(saved.date), "EEEE d 'de' MMMM", { locale: es })}
          </p>
        </div>
        <div className="mt-6 flex items-center gap-2">
          {/* Deshacer es lo que hace seguro un flujo de un toque. Sin esto el
              precio de equivocarse es abrir otra pantalla y buscar la fila. */}
          <Button type="button" variant="outline" onClick={handleUndo} disabled={undoing} className="h-[52px] text-[15px] px-5">
            <Undo2 className="w-4 h-4" />
            {undoing ? "Deshaciendo…" : "Deshacer"}
          </Button>
          <Button type="button" onClick={handleAgain} className="flex-1 h-[52px] text-[15.5px]">Registrar otro</Button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
        <button type="button" onClick={() => router.push("/expenses")}
          className="mt-2 w-full min-h-[44px] text-center text-sm font-medium text-muted-foreground hover:text-foreground">
          Ver todos los egresos
        </button>
      </div>
    );
  }

  const dateLabel = expenseDate === todayISO()
    ? "Hoy"
    : format(parseISO(expenseDate), "d 'de' MMMM", { locale: es });

  return (
    <div className="max-w-md mx-auto space-y-3.5">
      <h1 className="text-[26px] md:text-3xl font-display font-medium tracking-[-0.035em] text-foreground">Registrar gasto</h1>

      {sharedNote && (
        <p className="text-sm leading-snug text-foreground bg-accent border border-[#CFC9E4] rounded-[22px] px-3.5 py-2.5">
          {sharedNote}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 1. Monto. Grande y con el foco puesto: es la respuesta que la
            persona ya tiene y el resto de la pantalla puede esperar. La moneda
            va al lado porque es del gasto entero, no un sufijo del campo. */}
        <div>
          <AmountField
            inputRef={amountRef}
            label="Monto"
            currency={currency}
            toggle={<CurrencyToggle className="w-[132px]" value={currency} onChange={setCurrency} />}
            placeholder="0,00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
          />
        </div>

        {/* 2. Categoría. */}
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
            <p className="text-xs text-muted-foreground mt-1.5">
              Sin categoría va a «Consumo en dólares».
            </p>
          )}
        </div>

        {/* 3. Fecha: colapsada, porque la respuesta es hoy casi siempre. */}
        <div>
          <FieldLabel>Fecha</FieldLabel>
          {showDate ? (
            <DateField required value={expenseDate} onChange={v => setExpenseDate(v || todayISO())} />
          ) : (
            <button type="button" onClick={() => setShowDate(true)}
              className="min-h-[44px] flex items-center gap-2 text-[15px] font-medium text-foreground">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <span>{dateLabel}</span>
              <span className="text-sm font-normal text-muted-foreground underline underline-offset-2">cambiar</span>
            </button>
          )}
        </div>

        {/* 4. Descripción: opcional, y lo que alimenta la sugerencia. */}
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

        {error && <p role="alert" className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}

        <Button type="submit" className="w-full h-[52px] text-[15.5px]" disabled={saving}>
          {saving ? "Guardando…" : "Guardar gasto"}
        </Button>
      </form>

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

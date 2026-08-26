"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/chip";
import { ChoiceChips, type ChoiceOption } from "@/components/ui/choice-chips";
import { SelectField } from "@/components/ui/form";

export interface CategoryLite {
  id: number;
  name: string;
  color?: string | null;
}

/**
 * Las categorías del hogar como chips: reconocer la de siempre de un toque.
 *
 * Es el campo que más toques costaba en el alta de un gasto — un listbox que
 * hay que abrir, recorrer y cerrar — y el único donde la app ya sabe la
 * respuesta probable. Por eso acá se invierte: primero las que se usan, y el
 * selector completo detrás de "Ver todas".
 *
 * Dos reglas que no hay que romper:
 *
 * - **"Ver todas" siempre está.** Es lo que hace legítimo reemplazar el
 *   `SelectField` por chips (ver `ui/choice-chips.tsx`). Sin esa puerta, una
 *   categoría fuera de las más usadas queda inalcanzable.
 * - **Una sugerencia se muestra elegida, nunca se guarda sola.** Cuando llega
 *   `suggestedId`, ese chip va primero y con el rótulo "sugerida" al lado, así
 *   que lo que se va a guardar está a la vista antes de apretar nada. Una
 *   sugerencia invisible que se guarda es peor que no sugerir.
 */
export default function CategoryChips({
  value, onChange, categories, recentIds, suggestedId, suggestedFrom,
  onCreateNew, limit = 8, disabled = false, loading = false,
}: {
  value: string;
  onChange: (value: string) => void;
  categories: CategoryLite[];
  /** Ids en orden de uso, de `GET /expenses/categories/recent`. */
  recentIds: number[];
  suggestedId?: number | null;
  /** La descripción histórica que produjo la sugerencia, para poder auditarla. */
  suggestedFrom?: string | null;
  onCreateNew?: () => void;
  limit?: number;
  disabled?: boolean;
  /** Mientras las categorías viajan. Ver el porqué en el estado vacío. */
  loading?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const byId = new Map(categories.map(c => [c.id, c]));

  // Orden: la sugerida primero, después las más usadas, y la que ya está
  // elegida siempre presente aunque no entre en el top — si no, elegir una
  // categoría rara desde "Ver todas" la haría desaparecer de la fila y la
  // pantalla se vería como que perdió el dato.
  const ordered: number[] = [];
  const push = (id: number | null | undefined) => {
    if (id != null && byId.has(id) && !ordered.includes(id)) ordered.push(id);
  };
  push(suggestedId);
  if (value) push(Number(value));
  recentIds.forEach(push);
  categories.forEach(c => push(c.id));

  const options: ChoiceOption[] = ordered.slice(0, limit).map(id => {
    const c = byId.get(id)!;
    return { value: String(id), label: c.name, dot: c.color };
  });

  const suggestedName = suggestedId != null ? byId.get(suggestedId)?.name : undefined;
  const showSuggestionNote =
    suggestedId != null && value === String(suggestedId) && !!suggestedName;

  // Placeholder mientras cargan. Sin esta rama, "todavía no tenés categorías"
  // aparece en el primer frame de CADA carga —el estado arranca en []— así que
  // alguien con veinte categorías lee que no tiene ninguna antes de verlas. Un
  // mensaje vacío que parpadea es peor que un espacio en blanco: afirma algo
  // falso. Apareció como un test que a veces pasaba y a veces no.
  if (loading) {
    return <div className="h-9 rounded-lg bg-accent/40 animate-pulse" aria-hidden />;
  }

  // Un hogar recién creado no tiene ninguna categoría, y en ARS la categoría es
  // obligatoria: una fila de chips vacía ahí no es "no hay nada que mostrar",
  // es un callejón sin salida con dos botones sin explicar. El caso apareció al
  // probar la pantalla contra un hogar limpio.
  if (categories.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border px-3 py-4 text-center space-y-2">
        <p className="text-xs text-muted-foreground">
          Todavía no tenés categorías.
        </p>
        {onCreateNew && (
          <button type="button" onClick={onCreateNew} disabled={disabled}
            className="inline-flex items-center rounded-full border-2 border-ink bg-white px-3 py-1.5 text-xs font-medium shadow-chip hover:bg-accent">
            + Crear la primera
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ChoiceChips
        ariaLabel="Categoría"
        value={value}
        onChange={onChange}
        options={options}
        trailing={
          <>
            <button type="button" onClick={() => setShowAll(v => !v)} disabled={disabled}
              className="inline-flex shrink-0 items-center rounded-full border-2 border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap">
              {showAll ? "Ocultar lista" : "Ver todas"}
            </button>
            {onCreateNew && (
              <button type="button" onClick={onCreateNew} disabled={disabled}
                className="inline-flex shrink-0 items-center rounded-full border-2 border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap">
                + Nueva
              </button>
            )}
          </>
        }
      />

      {showSuggestionNote && (
        <div className="flex items-center gap-2 flex-wrap">
          <Chip locked className="text-[11px]">sugerida</Chip>
          {suggestedFrom && (
            <span className="text-[11px] text-muted-foreground truncate">
              porque se parece a «{suggestedFrom}»
            </span>
          )}
        </div>
      )}

      {showAll && (
        <SelectField
          value={value}
          onChange={v => { onChange(v); setShowAll(false); }}
          placeholder="Buscar en todas las categorías"
          options={categories.map(c => ({ value: String(c.id), label: c.name }))}
        />
      )}
    </div>
  );
}

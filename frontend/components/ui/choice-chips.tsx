"use client";

import { useRef } from "react";
import { Check } from "lucide-react";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn } from "@/lib/utils";

/**
 * Elegir una opción de un conjunto chico, de un solo toque.
 *
 * Esto NO es una vuelta atrás sobre la prohibición del `<select>` nativo. Esa
 * regla existe porque el `<select>` delega su lista al sistema operativo y ésa
 * es justo la parte que CSS no alcanza; un chip no delega nada. Son controles
 * distintos para trabajos distintos: el `Listbox` sirve para elegir entre
 * muchas opciones sabiendo cuál buscás, y los chips para reconocer la que ya
 * usás siempre sin abrir nada.
 *
 * La condición para que el reemplazo sea legítimo es `trailing`: quien lo use
 * tiene que dejar ahí una puerta al `SelectField` completo. Un conjunto chico
 * de chips SIN salida deja inalcanzable todo lo que no entró, y eso sí sería
 * peor que el control nativo.
 *
 * Teclado: es un `radiogroup` real con ←/→/Home/End, por la misma razón que lo
 * tiene el `Listbox` — reemplazar un control nativo no puede costarte el
 * teclado.
 */
export interface ChoiceOption {
  value: string;
  label: string;
  /** Color del puntito, para que el chip lea igual que la fila de la lista. */
  dot?: string | null;
}

export function ChoiceChips({
  value, onChange, options, trailing, ariaLabel, className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: ChoiceOption[];
  trailing?: React.ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    if (!options.length) return;
    const to = (from + delta + options.length) % options.length;
    onChange(options[to].value);
    refs.current[to]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": e.preventDefault(); move(i, 1); break;
      case "ArrowLeft": case "ArrowUp": e.preventDefault(); move(i, -1); break;
      case "Home": e.preventDefault(); move(0, 0); break;
      case "End": e.preventDefault(); move(options.length - 1, 0); break;
    }
  };

  // Un radiogroup sin nada seleccionado no tiene un tab stop natural, así que
  // el foco entra por el primero. Con algo elegido, entra por lo elegido.
  const focusIndex = Math.max(0, options.findIndex(o => o.value === value));

  return (
    <ScrollRow gap="gap-2" className={className}>
      <div role="radiogroup" aria-label={ariaLabel} className="flex gap-2">
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              ref={el => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={i === focusIndex ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={e => onKeyDown(e, i)}
              className={cn(
                // Mismo vocabulario que `Chip`: píldora, borde ink de 2px,
                // sombra chica. Y el estado elegido es el mismo violeta que el
                // ítem activo del Sidebar y el `Button` primary, para que
                // "seleccionado" se vea igual en toda la app.
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink",
                "px-3 py-1.5 text-xs font-medium shadow-chip whitespace-nowrap",
                "transition-transform active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-white text-foreground hover:bg-accent",
              )}
            >
              {selected ? (
                <Check className="w-3 h-3 shrink-0" />
              ) : o.dot ? (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.dot }} />
              ) : null}
              {o.label}
            </button>
          );
        })}
        {trailing}
      </div>
    </ScrollRow>
  );
}

"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { startOfMonth, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { CalendarPanel, isoDate } from "@/components/ui/calendar";
import {
  Listbox, PANEL, RequiredMirror, useAnchoredPanel, useDismiss, type SelectOption,
} from "@/components/ui/listbox";

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export type { SelectOption };

/**
 * Form fields, in the app's own clothes rather than the browser's.
 *
 * The house style is a 2px ink border — it's what buttons, chips and the hero
 * card are built from — so inputs use it too instead of the hairline default
 * that makes a form look like an unstyled page. Two native controls have to go
 * entirely, because the part of them that looks generic is the part CSS can't
 * reach:
 *
 * - `<select>` renders its option list as an OS menu. Styling the closed box
 *   isn't enough — opening it still drops a grey system list on top of the
 *   app. `SelectField` is a listbox instead: a button plus our own panel.
 * - `<input type="date">` shows `mm/dd/yyyy` and a browser calendar that looks
 *   nothing like the one in the filter bar. `DateField` opens the shared
 *   `CalendarPanel`, so picking a date is the same gesture everywhere.
 *
 * Both panels are portalled to `document.body` and positioned `fixed`. These
 * fields live inside modals that scroll and stack: in the flow a panel pushes
 * the form around, and absolutely positioned it gets clipped by the modal's
 * `overflow-y-auto`. Out of the tree they float above everything with no
 * z-index race.
 *
 * Use `FIELD` for plain inputs so every control in a form shares one geometry.
 */

// `min-w-0` is load-bearing, not tidiness: grid and flex items default to
// `min-width: auto`, which means the longest option's text wins over `w-full`
// and stretches the field — and its whole column with it. With the floor at 0
// the field keeps its share and the label truncates instead.
export const FIELD =
  "mt-1 w-full min-w-0 border-2 border-ink rounded-lg px-3 py-2 text-sm bg-card text-foreground";

/**
 * The two-column layout a form modal uses. `[&>*]:min-w-0` applies the same
 * floor to every cell, so no caller has to remember it per field.
 */
export function FormGrid({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 [&>*]:min-w-0 ${className}`}>
      {children}
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}
      {hint && <span className="text-muted-foreground font-normal ml-1">{hint}</span>}
    </label>
  );
}

/**
 * ARS / USD, el par de píldoras segmentadas que abre todo formulario de plata.
 *
 * Existe como componente y no como ocho líneas copiadas porque ya estaba
 * inline en `/expenses`, en el alta de ítems de tarjeta y en `/divisas`, y la
 * regla que este repo aprendió tres veces (`resolve_participant`,
 * `ParticipantPicker`, `services/currency`) es que lo que varía entre pantallas
 * es un parámetro, no una segunda implementación. Una cuarta copia en
 * `/registrar` habría sido la que se desincroniza.
 *
 * La moneda es del formulario entero, no de un campo: por eso va arriba de
 * todo y por eso ningún label lleva "$" — el símbolo pegado a una etiqueta
 * miente en cuanto el usuario toca USD.
 */
export function CurrencyToggle({ value, onChange, className = "" }: {
  value: "ARS" | "USD";
  onChange: (value: "ARS" | "USD") => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 ${className}`} role="group" aria-label="Moneda">
      {(["ARS", "USD"] as const).map(cur => (
        <button key={cur} type="button" aria-pressed={value === cur}
          onClick={() => onChange(cur)}
          className={`flex-1 py-1.5 text-xs rounded-full border-2 font-medium transition-colors ${
            value === cur
              ? "border-ink bg-primary text-primary-foreground"
              : "border-transparent text-muted-foreground hover:bg-accent"
          }`}>
          {cur === "ARS" ? "$ ARS" : "U$D"}
        </button>
      ))}
    </div>
  );
}

/**
 * The app's select: a form-shaped trigger over the shared `Listbox`.
 * `placeholder` becomes the empty option and stays grey until something is
 * chosen, so an unset field never reads as a value the user picked.
 */
export function SelectField({ value, onChange, options, placeholder, required, className = "" }: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <Listbox
      value={value} onChange={onChange} options={options}
      placeholder={placeholder} required={required} className={className}
      triggerClassName={`${FIELD} flex items-center gap-2 text-left`}
    />
  );
}

/**
 * A month, in the app's clothes. `<input type="month">` is the same story as
 * `type="date"`: an OS widget with its own format (`mm/yyyy`) and its own
 * picker. Value is `yyyy-MM`, which is what the endpoints that take a period
 * already expect.
 */
export function MonthField({ value, onChange, min, max, required, disabled, className = "" }: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => (value ? parseInt(value.slice(0, 4)) : new Date().getFullYear()));
  const { trigger, panel, pos, reset } = useAnchoredPanel(open, [year]);
  useDismiss(open, () => setOpen(false), [trigger, panel]);

  const minYear = min ? parseInt(min.slice(0, 4)) : undefined;
  const maxYear = max ? parseInt(max.slice(0, 4)) : undefined;
  const label = value
    ? format(parseISO(`${value}-01`), "MMMM yyyy", { locale: es })
    : "Elegí un mes";

  return (
    <div className={`min-w-0 ${className}`}>
      <button ref={trigger} type="button" disabled={disabled}
        onClick={() => { setOpen(v => !v); reset(); }}
        className={`${FIELD} flex items-center gap-2 text-left disabled:opacity-50`}>
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className={`flex-1 truncate ${value ? "first-letter:uppercase" : "text-muted-foreground"}`}>{label}</span>
      </button>
      {required && <RequiredMirror value={value} />}
      {open && typeof document !== "undefined" && createPortal(
        <div ref={panel} className={`fixed z-[100] ${PANEL} p-3 w-[248px]`}
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setYear(y => y - 1)}
              disabled={minYear !== undefined && year <= minYear}
              className="p-1 rounded-full hover:bg-accent text-muted-foreground disabled:opacity-30"
              aria-label="Año anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-foreground">{year}</span>
            <button type="button" onClick={() => setYear(y => y + 1)}
              disabled={maxYear !== undefined && year >= maxYear}
              className="p-1 rounded-full hover:bg-accent text-muted-foreground disabled:opacity-30"
              aria-label="Año siguiente">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS_SHORT.map((m, i) => {
              const v = `${year}-${String(i + 1).padStart(2, "0")}`;
              const selected = v === value;
              const off = (min && v < min) || (max && v > max);
              return (
                <button key={m} type="button" disabled={!!off}
                  onClick={() => { onChange(v); setOpen(false); }}
                  className={`py-1.5 text-xs rounded-lg capitalize transition-colors disabled:opacity-30 ${
                    selected ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"
                  }`}>
                  {m}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Single date, same calendar as the filter bar's range picker. */
export function DateField({ value, onChange, placeholder = "Elegí una fecha", required }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(value ? parseISO(value) : new Date()));
  const { trigger, panel, pos, reset } = useAnchoredPanel(open, [month]);
  useDismiss(open, () => setOpen(false), [trigger, panel]);

  const selected = value ? parseISO(value) : null;

  return (
    <div className="min-w-0">
      <button ref={trigger} type="button" onClick={() => { setOpen(v => !v); reset(); }}
        className={`${FIELD} flex items-center gap-2 text-left`}>
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className={`flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>
          {value ? format(parseISO(value), "d 'de' MMMM yyyy", { locale: es }) : placeholder}
        </span>
        {value && (
          <span role="button" tabIndex={0} aria-label="Limpiar fecha"
            onClick={e => { e.stopPropagation(); onChange(""); }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); onChange(""); } }}
            className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>
      {required && <RequiredMirror value={value} />}
      {open && typeof document !== "undefined" && createPortal(
        <div ref={panel} className="fixed z-[100]"
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}>
          <CalendarPanel
            month={month}
            onMonthChange={setMonth}
            from={selected}
            to={selected}
            onPick={day => { onChange(isoDate(day)); setOpen(false); }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

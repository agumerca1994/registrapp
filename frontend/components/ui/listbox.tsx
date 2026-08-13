"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/**
 * The dropdown machinery shared by every "pick one of these" control: the
 * form's `SelectField`, the filter bar's `PillSelect`, and (for the panel
 * placement only) both date pickers.
 *
 * A native `<select>` renders its option list as an OS menu, and that list is
 * the part CSS can't reach — restyling the closed box still drops a grey
 * system dropdown on top of the app. So every select in the app is a listbox:
 * a button plus this portalled panel. The two callers differ only in the
 * trigger's clothes (a form field vs a filter pill), which is why that comes
 * in as `triggerClassName`.
 */

export const PANEL = "rounded-2xl border-2 border-ink bg-card shadow-hero";

/**
 * Anchors a portalled panel to a trigger. Measured after render rather than
 * guessed — a calendar's height changes with the number of weeks in the month,
 * a listbox's with the number of options — and recomputed on resize and on
 * **capture-phase** scroll, because the scroll that moves the field is often a
 * modal's or the main region's, and it doesn't bubble.
 */
export function useAnchoredPanel(open: boolean, deps: unknown[] = [], align: "left" | "right" = "right") {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = trigger.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      if (!t || !p) return;
      const gap = 8;
      let top = t.bottom + gap;
      if (top + p.height > window.innerHeight - gap) {
        top = Math.max(gap, t.top - p.height - gap);
      }
      const raw = align === "right" ? t.right - p.width : t.left;
      const left = Math.min(Math.max(gap, raw), window.innerWidth - p.width - gap);
      setPos({ top, left, width: t.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);

  return { trigger, panel, pos, reset: () => setPos(null) };
}

export function useDismiss(open: boolean, close: () => void, refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refs.some(r => r.current?.contains(target))) return;
      close();
    };
    document.addEventListener("keydown", esc);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", esc);
      document.removeEventListener("mousedown", away);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** A `required` mirror for controls whose visible part is a button, so the
 *  browser's own validation still blocks an empty submit. */
export function RequiredMirror({ value }: { value: string }) {
  return <input tabIndex={-1} required value={value} onChange={() => {}} className="sr-only" aria-hidden="true" />;
}

export interface SelectOption {
  value: string;
  label: string;
}

export function Listbox({
  value, onChange, options, placeholder, required,
  triggerClassName, chevronClassName = "w-4 h-4", className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
  triggerClassName: string;
  chevronClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { trigger, panel, pos, reset } = useAnchoredPanel(open, [options.length], "left");
  useDismiss(open, () => setOpen(false), [trigger, panel]);

  const all: SelectOption[] = placeholder !== undefined
    ? [{ value: "", label: placeholder }, ...options]
    : options;
  const current = all.find(o => o.value === value);
  const choose = (v: string) => { onChange(v); setOpen(false); };

  // A native select is fully keyboard-operable; replacing it can't cost that.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
        setActive(Math.max(0, all.findIndex(o => o.value === value)));
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(all.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(all[active]?.value ?? ""); }
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        ref={trigger} type="button" role="combobox" aria-expanded={open}
        onClick={() => {
          setOpen(v => !v); reset();
          setActive(Math.max(0, all.findIndex(o => o.value === value)));
        }}
        onKeyDown={onKeyDown}
        className={triggerClassName}
      >
        <span className={`flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>
          {current?.label ?? placeholder ?? ""}
        </span>
        <ChevronDown className={`${chevronClassName} text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {required && <RequiredMirror value={value} />}
      {open && typeof document !== "undefined" && createPortal(
        <div ref={panel} role="listbox"
          className={`fixed z-[100] ${PANEL} p-1 max-h-[min(20rem,60vh)] overflow-y-auto`}
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            minWidth: pos?.width,
            visibility: pos ? "visible" : "hidden",
          }}>
          {all.map((o, i) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value} type="button" role="option" aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                  selected ? "bg-accent text-primary font-medium"
                    : i === active ? "bg-accent/60 text-foreground"
                    : o.value === "" ? "text-muted-foreground" : "text-foreground"
                }`}>
                <span className="flex-1 truncate">{o.label}</span>
                {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

"use client";

import { Plus } from "lucide-react";

/**
 * The floating "+" for a screen whose single job is adding rows to a list.
 * It replaces the header button: on a long list the header scrolls away, and
 * this stays reachable wherever the user is.
 *
 * Bottom right, clear of the mobile tab bar — that bar is `h-[68px]` sitting
 * `0.75rem` above the safe area, so anything lower lands on top of it.
 *
 * It wears `shadow-chip` (3px ink), the same as every other button. The 6px
 * violet `shadow-hero` belongs to the one hero card per screen; on a 56px
 * circle that offset reads as a misprint rather than depth.
 *
 * `label` is required: an icon with no text says nothing to a screen reader.
 */
export function Fab({ label, onClick, ...rest }: {
  label: string;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="fixed right-4 md:right-8 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-6 z-40 w-14 h-14 rounded-full border-2 border-ink bg-primary text-primary-foreground shadow-chip flex items-center justify-center transition-transform active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
      {...rest}
    >
      <Plus className="w-6 h-6" />
    </button>
  );
}

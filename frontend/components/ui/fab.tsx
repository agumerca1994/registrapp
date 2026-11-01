"use client";

import { Plus } from "lucide-react";
import { useReaccionActiva } from "@/components/brand/ToodReaccion";

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
 *
 * On desktop it steps aside while the t reacts to something the user just did (ToodReaccion shows up in this
 * same corner, a bit bigger), and comes back when the t leaves.
 */
export function Fab({ label, onClick, ...rest }: {
  label: string;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const reacting = useReaccionActiva();
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`fixed right-4 md:right-8 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-6 z-40 w-14 h-14 rounded-full border-2 border-ink bg-primary text-primary-foreground shadow-chip flex items-center justify-center transition-all duration-300 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none ${reacting ? "md:opacity-0 md:scale-50 md:pointer-events-none" : ""}`}
      {...rest}
    >
      <Plus className="w-6 h-6" />
    </button>
  );
}

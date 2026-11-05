"use client";

import { Plus } from "lucide-react";
import { useReaccionActiva } from "@/components/brand/ToodReaccion";
import { useAuth } from "@/contexts/AuthContext";
import { isBusiness } from "@/lib/account";

/**
 * The floating "+" for a screen whose single job is adding rows to a list.
 * It replaces the header button: on a long list the header scrolls away, and
 * this stays reachable wherever the user is.
 *
 * En el celular de un hogar no aparece: el + está en la barra de abajo y abre
 * la hoja "¿Qué pasó?". Dos + en pantalla obligan a adivinar cuál es cuál. Un
 * negocio no tiene ese + en la barra, y lo sigue usando.
 *
 * Bottom right, clear of the mobile tab bar — that bar is `h-[70px]` sitting
 * `0.75rem` above the safe area, so anything lower lands on top of it.
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
  const { appUser } = useAuth();
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${isBusiness(appUser) ? "flex" : "hidden md:flex"} fixed right-4 md:right-8 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-6 z-40 w-14 h-14 rounded-full bg-ink text-background shadow-flota items-center justify-center transition-all duration-300 active:scale-[0.95] ${reacting ? "md:opacity-0 md:scale-50 md:pointer-events-none" : ""}`}
      {...rest}
    >
      <Plus className="w-6 h-6" />
    </button>
  );
}

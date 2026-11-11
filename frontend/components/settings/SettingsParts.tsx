"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleAvatar } from "@/components/account/GoogleAvatar";

/**
 * Las piezas de Configuración. La pantalla es una lista corta de filas agrupadas
 * por lo que se viene a hacer, y cada una abre su hoja: con todos los formularios
 * abiertos, cambiar el dólar quedaba tres pantallas abajo del alias.
 */

/** Un bloque dentro de una hoja de vidrio, como las filas de la ficha de un movimiento. */
export const SHEET_BLOCK = "rounded-[22px] bg-white/70 border border-white/80 p-3.5";
/** Lo que espera algo de la persona. */
export const SHEET_NOTICE = "rounded-[22px] bg-accent border border-[#CFC9E4] p-3.5 space-y-1.5";
/** El texto secundario sobre el vidrio: el gris de siempre se lava. */
export const SHEET_TEXT = "text-sm leading-snug text-[#4A4658]";

export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-medium text-muted-foreground">{title}</h2>
      {/* Entre filas y no en cada fila: una hoja abierta es hermana de su fila y no lleva línea. */}
      <div className="mt-0.5 [&>button+button]:border-t [&>button+button]:border-border">{children}</div>
    </section>
  );
}

export function SettingsRow({ id, icon: Icon, title, hint, danger = false, onClick }: {
  id?: string;
  icon: LucideIcon;
  title: string;
  /** El estado de la fila, o para qué sirve si no tiene ninguno. */
  hint?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button id={id} type="button" onClick={onClick}
      className="w-full min-h-[64px] flex items-center gap-3 py-2.5 text-left scroll-mt-20 md:scroll-mt-8 active:scale-[0.99] transition-transform duration-100">
      <span className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${danger ? "bg-rose-50 text-destructive" : "bg-ink/[0.05] text-foreground"}`}>
        <Icon className="w-5 h-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold text-[15.5px] leading-snug ${danger ? "text-destructive" : "text-foreground"}`}>{title}</span>
        {hint && <span className="block text-sm leading-snug text-muted-foreground truncate">{hint}</span>}
      </span>
    </button>
  );
}

/** Con qué cuenta entraste y cómo salir. */
export function SessionRow({ photoURL, email, google, onLogout }: {
  photoURL?: string | null;
  email?: string | null;
  google: boolean;
  onLogout: () => void;
}) {
  return (
    <div className="flex items-center gap-3 min-h-[64px] py-2.5 border-b border-border">
      <GoogleAvatar photoURL={photoURL} className="w-10 h-10" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[15.5px] leading-snug text-foreground truncate">{email}</span>
        <span className="block text-sm leading-snug text-muted-foreground">{google ? "Cuenta de Google" : "Tu sesión"}</span>
      </span>
      <button type="button" onClick={onLogout}
        className="shrink-0 min-h-[44px] px-4 rounded-full bg-ink/[0.06] font-semibold text-sm text-foreground active:scale-[0.97] transition-transform duration-100">
        Cerrar sesión
      </button>
    </div>
  );
}

/** Las acciones que no se deshacen preguntan ahí mismo, sin la ventana del navegador. */
export function ConfirmInline({ question, confirmLabel, busy, onConfirm, onCancel }: {
  question: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-[22px] bg-rose-50 border border-rose-200 p-2.5" role="alert">
      <p className="px-1.5 pb-2 text-[15px] font-medium text-rose-900">{question}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" autoFocus onClick={onCancel}
          className="h-12 rounded-full bg-white border border-rose-200 font-semibold text-[15px] text-foreground active:scale-[0.98] transition-transform duration-100">
          No, dejarlo
        </button>
        <button type="button" onClick={onConfirm} disabled={busy}
          className="h-12 rounded-full bg-destructive text-destructive-foreground font-semibold text-[15px] disabled:opacity-50 active:scale-[0.98] transition-transform duration-100">
          {busy ? "Un momento…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function SheetButton({ className = "", ...props }: React.ComponentProps<typeof Button>) {
  return <Button className={`w-full h-[52px] text-[15.5px] ${className}`} {...props} />;
}

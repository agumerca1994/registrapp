"use client";

import { forwardRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "@/contexts/PrivacyContext";

/**
 * The "ocultar montos" entry for a screen's ⋮ menu.
 *
 * `forwardRef` + prop spreading are required, not decoration: Radix's
 * `DropdownMenu.Item asChild` clones this element to attach its ref and its
 * menuitem role/handlers, and a plain function component silently swallows
 * both — the entry renders but never behaves like a menu item.
 */
export const PrivacyMenuItem = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function PrivacyMenuItem({ onClick, ...rest }, ref) {
    const { hidden, toggle } = usePrivacy();
    return (
      <button
        ref={ref}
        {...rest}
        onClick={e => { toggle(); onClick?.(e); }}
        className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground hover:bg-accent w-full outline-none cursor-pointer"
      >
        {hidden ? <Eye className="w-4 h-4 text-muted-foreground" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
        {hidden ? "Mostrar montos" : "Ocultar montos"}
      </button>
    );
  }
);

/** Standalone icon button, for a header with no menu of its own. */
export function PrivacyButton() {
  const { hidden, toggle } = usePrivacy();
  return (
    <button onClick={toggle}
      aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
      title={hidden ? "Mostrar montos" : "Ocultar montos"}
      className={`p-1.5 rounded-full transition-colors ${hidden ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
      {hidden ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
    </button>
  );
}

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Status/category pill — e.g. "Aceptado"/"Pendiente" chips, the USD badge,
// category tags. Always gets the small hard shadow per the v3 hierarchy
// ("small interactive/informational elements stay 3D everywhere").
// `locked` switches to a dashed border for not-yet-confirmed/inactive states
// (e.g. a pending invitation), matching the same semantic used on locked
// achievement cards.
const chipVariants = cva(
  "inline-flex items-center gap-1 rounded-full border-2 border-ink px-3 py-1 text-xs font-medium shadow-chip whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-white text-foreground",
        violet: "bg-primary/10 text-primary",
        emerald: "bg-emerald-50 text-emerald-700",
        amber: "bg-amber-50 text-amber-700",
        rose: "bg-rose-50 text-rose-700",
      },
      locked: {
        true: "border-dashed shadow-none bg-transparent text-muted-foreground",
        false: "",
      },
    },
    defaultVariants: {
      tone: "neutral",
      locked: false,
    },
  }
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {}

export function Chip({ className, tone, locked, ...props }: ChipProps) {
  return <span className={cn(chipVariants({ tone, locked }), className)} {...props} />;
}

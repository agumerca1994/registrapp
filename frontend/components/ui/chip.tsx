import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Status/category pill — e.g. "Aceptado"/"Pendiente" chips, the USD badge,
// category tags. `locked` switches to a dashed border for
// not-yet-confirmed/inactive states (e.g. a pending invitation).
const chipVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-secondary text-foreground",
        violet: "bg-accent text-[#3B2FB3]",
        emerald: "bg-emerald-100 text-emerald-800",
        amber: "bg-amber-100 text-amber-800",
        rose: "bg-rose-100 text-rose-800",
      },
      locked: {
        true: "border border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground",
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

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// At most ONE "hero" card per screen, and only where there is no violet block
// on top (`components/ui/glass.tsx`). Everything else uses "flat". Screens with no
// obvious hero (Gastos compartidos, Tarjetas, Configuración, Variables macro)
// should use "flat" everywhere and simply have no hero card at all.
const cardVariants = cva("rounded-3xl bg-card text-card-foreground p-4 md:p-5", {
  variants: {
    variant: {
      hero: "border border-border shadow-hero",
      flat: "border border-border",
    },
  },
  defaultVariants: {
    variant: "flat",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

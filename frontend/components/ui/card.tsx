import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// v3 design hierarchy: exactly ONE "hero" card per screen (the single most
// important summary — e.g. the Balance card on Dashboard, the loan summary
// on Hipoteca). Everything else uses "flat". Screens with no obvious hero
// (Gastos compartidos, Tarjetas, Configuración, Variables macro) should use
// "flat" everywhere and simply have no hero card at all.
const cardVariants = cva("rounded-2xl bg-card text-card-foreground p-4 md:p-5", {
  variants: {
    variant: {
      hero: "border-[2.5px] border-ink shadow-hero",
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

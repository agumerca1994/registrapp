import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// La acción principal es oscura: el violeta queda para la marca y los datos.
// Lo que se aprieta se siente al tocarlo (se achica un poco), sin sombra.
// `ghost` is for low-emphasis inline actions (e.g. an edit/delete icon in a
// flat list row).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-transform duration-100 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-ink text-background px-4 py-2.5",
        outline: "border border-border bg-card text-foreground px-4 py-2.5",
        destructive: "bg-destructive text-destructive-foreground px-4 py-2.5",
        ghost: "px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant }), className)} {...props} />;
  }
);
Button.displayName = "Button";

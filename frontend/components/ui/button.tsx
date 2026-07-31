import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Primary/outline buttons keep the small hard shadow + pill shape per the v3
// hierarchy ("things you press stay 3D"). `ghost` opts out for low-emphasis
// inline actions (e.g. an edit/delete icon in a flat list row) where the
// sticker treatment would be too heavy for every row.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-transform disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "border-2 border-ink bg-primary text-primary-foreground px-4 py-2 shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
        outline:
          "border-2 border-ink bg-white text-foreground px-4 py-2 shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
        destructive:
          "border-2 border-ink bg-destructive text-destructive-foreground px-4 py-2 shadow-chip active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
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

"use client";

import { createElement } from "react";
import { useListMotion } from "@/lib/motion";

/**
 * `useListMotion()` hecho elemento, para lo que no puede llamar a un hook: una
 * pantalla con salidas tempranas, una lista armada por una función, una rama
 * condicional. Va en el padre directo de lo que entra y sale.
 */
export function MotionList({ as = "div", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "ul" }) {
  const ref = useListMotion<HTMLElement>();
  return createElement(as, { ...props, ref });
}

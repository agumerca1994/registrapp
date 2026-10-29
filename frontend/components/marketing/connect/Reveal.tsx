"use client";

import { useRef } from "react";
import styles from "./connect.module.css";
import { useReveal } from "./hooks";

/** Aparece una vez al entrar en pantalla. Sin JS o con reducción de movimiento, ya está visible. */
export function Reveal({ children, className = "", as: Tag = "div" }: {
  children: React.ReactNode; className?: string; as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  return <Tag ref={ref as never} className={`${styles.reveal} ${className}`}>{children}</Tag>;
}

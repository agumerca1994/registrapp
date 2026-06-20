import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatARS(amount: number | string): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(Number(amount));
}

export function formatPct(value: number | string): string {
  return `${Number(value).toFixed(2)}%`;
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export function formatUSD(amount: number | string): string {
  return "U$D " + new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

// Parse Argentine decimal format: "9,99" or "1.000,99" → 9.99 or 1000.99
export function parseAmount(value: string | number): number {
  if (typeof value === "number") return value;
  // Remove thousands dots, replace decimal comma with dot
  return parseFloat(value.replace(/\./g, "").replace(",", ".")) || 0;
}

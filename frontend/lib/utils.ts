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
// Also handles standard decimal notation from toFixed(): "7500.00" → 7500
export function parseAmount(value: string | number): number {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  // Standard decimal notation (from toFixed auto-calc): single dot + 1-2 decimal digits
  // e.g. "7500.00", "9000000.00" — do NOT strip the dot
  if (/^\d+\.\d{1,2}$/.test(trimmed)) return parseFloat(trimmed);
  // Argentine format: remove thousands dots, replace decimal comma with dot
  // e.g. "750.000", "1.000.000,99", "9,99"
  return parseFloat(trimmed.replace(/\./g, "").replace(",", ".")) || 0;
}

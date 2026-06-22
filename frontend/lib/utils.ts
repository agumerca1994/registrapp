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

interface PhoneNormResult {
  prefix: string;
  local: string;
  isValid: boolean;
}

// Normalize phone number from device contact picker to prefix + local format
// Handles various formats: +549351234567, 9 351 234 567, 351234567, +54 9 351 234567, etc.
export function normalizePhoneNumber(rawPhone: string, availablePrefixes: string[] = ["54", "598", "56", "55", "595"]): PhoneNormResult {
  const digits = rawPhone.replace(/\D/g, "");

  // Try to match known prefix lengths (59x uses 3 digits, others 2)
  for (const prefix of availablePrefixes) {
    if (digits.startsWith(prefix)) {
      const local = digits.slice(prefix.length);
      // For Argentina (54), if starts with 9, remove it (will be re-added on build)
      const cleanLocal = prefix === "54" && local.startsWith("9") ? local.slice(1) : local;
      return { prefix, local: cleanLocal, isValid: cleanLocal.length >= 7 };
    }
  }

  // No recognized prefix found — return all digits as local (user will need to fix)
  return { prefix: "54", local: digits, isValid: digits.length >= 7 };
}

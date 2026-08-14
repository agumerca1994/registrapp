import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Safely extract a display string from an axios error's response body.
// FastAPI's `detail` is a plain string for manual HTTPExceptions, but an
// array of {type, loc, msg, input} objects for automatic 422 validation
// errors — rendering that array directly as a React child crashes the page
// ("Objects are not valid as a React child"). Always route error display
// through this instead of reading `err.response?.data?.detail` directly.
export function getErrorMessage(err: unknown, fallback = "Ocurrió un error"): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => (item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : String(item)))
      .join(" ");
  }
  return fallback;
}

/**
 * Privacy mode, read by every money formatter.
 *
 * It lives as module state rather than as a prop threaded through the app
 * because the alternative is touching ~90 call sites of `formatARS`/`formatUSD`
 * and hoping none is ever missed — and one missed amount defeats the whole
 * feature. `PrivacyProvider` sets it during render, before its children run,
 * and re-renders the tree when it flips.
 */
let amountsHidden = false;
const MASK = "••••";

export function setAmountsHidden(value: boolean) {
  amountsHidden = value;
}

export function areAmountsHidden(): boolean {
  return amountsHidden;
}

export function formatARS(amount: number | string): string {
  if (amountsHidden) return `$ ${MASK}`;
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
  if (amountsHidden) return `U$D ${MASK}`;
  return "U$D " + new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/**
 * A stored phone, for display.
 *
 * `_normalize_phone()` writes `+549…` with the plus already in it, so the `+`
 * the UI used to prepend produced `++549…`. Tolerant of both spellings on
 * purpose: the same reason the backend lookups try `+549…` and `549…` — rows
 * predating migration `c9d0e1f2a3b4` were bare digits, and a row written by
 * some other path could be again.
 */
export function formatPhone(phone: string): string {
  const trimmed = phone.trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
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

// Curated, visually-distinct palette for new expense categories — brand
// violet first, then a spread of hues that stay legible on light bg.
const CATEGORY_COLOR_PALETTE = [
  "#5B4FE9", "#10b981", "#f59e0b", "#f43f5e", "#0ea5e9",
  "#14b8a6", "#f97316", "#ec4899", "#8b5cf6", "#64748b",
  "#22c55e", "#eab308", "#ef4444", "#06b6d4", "#a855f7", "#84cc16",
];

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Suggests a random color not already used by any of the tenant's existing
// categories — still just a default, the color input stays fully editable.
export function pickCategoryColor(existingColors: (string | null | undefined)[]): string {
  const used = new Set(existingColors.filter(Boolean).map(c => c!.toLowerCase()));
  const available = CATEGORY_COLOR_PALETTE.filter(c => !used.has(c.toLowerCase()));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  // Palette exhausted (lots of categories) — fall back to a random hue.
  return hslToHex(Math.floor(Math.random() * 360), 65, 55);
}

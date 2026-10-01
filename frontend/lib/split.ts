/**
 * Dividir plata entre personas, en centavos.
 *
 * Todo pasa por centavos enteros porque la división en punto flotante no
 * cierra: 100 / 3 redondeado a dos decimales da 33,33 × 3 = 99,99, y el backend
 * rechaza cualquier división cuya suma no coincida con el total (±0,01). Con
 * centavos, el resto se asigna explícitamente y la suma coincide siempre.
 *
 * Lo usan los tres formularios que dividen plata: el unificado de egresos
 * (`components/expense/`), `/shared` (alta y edición) y `ShareItemModal` (el
 * resumen de tarjeta). Cada uno tenía su propia lógica y las tres derivaron:
 * `/shared` leía "15.000" como 15 y repartía con `total / n` redondeado, y
 * `ShareItemModal` cerraba el resto a mano por otro camino. Si aparece un
 * cuarto formulario, importa de acá — no vuelvas a escribirlo.
 */

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * `total` dividido en `n` partes iguales, con el resto de centavos en la última.
 *
 * El resto va a la última fila y no se reparte, a propósito: así la persona ve
 * de un vistazo quién pone el centavo de más. Era ya la convención de
 * `ShareItemModal` antes de que migrara acá.
 */
export function equalSplit(total: number, n: number): number[] {
  if (n <= 0) return [];
  const totalCents = toCents(total);
  const base = Math.floor(totalCents / n);
  const parts = Array<number>(n).fill(base);
  parts[n - 1] += totalCents - base * n;
  return parts.map(fromCents);
}

/** La suma de `amounts` coincide exactamente con `total`, en centavos. */
export function sumMatches(total: number, amounts: number[]): boolean {
  const sum = amounts.reduce((acc, a) => acc + toCents(a), 0);
  return sum === toCents(total);
}

/** Cuántos centavos faltan (positivo) o sobran (negativo) para llegar a `total`. */
export function remainder(total: number, amounts: number[]): number {
  const sum = amounts.reduce((acc, a) => acc + toCents(a), 0);
  return fromCents(toCents(total) - sum);
}

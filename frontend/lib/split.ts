/**
 * Dividir plata entre personas, en centavos.
 *
 * Todo pasa por centavos enteros porque la división en punto flotante no
 * cierra: 100 / 3 redondeado a dos decimales da 33,33 × 3 = 99,99, y el backend
 * rechaza cualquier división cuya suma no coincida con el total (±0,01). Con
 * centavos, el resto se asigna explícitamente y la suma coincide siempre.
 *
 * Lo usa el formulario unificado de egresos (`components/expense/`). `/shared`
 * y `ShareItemModal` todavía tienen su propia lógica —con un `parseAmt` que lee
 * "15.000" como 15 y sin ajuste de resto— y quedaron afuera por decisión del
 * usuario; cuando se toquen, deberían pasar a usar esto.
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
 * El resto va a la última fila y no se reparte, a propósito: es lo que ya hace
 * `ShareItemModal`, y la persona puede ver de un vistazo quién pone el centavo
 * de más.
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

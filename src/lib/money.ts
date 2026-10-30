/**
 * Money helpers. All amounts are integer kobo (1 NGN = 100 kobo).
 * No floating-point arithmetic is used for stored or summed amounts.
 */
export const CURRENCY = "NGN" as const;
export type Currency = typeof CURRENCY;

export function assertKobo(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer number of kobo`);
  return value;
}

/** Parse a user-entered naira string like "150,000.50" into kobo without floats. */
export function parseNairaToKobo(input: string): number | null {
  const s = input.replace(/[₦,\s]/g, "").trim();
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const kobo = BigInt(whole!) * 100n + BigInt((frac + "00").slice(0, 2));
  if (kobo > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(kobo);
}

export function formatKobo(kobo: number, opts: { symbol?: boolean } = {}): string {
  const negative = kobo < 0;
  const abs = Math.abs(kobo);
  const naira = Math.trunc(abs / 100);
  const k = abs % 100;
  const whole = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${whole}.${k.toString().padStart(2, "0")}`;
  const sym = opts.symbol === false ? "" : "₦";
  return `${negative ? "-" : ""}${sym}${body}`;
}

export function sumKobo(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    assertKobo(v);
    total += v;
    if (!Number.isSafeInteger(total)) throw new Error("Amount overflow");
  }
  return total;
}

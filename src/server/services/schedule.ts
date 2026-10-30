/**
 * Pure rent-schedule maths. No database access, fully unit-tested.
 *
 * Rules:
 *  - Billing periods are anchored to the tenancy start day-of-month. When that day doesn't exist
 *    (e.g. the 31st, or 29 Feb in a common year), the period starts on the month's last day and
 *    later periods return to the anchor day (no drift).
 *  - Rent for a period is due on the period's first day (rent in advance, the Nigerian norm).
 *  - A charge becomes overdue after dueDate + gracePeriodDays.
 *  - The last period ends on the tenancy end date. It is billed in full unless prorateFinalPeriod
 *    is set, in which case it is prorated by days using integer maths (rounded down to the kobo).
 *  - A rent change applies to periods starting on or after its effectiveFrom date only.
 */
import { addDays, addMonthsAnchored, diffDays } from "@/lib/dates";
import type { Frequency } from "@/server/models/property";

export const FREQ_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

export interface ScheduleTerms {
  startDate: Date;
  endDate: Date;
  frequency: Frequency;
  rentSchedule: { effectiveFrom: Date; amountKobo: number }[];
  prorateFinalPeriod?: boolean;
}

export interface Period {
  index: number;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  /** Full nominal period end (before truncation by the tenancy end). */
  nominalEnd: Date;
  truncated: boolean;
}

export function periodAt(terms: Pick<ScheduleTerms, "startDate" | "endDate" | "frequency">, index: number): Period | null {
  if (index < 0) return null;
  const m = FREQ_MONTHS[terms.frequency];
  const anchor = terms.startDate.getUTCDate();
  const start = addMonthsAnchored(terms.startDate, index * m, anchor);
  if (start > terms.endDate) return null;
  const nextStart = addMonthsAnchored(terms.startDate, (index + 1) * m, anchor);
  const nominalEnd = addDays(nextStart, -1);
  const truncated = nominalEnd > terms.endDate;
  return { index, periodStart: start, periodEnd: truncated ? terms.endDate : nominalEnd, dueDate: start, nominalEnd, truncated };
}

export function periodCount(terms: Pick<ScheduleTerms, "startDate" | "endDate" | "frequency">): number {
  let i = 0;
  while (periodAt(terms, i)) i++;
  return i;
}

export function allPeriods(terms: Pick<ScheduleTerms, "startDate" | "endDate" | "frequency">): Period[] {
  const out: Period[] = [];
  for (let i = 0; ; i++) {
    const p = periodAt(terms, i);
    if (!p) break;
    out.push(p);
    if (i > 1200) throw new Error("Tenancy too long");
  }
  return out;
}

export function rentEffectiveOn(rentSchedule: ScheduleTerms["rentSchedule"], date: Date): number {
  const sorted = [...rentSchedule].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  let amount = sorted[0]?.amountKobo;
  for (const entry of sorted) {
    if (entry.effectiveFrom <= date) amount = entry.amountKobo;
  }
  if (amount === undefined) throw new Error("Tenancy has no rent schedule");
  return amount;
}

/** Integer prorating: floor(amount * actualDays / nominalDays). */
export function prorate(amountKobo: number, actualDays: number, nominalDays: number): number {
  if (nominalDays <= 0) return amountKobo;
  return Number((BigInt(amountKobo) * BigInt(actualDays)) / BigInt(nominalDays));
}

export function rentForPeriod(terms: ScheduleTerms, period: Period): number {
  const base = rentEffectiveOn(terms.rentSchedule, period.periodStart);
  if (!period.truncated || !terms.prorateFinalPeriod) return base;
  const actual = diffDays(period.periodEnd, period.periodStart) + 1;
  const nominal = diffDays(period.nominalEnd, period.periodStart) + 1;
  return prorate(base, actual, nominal);
}

/** The index of the period containing `date` (or the last period if after the end), -1 if before start. */
export function periodIndexOn(terms: Pick<ScheduleTerms, "startDate" | "endDate" | "frequency">, date: Date): number {
  if (date < terms.startDate) return -1;
  let lo = 0;
  let i = 0;
  for (;;) {
    const p = periodAt(terms, i);
    if (!p) return lo;
    if (p.periodStart > date) return lo;
    lo = i;
    i++;
  }
}

export function isOverdue(dueDate: Date, gracePeriodDays: number, today: Date): boolean {
  return addDays(dueDate, gracePeriodDays) < today;
}

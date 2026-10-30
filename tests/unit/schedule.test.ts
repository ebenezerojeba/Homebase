import { describe, expect, it } from "vitest";
import { addMonthsAnchored, parseISODate, toISODate, isLeapYear } from "@/lib/dates";
import { allPeriods, isOverdue, periodAt, periodIndexOn, prorate, rentEffectiveOn, rentForPeriod } from "@/server/services/schedule";

const d = parseISODate;
const iso = toISODate;

describe("addMonthsAnchored", () => {
  it("clamps to month end without drifting", () => {
    const jan31 = d("2025-01-31");
    expect(iso(addMonthsAnchored(jan31, 1))).toBe("2025-02-28");
    expect(iso(addMonthsAnchored(jan31, 2))).toBe("2025-03-31");
    expect(iso(addMonthsAnchored(jan31, 3))).toBe("2025-04-30");
  });
  it("handles leap years", () => {
    expect(iso(addMonthsAnchored(d("2024-01-31"), 1))).toBe("2024-02-29");
    expect(iso(addMonthsAnchored(d("2024-02-29"), 12))).toBe("2025-02-28");
    expect(iso(addMonthsAnchored(d("2024-02-29"), 48))).toBe("2028-02-29");
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });
  it("crosses year boundaries", () => {
    expect(iso(addMonthsAnchored(d("2025-11-15"), 3))).toBe("2026-02-15");
  });
});

describe("billing periods", () => {
  it("generates monthly periods anchored to the 31st", () => {
    const terms = { startDate: d("2025-01-31"), endDate: d("2025-05-30"), frequency: "monthly" as const };
    const ps = allPeriods(terms);
    expect(ps.map((p) => iso(p.periodStart))).toEqual(["2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30"]);
    expect(iso(ps[0]!.periodEnd)).toBe("2025-02-27");
    expect(iso(ps[1]!.periodEnd)).toBe("2025-03-30");
    expect(iso(ps[3]!.periodEnd)).toBe("2025-05-30");
    expect(ps[3]!.truncated).toBe(false);
  });

  it("annual tenancy has one period, due on the start date", () => {
    const terms = { startDate: d("2025-03-01"), endDate: d("2026-02-28"), frequency: "annual" as const };
    const ps = allPeriods(terms);
    expect(ps).toHaveLength(1);
    expect(iso(ps[0]!.dueDate)).toBe("2025-03-01");
    expect(iso(ps[0]!.periodEnd)).toBe("2026-02-28");
  });

  it("annual period starting on a leap day", () => {
    const terms = { startDate: d("2024-02-29"), endDate: d("2027-02-27"), frequency: "annual" as const };
    expect(allPeriods(terms).map((p) => iso(p.periodStart))).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });

  it("quarterly and half-yearly schedules", () => {
    const q = allPeriods({ startDate: d("2025-01-15"), endDate: d("2026-01-14"), frequency: "quarterly" });
    expect(q.map((p) => iso(p.periodStart))).toEqual(["2025-01-15", "2025-04-15", "2025-07-15", "2025-10-15"]);
    const h = allPeriods({ startDate: d("2025-08-31"), endDate: d("2026-08-30"), frequency: "half_yearly" });
    expect(h.map((p) => iso(p.periodStart))).toEqual(["2025-08-31", "2026-02-28"]);
  });

  it("truncates the final period at the tenancy end", () => {
    const p = periodAt({ startDate: d("2025-01-01"), endDate: d("2025-02-14"), frequency: "monthly" }, 1)!;
    expect(iso(p.periodEnd)).toBe("2025-02-14");
    expect(p.truncated).toBe(true);
    expect(periodAt({ startDate: d("2025-01-01"), endDate: d("2025-02-14"), frequency: "monthly" }, 2)).toBeNull();
  });

  it("finds the period containing a date", () => {
    const terms = { startDate: d("2025-01-10"), endDate: d("2025-12-31"), frequency: "monthly" as const };
    expect(periodIndexOn(terms, d("2025-01-09"))).toBe(-1);
    expect(periodIndexOn(terms, d("2025-01-10"))).toBe(0);
    expect(periodIndexOn(terms, d("2025-03-09"))).toBe(1);
    expect(periodIndexOn(terms, d("2025-03-10"))).toBe(2);
  });
});

describe("rent amounts", () => {
  const schedule = [
    { effectiveFrom: d("2025-01-01"), amountKobo: 100_000_00 },
    { effectiveFrom: d("2025-07-01"), amountKobo: 120_000_00 },
  ];
  it("applies rent changes only from their effective date", () => {
    expect(rentEffectiveOn(schedule, d("2025-06-30"))).toBe(100_000_00);
    expect(rentEffectiveOn(schedule, d("2025-07-01"))).toBe(120_000_00);
  });
  it("prorates with integer maths (rounding down to the kobo)", () => {
    expect(prorate(100_000_00, 15, 31)).toBe(48_387_09);
    expect(Number.isInteger(prorate(99_999_99, 7, 30))).toBe(true);
  });
  it("prorates only the truncated final period when enabled", () => {
    const terms = { startDate: d("2025-01-01"), endDate: d("2025-02-14"), frequency: "monthly" as const, rentSchedule: schedule, prorateFinalPeriod: true };
    expect(rentForPeriod(terms, periodAt(terms, 0)!)).toBe(100_000_00);
    expect(rentForPeriod(terms, periodAt(terms, 1)!)).toBe(prorate(100_000_00, 14, 28));
    expect(rentForPeriod({ ...terms, prorateFinalPeriod: false }, periodAt(terms, 1)!)).toBe(100_000_00);
  });
});

describe("overdue", () => {
  it("respects the grace period", () => {
    expect(isOverdue(d("2025-01-01"), 0, d("2025-01-01"))).toBe(false);
    expect(isOverdue(d("2025-01-01"), 0, d("2025-01-02"))).toBe(true);
    expect(isOverdue(d("2025-01-01"), 5, d("2025-01-06"))).toBe(false);
    expect(isOverdue(d("2025-01-01"), 5, d("2025-01-07"))).toBe(true);
  });
});

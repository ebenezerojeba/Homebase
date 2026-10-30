/**
 * CSV generation with spreadsheet formula-injection protection.
 * Text cells beginning with =, +, -, @, tab or carriage return are prefixed with an apostrophe so
 * Excel/Sheets treat them as text. Numeric columns are emitted as plain numbers.
 */
export type CsvColumn<T> = { header: string; type?: "text" | "number"; value: (row: T) => string | number | null | undefined };

const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined, type: "text" | "number" = "text"): string {
  if (value === null || value === undefined) return "";
  if (type === "number" && typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  let s = String(value);
  if (DANGEROUS.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s) || s.startsWith("'")) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r), c.type)).join(","));
  // BOM so Excel opens UTF-8 (₦, names with diacritics) correctly.
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}

/** Kobo → naira decimal string for spreadsheets, without float maths. */
export function koboToDecimal(kobo: number): string {
  const neg = kobo < 0;
  const abs = Math.abs(kobo);
  return `${neg ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

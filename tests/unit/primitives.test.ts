import { describe, expect, it } from "vitest";
import { csvCell, koboToDecimal, toCsv } from "@/lib/csv";
import { detectFileType, pdfLooksUnsafe, sanitizeDisplayName } from "@/lib/files";
import { redact } from "@/lib/logger";
import { formatKobo, parseNairaToKobo, sumKobo } from "@/lib/money";
import { normalizeNigerianPhone } from "@/lib/nigeria";
import { normalizeReference } from "@/lib/validation";
import { overdueReminderMilestone, upcomingReminderOffset } from "@/server/services/jobs";
import { parseISODate } from "@/lib/dates";

describe("money", () => {
  it("parses naira to kobo without floating point", () => {
    expect(parseNairaToKobo("150,000.50")).toBe(15_000_050);
    expect(parseNairaToKobo("₦0.1")).toBe(10);
    expect(parseNairaToKobo("0.29")).toBe(29); // 0.29 * 100 = 28.999999... in floats
    expect(parseNairaToKobo("1.005")).toBeNull();
    expect(parseNairaToKobo("-5")).toBeNull();
    expect(parseNairaToKobo("abc")).toBeNull();
  });
  it("formats kobo", () => {
    expect(formatKobo(123_456_78)).toBe("₦123,456.78");
    expect(formatKobo(-5)).toBe("-₦0.05");
    expect(koboToDecimal(1_000_05)).toBe("1000.05");
  });
  it("rejects non-integer sums", () => {
    expect(() => sumKobo([1, 0.5])).toThrow();
    expect(sumKobo([1, 2, 3])).toBe(6);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection in text cells", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+2348000000000")).toBe(`"'+2348000000000"`);
    expect(csvCell("-1+1")).toBe(`"'-1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("\tcmd")).toBe(`"'\tcmd"`);
    expect(csvCell("Normal, text")).toBe(`"Normal, text"`);
  });
  it("keeps numeric columns numeric (including negatives)", () => {
    expect(csvCell(-500, "number")).toBe("-500");
    const csv = toCsv([{ a: "=1+1", b: -200 }], [{ header: "A", value: (r) => r.a }, { header: "B", type: "number", value: (r) => r.b }]);
    expect(csv).toContain(`"'=1+1",-200`);
  });
});

describe("file detection", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n");
  it("detects by content, not name", () => {
    expect(detectFileType(png)?.mime).toBe("image/png");
    expect(detectFileType(pdf)?.mime).toBe("application/pdf");
    expect(detectFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectFileType(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff"))).toBeNull();
    expect(detectFileType(Buffer.from("<html><script>x</script></html>"))).toBeNull();
  });
  it("flags PDFs with active content", () => {
    expect(pdfLooksUnsafe(Buffer.from("%PDF-1.4 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"))).toBe(true);
    expect(pdfLooksUnsafe(pdf)).toBe(false);
  });
  it("sanitises display names", () => {
    expect(sanitizeDisplayName("../../etc/passwd", "x")).toBe("passwd");
    expect(sanitizeDisplayName("<script>.pdf", "x")).toBe("_script_.pdf");
  });
});

describe("misc", () => {
  it("normalises Nigerian phone numbers", () => {
    expect(normalizeNigerianPhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("12345")).toBeNull();
  });
  it("normalises transfer references", () => {
    expect(normalizeReference(" ft-123/abc ")).toBe("FT123ABC");
  });
  it("redacts secrets from logs", () => {
    expect(redact({ password: "x", nested: { apiKey: "y", ok: 1 }, authorization: "Bearer z" })).toEqual({ password: "[redacted]", nested: { apiKey: "[redacted]", ok: 1 }, authorization: "[redacted]" });
  });
});

describe("reminder selection", () => {
  const d = parseISODate;
  it("fires only the nearest upcoming reminder (no burst after missed runs)", () => {
    expect(upcomingReminderOffset(d("2025-01-10"), d("2025-01-01"), [7, 3, 1])).toBeNull();
    expect(upcomingReminderOffset(d("2025-01-10"), d("2025-01-03"), [7, 3, 1])).toBe(7);
    expect(upcomingReminderOffset(d("2025-01-10"), d("2025-01-08"), [7, 3, 1])).toBe(3);
    expect(upcomingReminderOffset(d("2025-01-10"), d("2025-01-09"), [7, 3, 1])).toBe(1);
    expect(upcomingReminderOffset(d("2025-01-10"), d("2025-01-10"), [7, 3, 1])).toBeNull();
  });
  it("picks the latest overdue milestone reached", () => {
    expect(overdueReminderMilestone(d("2025-01-01"), 0, d("2025-01-01"), [1, 7, 14])).toBeNull();
    expect(overdueReminderMilestone(d("2025-01-01"), 0, d("2025-01-02"), [1, 7, 14])).toBe(1);
    expect(overdueReminderMilestone(d("2025-01-01"), 0, d("2025-01-10"), [1, 7, 14])).toBe(7);
    expect(overdueReminderMilestone(d("2025-01-01"), 3, d("2025-01-05"), [1, 7, 14])).toBe(1);
    expect(overdueReminderMilestone(d("2025-01-01"), 3, d("2025-01-04"), [1, 7, 14])).toBeNull();
  });
});

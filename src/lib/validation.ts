import { z } from "zod";
import { isValidISODate } from "./dates";
import { normalizeNigerianPhone } from "./nigeria";

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

export const isoDate = z.string().refine(isValidISODate, "Use a valid date (YYYY-MM-DD)");

/** Amounts arrive from clients as integer kobo. */
export const koboAmount = z
  .number({ error: "Enter an amount" })
  .int("Amount must be in whole kobo")
  .positive("Amount must be greater than zero")
  .max(100_000_000_000_00, "Amount is too large");

export const email = z.email("Enter a valid email address").max(254).transform((s) => s.trim().toLowerCase());

export const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .refine((p) => new TextEncoder().encode(p).length <= 72, "Password is too long")
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Include at least one letter and one number");

export const personName = z.string().trim().min(2, "Enter a name").max(120);

export const nigerianPhone = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (!s) return null;
    const n = normalizeNigerianPhone(s);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a valid Nigerian phone number" });
      return z.NEVER;
    }
    return n;
  });

export const shortText = (max: number) => z.string().trim().max(max);
export const requiredText = (max: number, msg = "This field is required") => z.string().trim().min(1, msg).max(max);

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Strip characters that are meaningless in references and compare case-insensitively. */
export function normalizeReference(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

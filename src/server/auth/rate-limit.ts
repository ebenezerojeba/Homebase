import "server-only";
import { env } from "@/lib/env";
import { errors, isDuplicateKeyError } from "@/lib/errors";
import { connectDb } from "@/server/db";
import { RateLimit } from "@/server/models";
import { hmac } from "./crypto";

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export const RULES = {
  login: { bucket: "login", limit: 10, windowSeconds: 15 * 60 },
  loginEmail: { bucket: "login-email", limit: 5, windowSeconds: 15 * 60 },
  register: { bucket: "register", limit: 5, windowSeconds: 60 * 60 },
  passwordReset: { bucket: "pw-reset", limit: 5, windowSeconds: 60 * 60 },
  verifyEmail: { bucket: "verify-email", limit: 5, windowSeconds: 60 * 60 },
  invite: { bucket: "invite", limit: 30, windowSeconds: 60 * 60 },
  inviteAccept: { bucket: "invite-accept", limit: 10, windowSeconds: 15 * 60 },
  upload: { bucket: "upload", limit: 60, windowSeconds: 60 * 60 },
  paymentClaim: { bucket: "payment-claim", limit: 20, windowSeconds: 60 * 60 },
  paymentInit: { bucket: "payment-init", limit: 20, windowSeconds: 60 * 60 },
  message: { bucket: "message", limit: 120, windowSeconds: 10 * 60 },
  export: { bucket: "export", limit: 30, windowSeconds: 60 * 60 },
  mutation: { bucket: "mutation", limit: 300, windowSeconds: 10 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window limiter backed by MongoDB, so it holds across serverless instances.
 * Identifiers are HMAC'd so raw IPs/emails are not stored.
 */
export async function rateLimit(rule: RateLimitRule, identifier: string, now = new Date()): Promise<void> {
  await connectDb();
  const windowIndex = Math.floor(now.getTime() / (rule.windowSeconds * 1000));
  const key = hmac(env().APP_SECRET, `${rule.bucket}:${identifier.toLowerCase()}:${windowIndex}`);
  const expiresAt = new Date((windowIndex + 1) * rule.windowSeconds * 1000);
  let doc;
  try {
    doc = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after" },
    ).lean();
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    doc = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { returnDocument: "after" }).lean();
  }
  if (doc && doc.count > rule.limit) throw errors.rateLimited();
}

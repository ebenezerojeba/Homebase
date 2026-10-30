import "server-only";
import { env } from "@/lib/env";
import { connectDb } from "@/server/db";
import { NOTIFICATION_TYPES, User, type NotificationType } from "@/server/models";
import { hmac, safeEqualHex } from "@/server/auth/crypto";

/** Types a user may switch off from an email link (account and invitation emails are always sent). */
export function canUnsubscribe(type: NotificationType) {
  return type !== "account" && type !== "invitation";
}

function sign(userId: string, type: string) {
  return hmac(env().APP_SECRET, `unsubscribe:${userId}:${type}`).slice(0, 40);
}

/** Signed links: no login needed, but they only ever turn off one email type for one user. */
export function unsubscribeLinks(userId: string, type: NotificationType) {
  const q = new URLSearchParams({ u: userId, t: type, s: sign(userId, type) }).toString();
  const base = env().APP_URL;
  return { page: `${base}/email/unsubscribe?${q}`, oneClick: `${base}/api/email/unsubscribe?${q}` };
}

export function verifyUnsubscribe(u: string | null, t: string | null, s: string | null): { userId: string; type: NotificationType } | null {
  if (!u || !t || !s || !/^[a-f0-9]{24}$/.test(u) || !(NOTIFICATION_TYPES as readonly string[]).includes(t) || !/^[a-f0-9]{40}$/.test(s)) return null;
  if (!canUnsubscribe(t as NotificationType)) return null;
  return safeEqualHex(sign(u, t), s) ? { userId: u, type: t as NotificationType } : null;
}

export async function applyUnsubscribe(userId: string, type: NotificationType) {
  await connectDb();
  await User.updateOne({ _id: userId }, { $addToSet: { emailOptOut: type } });
}

import "server-only";
import { env } from "@/lib/env";
import { connectDb } from "@/server/db";
import { Session, User } from "@/server/models";
import type { Actor } from "./actor";
import { generateToken, hashToken } from "./crypto";

const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export async function createSession(userId: string, role: Actor["role"], userAgent?: string | null) {
  await connectDb();
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env().SESSION_TTL_DAYS * 86400_000);
  await Session.create({
    tokenHash: hashToken(token),
    userId,
    role,
    expiresAt,
    lastSeenAt: now,
    userAgent: userAgent?.slice(0, 200) ?? null,
  });
  return { token, expiresAt };
}

/** Resolve a session token into an Actor. Returns null for any invalid, expired, revoked or deactivated session. */
export async function resolveSession(token: string | undefined | null, now = new Date()): Promise<Actor | null> {
  if (!token || token.length > 100) return null;
  await connectDb();
  const session = await Session.findOne({ tokenHash: hashToken(token) }).lean();
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  const user = await User.findById(session.userId).select("name email role status emailVerifiedAt").lean();
  if (!user || user.status !== "active" || user.role !== session.role) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } });
  }
  return {
    userId: user._id.toString(),
    role: user.role,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    sessionId: session._id.toString(),
  };
}

export async function revokeSessionToken(token: string) {
  await connectDb();
  await Session.updateOne({ tokenHash: hashToken(token) }, { $set: { revokedAt: new Date() } });
}

/** Invalidate every session for a user (password change/reset, deactivation). */
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await connectDb();
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  await Session.updateMany(filter, { $set: { revokedAt: new Date() } });
}

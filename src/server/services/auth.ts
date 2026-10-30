import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { errors, isDuplicateKeyError } from "@/lib/errors";
import { email, nigerianPhone, password, personName } from "@/lib/validation";
import { connectDb } from "@/server/db";
import { AuthToken, User } from "@/server/models";
import { emailProvider, renderEmail } from "@/server/providers/email";
import type { Actor } from "@/server/auth/actor";
import { dummyPasswordCheck, generateToken, hashPassword, hashToken, verifyPassword } from "@/server/auth/crypto";
import { createSession, revokeAllSessions } from "@/server/auth/session";
import { audit } from "./audit";

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;
const VERIFY_TTL_HOURS = 48;
const RESET_TTL_MINUTES = 60;

export const registerSchema = z.object({
  name: personName,
  email,
  password,
  role: z.enum(["landlord", "tenant"]),
  phone: nigerianPhone.optional(),
  acceptPrivacy: z.literal(true, { error: "Please accept the privacy notice to continue" }),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

const GENERIC_REGISTER_MESSAGE =
  "If this email can be registered, we've sent a verification link. Please check your inbox to continue.";

/**
 * Register a landlord or tenant. The response is identical whether or not the email is
 * already registered (no account enumeration). Admins cannot be created here.
 */
export async function register(input: z.infer<typeof registerSchema>) {
  await connectDb();
  const existing = await User.findOne({ email: input.email }).select("_id name email").lean();
  if (existing) {
    const { text, html } = renderEmail({
      heading: "Someone tried to create an account with your email",
      paragraphs: [
        "An attempt was made to register a new account using this email address. You already have an account.",
        "If this was you, sign in or reset your password. If not, you can ignore this email.",
      ],
      cta: { label: "Sign in", url: `${env().APP_URL}/login` },
    });
    await emailProvider().send({ to: { email: existing.email, name: existing.name }, subject: "Account sign-up attempt", text, html }).catch(() => {});
    return { message: GENERIC_REGISTER_MESSAGE };
  }
  let user;
  try {
    user = await User.create({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      privacyAcceptedAt: new Date(),
    });
  } catch (e) {
    if (isDuplicateKeyError(e)) return { message: GENERIC_REGISTER_MESSAGE };
    throw e;
  }
  await audit({ userId: user._id.toString(), role: user.role, name: user.name, email: user.email, emailVerified: false }, "user.registered", "User", user._id.toString(), { role: user.role });
  await sendVerificationEmail(user._id.toString());
  return { message: GENERIC_REGISTER_MESSAGE };
}

export async function sendVerificationEmail(userId: string) {
  await connectDb();
  const user = await User.findById(userId).select("email name emailVerifiedAt").lean();
  if (!user || user.emailVerifiedAt) return;
  const token = generateToken();
  await AuthToken.create({
    type: "email_verify",
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 3600_000),
  });
  const url = `${env().APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const { text, html } = renderEmail({
    heading: `Verify your email for ${env().APP_NAME}`,
    paragraphs: [`Hello ${user.name},`, `Confirm your email address to finish setting up your account. This link expires in ${VERIFY_TTL_HOURS} hours.`],
    cta: { label: "Verify email", url },
  });
  await emailProvider().send({ to: { email: user.email, name: user.name }, subject: "Verify your email", text, html });
}

/** Consume a single-use token atomically. */
async function consumeToken(type: "email_verify" | "password_reset", token: string) {
  if (!token || token.length > 100) return null;
  return AuthToken.findOneAndUpdate(
    { tokenHash: hashToken(token), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
}

export async function verifyEmail(token: string, userAgent?: string | null) {
  await connectDb();
  const t = await consumeToken("email_verify", token);
  if (!t) throw errors.badRequest("This verification link is invalid or has expired. Sign in to request a new one.");
  const user = await User.findOneAndUpdate(
    { _id: t.userId, status: "active" },
    { $set: { emailVerifiedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!user) throw errors.badRequest("This verification link is invalid or has expired.");
  await audit({ userId: user._id.toString(), role: user.role, name: user.name, email: user.email, emailVerified: true }, "user.email_verified", "User", user._id.toString());
  const session = await createSession(user._id.toString(), user.role, userAgent);
  return { user, session };
}

export async function login(input: z.infer<typeof loginSchema>, userAgent?: string | null) {
  await connectDb();
  const user = await User.findOne({ email: input.email }).select("+passwordHash").lean();
  const invalid = errors.unauthenticated("Email or password is incorrect");
  if (!user) {
    await dummyPasswordCheck(input.password);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await dummyPasswordCheck(input.password);
    throw errors.rateLimited("Too many sign-in attempts. Please wait a few minutes or reset your password.");
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil ?? null,
        },
      },
    );
    throw invalid;
  }
  if (user.status !== "active") throw invalid;
  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const session = await createSession(user._id.toString(), user.role, userAgent);
  return { session, role: user.role };
}

export async function requestPasswordReset(emailAddr: string) {
  await connectDb();
  const user = await User.findOne({ email: emailAddr, status: "active" }).select("email name").lean();
  if (!user) return; // same response either way
  const token = generateToken();
  await AuthToken.create({
    type: "password_reset",
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
  });
  const url = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const { text, html } = renderEmail({
    heading: "Reset your password",
    paragraphs: [
      `Hello ${user.name},`,
      `We received a request to reset your password. This link expires in ${RESET_TTL_MINUTES} minutes and can be used once.`,
      "If you didn't request this, you can ignore this email — your password won't change.",
    ],
    cta: { label: "Reset password", url },
  });
  await emailProvider().send({ to: { email: user.email, name: user.name }, subject: "Reset your password", text, html });
}

export async function resetPassword(token: string, newPassword: string) {
  await connectDb();
  const t = await consumeToken("password_reset", token);
  if (!t) throw errors.badRequest("This reset link is invalid or has expired. Please request a new one.");
  const passwordHash = await hashPassword(newPassword);
  // Resetting via an emailed link also proves control of the email address.
  const user = await User.findOneAndUpdate(
    { _id: t.userId, status: "active" },
    { $set: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!user) throw errors.badRequest("This reset link is invalid or has expired.");
  await revokeAllSessions(user._id.toString());
  await AuthToken.updateMany({ userId: user._id, type: "password_reset", usedAt: null }, { $set: { usedAt: new Date() } });
  await audit({ userId: user._id.toString(), role: user.role, name: user.name, email: user.email, emailVerified: true }, "user.password_reset", "User", user._id.toString());
}

export async function changePassword(actor: Actor, currentPassword: string, newPassword: string) {
  await connectDb();
  const user = await User.findById(actor.userId).select("+passwordHash").lean();
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw errors.validation("Current password is incorrect", { currentPassword: ["Current password is incorrect"] });
  }
  await User.updateOne({ _id: actor.userId }, { $set: { passwordHash: await hashPassword(newPassword) } });
  await revokeAllSessions(actor.userId, actor.sessionId);
  await audit(actor, "user.password_changed", "User", actor.userId);
}

/** Phone numbers change only through verification (see services/phone.ts). */
export const profileSchema = z.object({ name: personName });

export async function updateProfile(actor: Actor, input: z.infer<typeof profileSchema>) {
  await connectDb();
  await User.updateOne({ _id: actor.userId }, { $set: { name: input.name } });
  await audit(actor, "user.profile_updated", "User", actor.userId, { fields: ["name"] });
}

/**
 * Deactivate (not delete) an account. Financial and tenancy records are retained for the
 * documented retention period because the other party has a legitimate interest in them.
 */
export async function deactivateAccount(actor: Actor, reason: string | null) {
  await connectDb();
  await User.updateOne(
    { _id: actor.userId },
    { $set: { status: "deactivated", deactivatedAt: new Date(), deactivationReason: reason?.slice(0, 500) ?? null } },
  );
  await revokeAllSessions(actor.userId);
  await audit(actor, "user.deactivated", "User", actor.userId);
}

import { describe, expect, it } from "vitest";
import { AuthToken, Session, User } from "@/server/models";
import { devOutbox } from "@/server/providers/email";
import { resolveSession, revokeSessionToken } from "@/server/auth/session";
import { rateLimit, RULES } from "@/server/auth/rate-limit";
import {
  changePassword,
  deactivateAccount,
  login,
  register,
  registerSchema,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "@/server/services/auth";
import { latestTokenFromEmail, makeUser, PASSWORD } from "../support/factories";

const reg = (over: Partial<Record<string, unknown>> = {}) =>
  registerSchema.parse({ name: "Bola Ade", email: "bola@example.test", password: "s3cure-password", role: "landlord", acceptPrivacy: true, ...over });

describe("registration", () => {
  it("creates an unverified account and emails a verification link", async () => {
    const res = await register(reg());
    expect(res.message).toMatch(/verification link/);
    const u = await User.findOne({ email: "bola@example.test" }).lean();
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.role).toBe("landlord");
    expect(devOutbox.at(-1)?.subject).toBe("Verify your email");
  });

  it("returns the same response for a duplicate email (no enumeration) and doesn't create a second account", async () => {
    const a = await register(reg());
    const b = await register(reg({ name: "Someone Else" }));
    expect(b.message).toBe(a.message);
    expect(await User.countDocuments({ email: "bola@example.test" })).toBe(1);
  });

  it("cannot self-register as admin", () => {
    expect(() => reg({ role: "admin" })).toThrow();
  });

  it("rejects weak passwords", () => {
    expect(() => reg({ password: "short" })).toThrow();
    expect(() => reg({ password: "allletterspassword" })).toThrow();
  });
});

describe("email verification", () => {
  it("verifies once, then the token is spent", async () => {
    await register(reg());
    const token = latestTokenFromEmail("/verify-email");
    const { user, session } = await verifyEmail(token);
    expect(user.emailVerifiedAt).toBeTruthy();
    expect(session.token).toBeTruthy();
    await expect(verifyEmail(token)).rejects.toThrow(/invalid or has expired/);
  });

  it("rejects expired tokens", async () => {
    await register(reg());
    const token = latestTokenFromEmail("/verify-email");
    await AuthToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyEmail(token)).rejects.toThrow();
  });
});

describe("login and sessions", () => {
  it("logs in with correct credentials and resolves the session", async () => {
    const u = await makeUser("landlord");
    const { session } = await login({ email: u.email, password: PASSWORD });
    const actor = await resolveSession(session.token);
    expect(actor?.userId).toBe(u.userId);
    expect(actor?.role).toBe("landlord");
  });

  it("uses one generic error for unknown email and wrong password", async () => {
    const u = await makeUser("tenant");
    const e1 = await login({ email: "nobody@example.test", password: PASSWORD }).catch((e) => e.message);
    const e2 = await login({ email: u.email, password: "wrong-password-1" }).catch((e) => e.message);
    expect(e1).toBe(e2);
  });

  it("locks the account after repeated failures", async () => {
    const u = await makeUser("tenant");
    for (let i = 0; i < 8; i++) await login({ email: u.email, password: "bad-password-1" }).catch(() => {});
    await expect(login({ email: u.email, password: PASSWORD })).rejects.toThrow(/Too many/);
  });

  it("logout invalidates the session server-side", async () => {
    const u = await makeUser("tenant");
    const { session } = await login({ email: u.email, password: PASSWORD });
    await revokeSessionToken(session.token);
    expect(await resolveSession(session.token)).toBeNull();
  });

  it("expired sessions are rejected", async () => {
    const u = await makeUser("tenant");
    const { session } = await login({ email: u.email, password: PASSWORD });
    await Session.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1) } });
    expect(await resolveSession(session.token)).toBeNull();
  });

  it("deactivation revokes access immediately", async () => {
    const u = await makeUser("tenant");
    const { session } = await login({ email: u.email, password: PASSWORD });
    await deactivateAccount(u, "moving away");
    expect(await resolveSession(session.token)).toBeNull();
    await expect(login({ email: u.email, password: PASSWORD })).rejects.toThrow();
  });

  it("a role change in the database invalidates old sessions (no stale privileges)", async () => {
    const u = await makeUser("tenant");
    const { session } = await login({ email: u.email, password: PASSWORD });
    await User.collection.updateOne({ email: u.email }, { $set: { role: "landlord" } });
    expect(await resolveSession(session.token)).toBeNull();
  });
});

describe("password recovery", () => {
  it("resets the password, revokes sessions, and the link is single-use", async () => {
    const u = await makeUser("landlord");
    const { session } = await login({ email: u.email, password: PASSWORD });
    await requestPasswordReset(u.email);
    const token = latestTokenFromEmail("/reset-password");
    await resetPassword(token, "brand-new-pass-9");
    expect(await resolveSession(session.token)).toBeNull();
    await expect(login({ email: u.email, password: PASSWORD })).rejects.toThrow();
    await expect(login({ email: u.email, password: "brand-new-pass-9" })).resolves.toBeTruthy();
    await expect(resetPassword(token, "another-pass-99")).rejects.toThrow();
  });

  it("sends nothing for unknown emails (and doesn't reveal it)", async () => {
    await expect(requestPasswordReset("ghost@example.test")).resolves.toBeUndefined();
    expect(devOutbox.length).toBe(0);
  });

  it("changing password keeps the current session but revokes others", async () => {
    const u = await makeUser("landlord");
    const a = await login({ email: u.email, password: PASSWORD });
    const b = await login({ email: u.email, password: PASSWORD });
    const actorA = (await resolveSession(a.session.token))!;
    await changePassword(actorA, PASSWORD, "different-pass-77");
    expect(await resolveSession(a.session.token)).not.toBeNull();
    expect(await resolveSession(b.session.token)).toBeNull();
  });
});

describe("rate limiting", () => {
  it("blocks after the limit within a window", async () => {
    const rule = { ...RULES.login, limit: 3 };
    for (let i = 0; i < 3; i++) await rateLimit(rule, "1.2.3.4");
    await expect(rateLimit(rule, "1.2.3.4")).rejects.toThrow(/Too many/);
    await expect(rateLimit(rule, "5.6.7.8")).resolves.toBeUndefined();
  });
});

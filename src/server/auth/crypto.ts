import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

/** 256-bit URL-safe random token. Only its SHA-256 hash is stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hmac(secret: string, value: string, algo: "sha256" | "sha512" = "sha256"): string {
  return createHmac(algo, secret).update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const BCRYPT_COST = process.env.NODE_ENV === "test" ? 4 : 12;

/** bcrypt only uses the first 72 bytes; validation rejects longer passwords. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** A valid hash to compare against when the user doesn't exist, so timing doesn't reveal account existence. */
let dummyHash: string | null = null;
export async function dummyPasswordCheck(password: string): Promise<void> {
  dummyHash ??= await bcrypt.hash("dummy-password-for-timing", BCRYPT_COST);
  await bcrypt.compare(password, dummyHash);
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

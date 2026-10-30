import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { AppError, errors } from "@/lib/errors";
import { nigerianPhone } from "@/lib/validation";
import { connectDb } from "@/server/db";
import { PhoneVerification, User } from "@/server/models";
import { enabledTextChannels, ProviderSendError, textProvider } from "@/server/providers/text";
import type { Actor } from "@/server/auth/actor";
import { hmac, safeEqualHex } from "@/server/auth/crypto";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "./audit";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export const sendCodeSchema = z.object({
  phone: nigerianPhone.refine((v): v is string => v !== null, "Enter your phone number"),
  channel: z.enum(["sms", "whatsapp"]),
});
export const verifyCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });
export const channelsSchema = z.object({ sms: z.boolean(), whatsapp: z.boolean() });

function codeHash(userId: string, phone: string, code: string) {
  return hmac(env().APP_SECRET, `phone:${userId}:${phone}:${code}`);
}

/** Send a 6-digit code to prove the user controls the number. Rate limited per user and per number. */
export async function sendPhoneCode(actor: Actor, input: { phone: string; channel: "sms" | "whatsapp" }) {
  await connectDb();
  const provider = textProvider(input.channel);
  if (!provider) throw errors.notConfigured(input.channel === "sms" ? "SMS isn't available yet" : "WhatsApp isn't available yet");
  await rateLimit({ bucket: "phone-code-user", limit: 5, windowSeconds: 3600 }, actor.userId);
  await rateLimit({ bucket: "phone-code-number", limit: 5, windowSeconds: 3600 }, input.phone);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await PhoneVerification.updateMany({ userId: actor.userId, consumedAt: null }, { $set: { consumedAt: new Date() } });
  await PhoneVerification.create({ userId: actor.userId, phone: input.phone, channel: input.channel, codeHash: codeHash(actor.userId, input.phone, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  try {
    await provider.sendCode(input.phone, code);
  } catch (e) {
    if (e instanceof ProviderSendError) throw errors.provider(`We couldn't send the code by ${input.channel === "sms" ? "SMS" : "WhatsApp"}. Check the number or try the other option.`);
    throw e;
  }
  await audit(actor, "phone.code_sent", "User", actor.userId, { channel: input.channel });
  return { sentTo: input.phone.replace(/^(\+234)(\d{3})\d{4}(\d{3})$/, "$1 $2 **** $3"), expiresInMinutes: CODE_TTL_MS / 60_000 };
}

/** Check the code; on success the number is saved as verified and the channel used is switched on. */
export async function verifyPhoneCode(actor: Actor, code: string) {
  await connectDb();
  const v = await PhoneVerification.findOneAndUpdate(
    { userId: actor.userId, consumedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { sort: { createdAt: -1 }, returnDocument: "after" },
  ).lean();
  if (!v) throw errors.validation("This code has expired or too many attempts were made. Request a new code.", { code: ["Request a new code"] });
  if (!safeEqualHex(codeHash(actor.userId, v.phone, code), v.codeHash)) {
    const left = MAX_ATTEMPTS - v.attempts;
    throw errors.validation(left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many attempts. Request a new code.", { code: ["Incorrect code"] });
  }
  const claimed = await PhoneVerification.updateOne({ _id: v._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  if (claimed.modifiedCount !== 1) throw errors.conflict("This code was already used");
  await User.updateOne(
    { _id: actor.userId },
    { $set: { phone: v.phone, phoneVerifiedAt: new Date(), ...(v.channel === "sms" ? { smsEnabled: true } : { whatsappEnabled: true }) } },
  );
  await audit(actor, "phone.verified", "User", actor.userId, { channel: v.channel });
  return { phone: v.phone, channel: v.channel };
}

export async function setTextChannels(actor: Actor, input: z.infer<typeof channelsSchema>) {
  await connectDb();
  const user = await User.findById(actor.userId).select("phone phoneVerifiedAt").lean();
  const available = enabledTextChannels();
  if ((input.sms || input.whatsapp) && !(user?.phone && user.phoneVerifiedAt)) {
    throw errors.validation("Verify your phone number first");
  }
  if ((input.sms && !available.includes("sms")) || (input.whatsapp && !available.includes("whatsapp"))) {
    throw new AppError("NOT_CONFIGURED", "That channel isn't available yet");
  }
  await User.updateOne({ _id: actor.userId }, { $set: { smsEnabled: input.sms, whatsappEnabled: input.whatsapp } });
  await audit(actor, "notifications.text_channels", "User", actor.userId, input);
  return input;
}

export async function removePhone(actor: Actor) {
  await connectDb();
  await User.updateOne({ _id: actor.userId }, { $set: { phone: null, phoneVerifiedAt: null, smsEnabled: false, whatsappEnabled: false } });
  await audit(actor, "phone.removed", "User", actor.userId);
}

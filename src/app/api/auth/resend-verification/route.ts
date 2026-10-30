import { RULES } from "@/server/auth/rate-limit";
import { authed } from "@/server/http";
import { sendVerificationEmail } from "@/server/services/auth";

export const POST = authed({ rateLimit: RULES.verifyEmail }, async ({ actor }) => {
  await sendVerificationEmail(actor.userId);
  return { ok: true };
});

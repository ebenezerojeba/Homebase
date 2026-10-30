import { z } from "zod";
import { email } from "@/lib/validation";
import { RULES } from "@/server/auth/rate-limit";
import { open, parseJson } from "@/server/http";
import { requestPasswordReset } from "@/server/services/auth";

export const POST = open({ rateLimit: RULES.passwordReset }, async ({ req }) => {
  const input = await parseJson(req, z.object({ email }));
  await requestPasswordReset(input.email);
  return { message: "If an account exists for that email, we have sent a reset link." };
});

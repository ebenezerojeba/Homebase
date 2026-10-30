import { z } from "zod";
import { password } from "@/lib/validation";
import { RULES } from "@/server/auth/rate-limit";
import { open, parseJson } from "@/server/http";
import { resetPassword } from "@/server/services/auth";

export const POST = open({ rateLimit: RULES.passwordReset }, async ({ req }) => {
  const input = await parseJson(req, z.object({ token: z.string().min(10).max(100), password }));
  await resetPassword(input.token, input.password);
  return { ok: true };
});

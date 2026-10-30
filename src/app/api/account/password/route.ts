import { z } from "zod";
import { password } from "@/lib/validation";
import { RULES } from "@/server/auth/rate-limit";
import { authed, parseJson } from "@/server/http";
import { changePassword } from "@/server/services/auth";

export const POST = authed({ rateLimit: RULES.passwordReset }, async ({ req, actor }) => {
  const input = await parseJson(req, z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }));
  await changePassword(actor, input.currentPassword, input.newPassword);
  return { ok: true };
});

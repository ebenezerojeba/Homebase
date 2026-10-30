import { z } from "zod";
import { clearSessionCookie } from "@/server/auth/current";
import { authed, parseJson } from "@/server/http";
import { deactivateAccount } from "@/server/services/auth";

export const POST = authed({ roles: ["landlord", "tenant"] }, async ({ req, actor }) => {
  const input = await parseJson(req, z.object({ confirm: z.literal("DEACTIVATE"), reason: z.string().max(500).optional() }));
  await deactivateAccount(actor, input.reason ?? null);
  await clearSessionCookie();
  return { ok: true };
});

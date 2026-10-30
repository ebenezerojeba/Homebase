import { z } from "zod";
import { authed, parseJson } from "@/server/http";
import { voidExpense } from "@/server/services/records";

export const POST = authed<{ id: string }>({ roles: ["landlord"] }, async ({ req, actor, params }) => {
  const { reason } = await parseJson(req, z.object({ reason: z.string().trim().min(3).max(500) }));
  await voidExpense(actor, params.id, reason);
  return { ok: true };
});

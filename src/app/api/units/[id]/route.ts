import { z } from "zod";
import { authed, parseJson } from "@/server/http";
import { setUnitArchived, unitSchema, updateUnit } from "@/server/services/properties";

export const PATCH = authed<{ id: string }>({ roles: ["landlord"] }, async ({ req, actor, params }) => {
  await updateUnit(actor, params.id, await parseJson(req, unitSchema));
  return { ok: true };
});

export const POST = authed<{ id: string }>({ roles: ["landlord"] }, async ({ req, actor, params }) => {
  const { archived } = await parseJson(req, z.object({ archived: z.boolean() }));
  await setUnitArchived(actor, params.id, archived);
  return { ok: true };
});

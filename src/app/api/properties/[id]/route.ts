import { z } from "zod";
import { authed, parseJson } from "@/server/http";
import { propertySchema, setPropertyArchived, updateProperty } from "@/server/services/properties";

export const PATCH = authed<{ id: string }>({ roles: ["landlord"] }, async ({ req, actor, params }) => {
  await updateProperty(actor, params.id, await parseJson(req, propertySchema));
  return { ok: true };
});

export const POST = authed<{ id: string }>({ roles: ["landlord"] }, async ({ req, actor, params }) => {
  const { archived } = await parseJson(req, z.object({ archived: z.boolean() }));
  await setPropertyArchived(actor, params.id, archived);
  return { ok: true };
});

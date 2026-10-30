import { authed, parseJson } from "@/server/http";
import { createUnit, unitSchema } from "@/server/services/properties";

export const POST = authed<{ id: string }>({ roles: ["landlord"] }, async ({ req, actor, params }) => ({
  unit: await createUnit(actor, params.id, await parseJson(req, unitSchema)),
}));

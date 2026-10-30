import { authed, parseJson } from "@/server/http";
import { inspectionResponseSchema, respondToInspection } from "@/server/services/records";

export const POST = authed<{ id: string }>({ roles: ["tenant"] }, async ({ req, actor, params }) => {
  await respondToInspection(actor, params.id, await parseJson(req, inspectionResponseSchema));
  return { ok: true };
});

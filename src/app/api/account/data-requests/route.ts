import { authed, parseJson } from "@/server/http";
import { createDataRequest, dataRequestSchema, listMyDataRequests } from "@/server/services/admin";

export const GET = authed({}, async ({ actor }) => ({ items: await listMyDataRequests(actor) }));
export const POST = authed({}, async ({ req, actor }) => ({ request: await createDataRequest(actor, await parseJson(req, dataRequestSchema)) }));

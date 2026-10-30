import { z } from "zod";
import { objectId, pagination } from "@/lib/validation";
import { authed, parseJson, parseQuery } from "@/server/http";
import { listNotifications, markNotificationsRead } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

export const GET = authed({}, async ({ req, actor }) => listNotifications(actor, parseQuery(req, pagination)));

export const POST = authed({}, async ({ req, actor }) => {
  const input = await parseJson(req, z.object({ ids: z.union([z.literal("all"), z.array(objectId).min(1).max(100)]) }));
  return markNotificationsRead(actor, input.ids);
});

import { z } from "zod";
import { NOTIFICATION_TYPES } from "@/server/models";
import { authed, parseJson } from "@/server/http";
import { updateEmailPreferences } from "@/server/services/notifications";

export const PUT = authed({}, async ({ req, actor }) => {
  const input = await parseJson(req, z.object({ emailOptOut: z.array(z.enum(NOTIFICATION_TYPES)).max(20) }));
  return updateEmailPreferences(actor, input.emailOptOut);
});

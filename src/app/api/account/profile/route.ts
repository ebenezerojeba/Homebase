import { authed, parseJson } from "@/server/http";
import { profileSchema, updateProfile } from "@/server/services/auth";

export const PATCH = authed({}, async ({ req, actor }) => {
  await updateProfile(actor, await parseJson(req, profileSchema));
  return { ok: true };
});

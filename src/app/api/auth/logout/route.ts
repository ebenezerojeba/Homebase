import { clearSessionCookie, readSessionToken } from "@/server/auth/current";
import { revokeSessionToken } from "@/server/auth/session";
import { open } from "@/server/http";

export const POST = open({}, async () => {
  const token = await readSessionToken();
  if (token) await revokeSessionToken(token);
  await clearSessionCookie();
  return { ok: true };
});

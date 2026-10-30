import { setSessionCookie } from "@/server/auth/current";
import { RULES } from "@/server/auth/rate-limit";
import { open, parseJson } from "@/server/http";
import { acceptInvitation, acceptInviteSchema } from "@/server/services/tenancy";

export const POST = open({ rateLimit: RULES.inviteAccept }, async ({ req, actor }) => {
  const input = await parseJson(req, acceptInviteSchema);
  const res = await acceptInvitation(actor, input, req.headers.get("user-agent"));
  if (res.session) await setSessionCookie(res.session.token, res.session.expiresAt);
  return { tenancyId: res.tenancyId, redirectTo: "/tenant" };
});

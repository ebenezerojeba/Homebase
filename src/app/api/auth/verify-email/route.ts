import { z } from "zod";
import { homeFor, setSessionCookie } from "@/server/auth/current";
import { RULES } from "@/server/auth/rate-limit";
import { open, parseJson } from "@/server/http";
import { verifyEmail } from "@/server/services/auth";

export const POST = open({ rateLimit: RULES.verifyEmail }, async ({ req }) => {
  const { token } = await parseJson(req, z.object({ token: z.string().min(10).max(100) }));
  const { user, session } = await verifyEmail(token, req.headers.get("user-agent"));
  await setSessionCookie(session.token, session.expiresAt);
  return { redirectTo: homeFor(user.role) };
});

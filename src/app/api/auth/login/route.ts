import { homeFor, setSessionCookie } from "@/server/auth/current";
import { RULES, rateLimit } from "@/server/auth/rate-limit";
import { open, parseJson } from "@/server/http";
import { login, loginSchema } from "@/server/services/auth";

export const POST = open({ rateLimit: RULES.login }, async ({ req }) => {
  const input = await parseJson(req, loginSchema);
  await rateLimit(RULES.loginEmail, input.email);
  const { session, role } = await login(input, req.headers.get("user-agent"));
  await setSessionCookie(session.token, session.expiresAt);
  return { redirectTo: homeFor(role) };
});

import { RULES } from "@/server/auth/rate-limit";
import { authed, parseJson } from "@/server/http";
import { createTenancy, createTenancySchema } from "@/server/services/tenancy";

export const POST = authed({ roles: ["landlord"], requireVerifiedEmail: true, rateLimit: RULES.invite }, async ({ req, actor }) => {
  const t = await createTenancy(actor, await parseJson(req, createTenancySchema));
  return { tenancyId: t._id.toString() };
});

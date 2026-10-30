import { RULES } from "@/server/auth/rate-limit";
import { authed, parseJson } from "@/server/http";
import { initiateOnlinePayment, initiateSchema } from "@/server/services/payments";

/** Starts checkout. The amount, tenancy and charges are validated and bound server-side. */
export const POST = authed({ roles: ["tenant"], rateLimit: RULES.paymentInit }, async ({ req, actor }) => {
  const r = await initiateOnlinePayment(actor, await parseJson(req, initiateSchema));
  return { authorizationUrl: r.authorizationUrl, reference: r.reference };
});

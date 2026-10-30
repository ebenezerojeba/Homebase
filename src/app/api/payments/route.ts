import { RULES } from "@/server/auth/rate-limit";
import { authed, parseJson, parseQuery } from "@/server/http";
import { claimSchema, listPayments, paymentFilterSchema, recordLandlordPayment, recordPaymentSchema, submitPaymentClaim } from "@/server/services/payments";

export const GET = authed({}, async ({ req, actor }) => listPayments(actor, parseQuery(req, paymentFilterSchema)));

/** Tenants submit external payment claims; landlords record payments they received (cash, transfer, POS). */
export const POST = authed({ roles: ["tenant", "landlord"], rateLimit: RULES.paymentClaim }, async ({ req, actor }) => {
  if (actor.role === "tenant") {
    const p = await submitPaymentClaim(actor, await parseJson(req, claimSchema));
    return { paymentId: p._id.toString(), status: p.status };
  }
  const p = await recordLandlordPayment(actor, await parseJson(req, recordPaymentSchema));
  return { paymentId: p._id.toString(), status: p.status };
});

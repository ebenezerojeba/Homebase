import { z } from "zod";
import { errors } from "@/lib/errors";
import { authed, parseJson } from "@/server/http";
import { approvePaymentClaim, checkPaymentStatus, rejectPaymentClaim, rejectSchema, reversePayment } from "@/server/services/payments";

type P = { id: string; action: string };

export const POST = authed<P>({}, async ({ req, actor, params }) => {
  switch (params.action) {
    case "approve": {
      if (actor.role !== "landlord") throw errors.forbidden();
      const { note } = await parseJson(req, z.object({ note: z.string().max(500).optional() }));
      const r = await approvePaymentClaim(actor, params.id, note);
      return { status: r.payment.status, alreadyConfirmed: r.alreadyConfirmed };
    }
    case "reject": {
      if (actor.role !== "landlord") throw errors.forbidden();
      const { reason } = await parseJson(req, rejectSchema);
      await rejectPaymentClaim(actor, params.id, reason);
      return { status: "rejected" };
    }
    case "reverse": {
      if (actor.role !== "landlord") throw errors.forbidden();
      const { reason } = await parseJson(req, rejectSchema);
      await reversePayment(actor, params.id, reason);
      return { status: "reversed" };
    }
    case "check":
      return { payment: await checkPaymentStatus(actor, params.id) };
    default:
      throw errors.notFound();
  }
});

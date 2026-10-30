import { NextResponse } from "next/server";
import { z } from "zod";
import { errors } from "@/lib/errors";
import { RULES } from "@/server/auth/rate-limit";
import { authed, parseJson, parseQuery } from "@/server/http";
import { reconcileTenancy } from "@/server/services/ledger";
import { getTimeline, timelineQuery } from "@/server/services/records";
import {
  changeRent,
  changeRentSchema,
  createInvitation,
  endTenancy,
  endTenancySchema,
  renewTenancy,
  renewTenancySchema,
  revokeInvitation,
  updateTerms,
  updateTermsSchema,
} from "@/server/services/tenancy";

type P = { id: string; action: string };

/** Landlord tenancy actions: invite, revoke-invite, rent, terms, end, renew. */
export const POST = authed<P>({ roles: ["landlord"], requireVerifiedEmail: true }, async ({ req, actor, params }) => {
  switch (params.action) {
    case "invite": {
      const { rateLimit } = await import("@/server/auth/rate-limit");
      await rateLimit(RULES.invite, actor.userId);
      const { sendEmail } = await parseJson(req, z.object({ sendEmail: z.boolean().default(true) })).catch(() => ({ sendEmail: true }));
      const r = await createInvitation(actor, params.id, { sendEmail });
      // The link goes only to the landlord who owns the tenancy (checked in createInvitation).
      return { emailed: r.emailed, url: r.url, expiresAt: r.expiresAt, expiresInDays: r.expiresInDays };
    }
    case "revoke-invite":
      await revokeInvitation(actor, params.id);
      return { ok: true };
    case "rent":
      await changeRent(actor, params.id, await parseJson(req, changeRentSchema));
      return { ok: true };
    case "terms":
      await updateTerms(actor, params.id, await parseJson(req, updateTermsSchema));
      return { ok: true };
    case "end":
      await endTenancy(actor, params.id, await parseJson(req, endTenancySchema));
      return { ok: true };
    case "renew":
      return renewTenancy(actor, params.id, await parseJson(req, renewTenancySchema));
    default:
      throw errors.notFound();
  }
});

/** Read views available to both parties (timeline) or the landlord (reconciliation). */
export const GET = authed<P>({}, async ({ req, actor, params }) => {
  switch (params.action) {
    case "timeline": {
      const q = parseQuery(req, timelineQuery);
      const r = await getTimeline(actor, params.id, q);
      return NextResponse.json({ events: r.events, hasMore: r.hasMore, nextBefore: r.nextBefore });
    }
    case "reconcile":
      return reconcileTenancy(actor, params.id);
    default:
      throw errors.notFound();
  }
});

export const dynamic = "force-dynamic";

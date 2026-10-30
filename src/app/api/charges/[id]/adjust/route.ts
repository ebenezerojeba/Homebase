import { z } from "zod";
import { objectId } from "@/lib/validation";
import { authed, parseJson } from "@/server/http";
import { adjustCharge } from "@/server/services/ledger";

const schema = z.object({
  amountKobo: z.number().int().refine((n) => n !== 0, "Enter a non-zero amount").refine((n) => Math.abs(n) <= 100_000_000_000_00, "Amount is too large"),
  reason: z.string().trim().min(5, "Explain the adjustment").max(500),
  correctsAdjustmentId: objectId.optional(),
});

export const POST = authed<{ id: string }>({ roles: ["landlord"] }, async ({ req, actor, params }) => adjustCharge(actor, params.id, await parseJson(req, schema)));

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { errors } from "@/lib/errors";
import { authed, parseJson } from "@/server/http";
import { MockProvider, MockTransaction, paymentProvider } from "@/server/providers/payments";
import { processWebhook } from "@/server/services/payments";
import { Payment } from "@/server/models";

/**
 * Sandbox only (PAYMENT_PROVIDER=mock). Simulates the tenant finishing checkout at the provider,
 * then delivers a signed webhook through the same verification path a real provider uses.
 */
export const POST = authed({ roles: ["tenant"] }, async ({ req, actor }) => {
  if (env().PAYMENT_PROVIDER !== "mock") throw errors.notFound();
  const input = await parseJson(req, z.object({ reference: z.string().min(5).max(100), outcome: z.enum(["success", "failed", "abandoned", "wrong_amount"]) }));
  const payment = await Payment.findOne({ providerReference: input.reference, tenantId: actor.userId }).lean();
  if (!payment) throw errors.notFound();
  const tx = await MockTransaction.findOne({ reference: input.reference });
  if (!tx) throw errors.notFound();
  tx.status = input.outcome === "wrong_amount" ? "success" : input.outcome;
  if (input.outcome === "wrong_amount") tx.amountKobo = Math.max(1, Math.floor(payment.amountKobo / 2));
  tx.updatedAt = new Date();
  await tx.save();
  const provider = paymentProvider() as MockProvider;
  const raw = JSON.stringify({ event: tx.status === "success" ? "charge.success" : "charge.failed", data: { id: Date.now(), reference: input.reference } });
  const res = await processWebhook(provider, raw, provider.sign(raw));
  return NextResponse.json({ result: res.result, redirectTo: `/tenant/payments/callback?reference=${encodeURIComponent(input.reference)}` });
});

export async function GET(_req: NextRequest) {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}

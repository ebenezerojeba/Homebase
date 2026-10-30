import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { formatKobo } from "@/lib/money";
import { requirePageActor } from "@/server/auth/current";
import { connectDb } from "@/server/db";
import { Payment } from "@/server/models";
import { verifyAndApplyProviderPayment } from "@/server/services/payments";

export const metadata = { title: "Payment status" };
export const dynamic = "force-dynamic";

/**
 * Landing page after checkout. The redirect itself proves nothing: we look up the payment
 * (it must belong to this tenant) and verify it server-to-server with the provider.
 */
export default async function CallbackPage({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const actor = await requirePageActor("tenant");
  const sp = await searchParams;
  const reference = (sp.reference ?? sp.trxref ?? "").slice(0, 100);
  await connectDb();
  const owned = reference ? await Payment.findOne({ providerReference: reference, tenantId: actor.userId }).select("_id").lean() : null;
  if (owned && reference) {
    await verifyAndApplyProviderPayment(reference).catch(() => null);
  }
  const p = owned ? await Payment.findById(owned._id).select("status amountKobo receiptId flags").lean() : null;
  const state = !p ? "unknown" : p.status === "confirmed" ? "ok" : p.status === "failed" || p.status === "abandoned" ? "failed" : "pending";
  return (
    <Card className="mx-auto mt-8 max-w-lg">
      <CardBody className="space-y-4 py-10 text-center">
        {state === "ok" ? <CheckCircle2 className="mx-auto size-12 text-emerald-700" aria-hidden /> : state === "failed" ? <XCircle className="mx-auto size-12 text-rose-700" aria-hidden /> : <Clock className="mx-auto size-12 text-amber-700" aria-hidden />}
        <h1 className="text-xl font-semibold">
          {state === "ok" ? "Payment confirmed" : state === "failed" ? "Payment not completed" : state === "pending" ? "Waiting for confirmation" : "Payment not found"}
        </h1>
        <p className="text-sm text-ink-600">
          {state === "ok" && p
            ? `${formatKobo(p.amountKobo)} was confirmed by the payment provider and applied to your rent. Your receipt is ready.`
            : state === "failed"
              ? "No money was taken for this attempt, or the provider reported it as unsuccessful. You can try again."
              : state === "pending"
                ? p?.flags.length
                  ? "The provider reported something we couldn't match automatically. We haven't credited it yet — your landlord will review it."
                  : "The provider hasn't confirmed this payment yet. We'll update your balance automatically as soon as they do — you don't need to pay again."
                : "We couldn't find this payment on your account."}
        </p>
        <div className="flex justify-center gap-2">
          {state === "ok" && p?.receiptId ? <ButtonLink href={`/tenant/receipts/${p.receiptId}`}>View receipt</ButtonLink> : null}
          <ButtonLink href="/tenant/payments" variant="outline">Back to payments</ButtonLink>
        </div>
        {state === "pending" ? <p className="text-xs text-ink-500"><Link href={`/tenant/payments/callback?reference=${encodeURIComponent(reference)}`} className="underline">Check again</Link></p> : null}
      </CardBody>
    </Card>
  );
}

import { notFound } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { MockCheckout } from "@/components/payments/mock-checkout";
import { Alert } from "@/components/ui/feedback";
import { env } from "@/lib/env";
import { formatKobo } from "@/lib/money";
import { requirePageActor } from "@/server/auth/current";
import { connectDb } from "@/server/db";
import { Payment } from "@/server/models";

export const metadata = { title: "Sandbox checkout" };

/** Development sandbox standing in for the provider's hosted checkout. Disabled unless PAYMENT_PROVIDER=mock. */
export default async function MockCheckoutPage({ params }: { params: Promise<{ reference: string }> }) {
  if (env().PAYMENT_PROVIDER !== "mock") notFound();
  const actor = await requirePageActor("tenant");
  const { reference } = await params;
  await connectDb();
  const p = await Payment.findOne({ providerReference: decodeURIComponent(reference), tenantId: actor.userId }).lean();
  if (!p) notFound();
  return (
    <AuthCard title="Sandbox checkout" subtitle={`Pay ${formatKobo(p.amountKobo)}`}>
      <Alert tone="warning" title="Test mode — no real money moves">
        This page simulates the payment provider. Choose an outcome to see how the app verifies it.
      </Alert>
      <MockCheckout reference={p.providerReference!} />
    </AuthCard>
  );
}

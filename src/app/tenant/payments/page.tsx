import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { BalanceCards, PaymentsTable } from "@/components/shared/ledger";
import { PayOnline, ReportPaymentDialog } from "@/components/tenant/payment-forms";
import { TenancySwitcher } from "@/components/tenant/tenancy-switcher";
import { formatDate } from "@/lib/dates";
import { resolveTenantTenancy } from "@/lib/tenant-context";
import { requirePageActor } from "@/server/auth/current";
import { onlinePaymentsEnabled } from "@/server/providers/payments";
import { computeBalance, listCharges } from "@/server/services/ledger";
import { listPayments } from "@/server/services/payments";

export const metadata = { title: "Rent and payments" };

export default async function TenantPaymentsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const actor = await requirePageActor("tenant");
  const { tenancy: t, all } = await resolveTenantTenancy(actor, (await searchParams).t);
  if (!t) return <EmptyState title="No tenancy yet" description="Accept your landlord's invitation to pay rent here." />;
  const id = t._id.toString();
  const [balance, charges, payments] = await Promise.all([computeBalance(id), listCharges(actor, id), listPayments(actor, { tenancyId: id, page: 1, pageSize: 100 })]);
  const open = charges.filter((c) => c.status === "open" || c.status === "partially_paid").map((c) => ({ id: c._id.toString(), label: `${c.label} due ${formatDate(c.dueDate)}`, dueKobo: c.amountKobo - c.allocatedKobo }));
  const online = onlinePaymentsEnabled();
  return (
    <>
      <PageHeader
        title="Rent and payments"
        description={`${t.propertyId?.name} · ${t.unitId?.unitNumber}`}
        actions={t.status === "active" ? <><PayOnline tenancyId={id} charges={open} enabled={online} /><ReportPaymentDialog tenancyId={id} charges={open} /></> : null}
      />
      <TenancySwitcher all={all} currentId={id} base="/tenant/payments" />
      {!online ? <Alert tone="info" className="mb-6">Online payment isn&apos;t enabled yet. Pay your landlord by transfer and use &ldquo;I paid by transfer&rdquo; so they can confirm it.</Alert> : null}
      <BalanceCards b={balance} role="tenant" />
      <Card className="mt-6">
        <CardHeader title="Payment history" description="Reported payments count once your landlord (or the payment provider) confirms them." />
        <CardBody>
          {payments.items.length ? <PaymentsTable payments={payments.items} role="tenant" /> : <p className="text-sm text-ink-500">No payments yet.</p>}
        </CardBody>
      </Card>
    </>
  );
}

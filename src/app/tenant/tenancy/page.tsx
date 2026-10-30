import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/misc";
import { ChargesTable } from "@/components/shared/ledger";
import { TenancySwitcher } from "@/components/tenant/tenancy-switcher";
import { formatDate, formatDateTime, todayInBusinessTz } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { resolveTenantTenancy } from "@/lib/tenant-context";
import { requirePageActor } from "@/server/auth/current";
import { listCharges } from "@/server/services/ledger";
import { listInspections } from "@/server/services/records";

export const metadata = { title: "My tenancy" };

export default async function TenantTenancyPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const actor = await requirePageActor("tenant");
  const { tenancy: t, all } = await resolveTenantTenancy(actor, (await searchParams).t);
  if (!t) return <EmptyState title="No tenancy yet" description="Accept your landlord's invitation to see your tenancy here." />;
  const id = t._id.toString();
  const [charges, inspections] = await Promise.all([listCharges(actor, id), listInspections(actor, id)]);
  return (
    <>
      <PageHeader title="My tenancy" description={`${t.propertyId?.name} · ${t.unitId?.unitNumber}`} actions={<StatusBadge status={t.status} />} />
      <TenancySwitcher all={all} currentId={id} base="/tenant/tenancy" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recorded terms" description={t.termsAcknowledgedAt ? `You confirmed reviewing these on ${formatDateTime(t.termsAcknowledgedAt)}` : undefined} />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Address", value: `${t.propertyId?.address.line1}, ${t.propertyId?.address.city}, ${t.propertyId?.address.state}` },
                { label: "Unit", value: `${t.unitId?.unitNumber} (${label(t.unitId?.unitType)})` },
                { label: "Start", value: formatDate(t.startDate, "long") },
                { label: "End", value: formatDate(t.endDate, "long") },
                { label: "Paid", value: label(t.frequency) },
                { label: "Grace period", value: `${t.gracePeriodDays} days after each due date` },
                { label: "Deposit", value: t.depositAmountKobo ? <Money kobo={t.depositAmountKobo} /> : "None recorded" },
                { label: "Other charges", value: t.agreedCharges.length ? t.agreedCharges.map((c) => `${c.label}: ${formatKobo(c.amountKobo)} (${c.recurrence === "recurring" ? "each period" : "once"})`).join("; ") : "None" },
              ]}
            />
            <h3 className="mt-6 text-sm font-semibold">Rent history</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {t.rentSchedule.map((r) => <li key={r._id.toString()} className="tabular">From {formatDate(r.effectiveFrom)}: {formatKobo(r.amountKobo)}{r.note ? ` — ${r.note}` : ""}</li>)}
            </ul>
            <p className="mt-4 text-xs text-ink-500">If anything here doesn&apos;t match what you agreed, message your landlord. Every change they make appears on the shared tenancy record.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Landlord" />
          <CardBody className="space-y-1 text-sm">
            <p className="font-medium">{t.landlordId?.name}</p>
            <p className="text-ink-600">{t.landlordId?.email}</p>
            {t.landlordId?.phone ? <p className="text-ink-600">{t.landlordId.phone}</p> : null}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Rent schedule" description="Each billing period and what's been paid against it" />
        <CardBody>{charges.length ? <ChargesTable charges={charges} grace={t.gracePeriodDays} today={todayInBusinessTz()} /> : <p className="text-sm text-ink-500">No charges yet.</p>}</CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Inspections" />
        <CardBody>
          {inspections.length ? (
            <ul className="space-y-2">
              {inspections.map((i) => (
                <li key={i._id.toString()} className="flex items-center justify-between text-sm">
                  <Link href={`/tenant/tenancy/inspections/${i._id}`} className="font-medium text-emerald-700 hover:underline">{label(i.type)} · {formatDate(i.inspectedOn)}</Link>
                  <StatusBadge status={i.tenantResponse.status === "pending" ? "awaiting_tenant" : i.tenantResponse.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">No inspections recorded.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}

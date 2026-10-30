import { Wallet } from "lucide-react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { FilterBar, Pagination } from "@/components/ui/misc";
import { PaymentsTable } from "@/components/shared/ledger";
import { RecordPaymentDialog, ReversePaymentButton } from "@/components/landlord/tenancy-forms";
import { requirePageActor } from "@/server/auth/current";
import { listPayments, paymentFilterSchema } from "@/server/services/payments";
import { listProperties } from "@/server/services/properties";
import { listTenancies } from "@/server/services/tenancy";

export const metadata = { title: "Rent and payments" };

export default async function LandlordPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requirePageActor("landlord");
  const sp = await searchParams;
  const parsed = paymentFilterSchema.safeParse(Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "record")));
  const f = parsed.success ? parsed.data : paymentFilterSchema.parse({});
  const [{ items, total }, properties, tenancies] = await Promise.all([
    listPayments(actor, f),
    listProperties(actor),
    listTenancies(actor, { status: "active", page: 1, pageSize: 100 }),
  ]);
  const qs = (page: number) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "page" && k !== "record")), page: String(page) })}`;
  const exportQs = new URLSearchParams({ kind: "payments", ...(f.status ? { status: f.status } : {}), ...(f.propertyId ? { propertyId: f.propertyId } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) });
  return (
    <>
      <PageHeader
        title="Rent and payments"
        description="Every payment, who recorded it, and whether it's confirmed"
        actions={
          <>
            <a href={`/api/exports?${exportQs}`} className={buttonClass("outline")}>Export CSV</a>
            <Link href="/landlord/reconciliation" className={buttonClass("outline")}>Payment review</Link>
            {tenancies.items.length ? (
              <RecordPaymentDialog defaultOpen={sp.record === "1"} tenancies={tenancies.items.map((t) => ({ id: t._id.toString(), label: `${t.tenantName} · ${t.propertyId?.name} ${t.unitId?.unitNumber}` }))} trigger={<button className={buttonClass("primary")}>Record payment</button>} />
            ) : null}
          </>
        }
      />
      <FilterBar>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">Status</span>
          <Select name="status" defaultValue={f.status ?? ""} className="w-48">
            <option value="">Any status</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending_verification">Awaiting review</option>
            <option value="pending">Awaiting provider</option>
            <option value="rejected">Not confirmed</option>
            <option value="failed">Failed</option>
            <option value="reversed">Reversed</option>
            <option value="refunded">Refunded</option>
          </Select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">Property</span>
          <Select name="propertyId" defaultValue={f.propertyId ?? ""} className="w-48">
            <option value="">All</option>
            {properties.map((p) => <option key={p._id.toString()} value={p._id.toString()}>{p.name}</option>)}
          </Select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">From</span><Input type="date" name="from" defaultValue={f.from} className="w-40" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">To</span><Input type="date" name="to" defaultValue={f.to} className="w-40" /></label>
        <Button type="submit" variant="outline">Apply</Button>
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState icon={<Wallet className="size-6" />} title="No payments match" description="Payments appear here when tenants pay online, report a transfer, or you record one." />
      ) : (
        <Card>
          <CardBody>
            <PaymentsTable
              payments={items}
              role="landlord"
              showTenant
              actions={(p) =>
                p.status === "confirmed" && p.source !== "provider" ? <ReversePaymentButton paymentId={p._id.toString()} /> : p.status === "pending_verification" ? <Link className="text-sm font-medium text-emerald-700 hover:underline" href={`/landlord/reconciliation?focus=${p._id}`}>Review</Link> : null
              }
            />
            <Pagination page={f.page} pageSize={f.pageSize} total={total} hrefFor={qs} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

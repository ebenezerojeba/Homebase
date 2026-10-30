import Link from "next/link";
import { Receipt as ReceiptIcon } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money, Table, Td, Th } from "@/components/ui/misc";
import { TenancySwitcher } from "@/components/tenant/tenancy-switcher";
import { formatDate, toISODate } from "@/lib/dates";
import { label } from "@/lib/nigeria";
import { resolveTenantTenancy } from "@/lib/tenant-context";
import { requirePageActor } from "@/server/auth/current";
import { listReceipts } from "@/server/services/payments";

export const metadata = { title: "Receipts and statements" };

export default async function TenantReceiptsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const actor = await requirePageActor("tenant");
  const { tenancy: t, all } = await resolveTenantTenancy(actor, (await searchParams).t);
  if (!t) return <EmptyState title="No tenancy yet" />;
  const id = t._id.toString();
  const { items } = await listReceipts(actor, { tenancyId: id, page: 1, pageSize: 100 });
  const range = `from=${toISODate(t.startDate)}`;
  return (
    <>
      <PageHeader title="Receipts and statements" description="Your records to keep — download or print any time" />
      <TenancySwitcher all={all} currentId={id} base="/tenant/receipts" />
      <Card>
        <CardHeader title="Statements and exports" />
        <CardBody className="flex flex-wrap gap-2">
          <Link href={`/print/statement/${id}?${range}`} target="_blank" className={buttonClass("outline", "sm")}>Printable statement</Link>
          <a href={`/api/exports?kind=statement&tenancyId=${id}&${range}`} className={buttonClass("outline", "sm")}>Statement (CSV)</a>
          <a href={`/api/exports?kind=payments&tenancyId=${id}&${range}`} className={buttonClass("outline", "sm")}>Payments (CSV)</a>
          <a href={`/api/exports?kind=receipts&tenancyId=${id}&${range}`} className={buttonClass("outline", "sm")}>Receipts (CSV)</a>
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Receipts" description="Issued only for confirmed payments" />
        <CardBody>
          {items.length ? (
            <Table>
              <thead><tr><Th>Receipt</Th><Th>Paid on</Th><Th className="text-right">Amount</Th><Th>Method</Th><Th>Status</Th></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r._id.toString()}>
                    <Td><Link href={`/tenant/receipts/${r._id}`} className="font-mono text-sm text-emerald-700 hover:underline">{r.receiptNumber}</Link></Td>
                    <Td>{formatDate(r.paidOn)}</Td>
                    <Td className="text-right"><Money kobo={r.amountKobo} /></Td>
                    <Td>{label(r.method)}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<ReceiptIcon className="size-6" />} title="No receipts yet" description="Receipts appear here once a payment is confirmed." className="border-0" />
          )}
        </CardBody>
      </Card>
    </>
  );
}

import { FileText } from "lucide-react";
import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination, Tabs } from "@/components/ui/misc";
import { DocumentList } from "@/components/shared/documents";
import type { AssetKind } from "@/server/models";
import { requirePageActor } from "@/server/auth/current";
import { listLandlordDocuments } from "@/server/services/assets";

export const metadata = { title: "Documents" };

const KINDS: [string, string][] = [
  ["all", "All"],
  ["agreement", "Agreements"],
  ["payment_proof", "Payment evidence"],
  ["tenancy_document", "Tenancy documents"],
  ["inspection_photo", "Inspection photos"],
  ["property_document", "Property documents"],
  ["expense_receipt", "Expense receipts"],
];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string }> }) {
  const actor = await requirePageActor("landlord");
  const sp = await searchParams;
  const kind = KINDS.some(([k]) => k === sp.kind) && sp.kind !== "all" ? (sp.kind as AssetKind) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total } = await listLandlordDocuments(actor, { kind, page, pageSize: 30 });
  return (
    <>
      <PageHeader title="Documents" description="Private files across your tenancies. Upload agreements from each tenancy's Documents tab." />
      <Tabs active={sp.kind ?? "all"} items={KINDS.map(([k, l]) => ({ key: k, label: l, href: `?kind=${k}` }))} />
      {items.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" />} title="No documents" description="Agreements, payment evidence and inspection photos will be listed here." />
      ) : (
        <Card>
          <CardBody>
            <DocumentList
              docs={items}
              extra={(d) => {
                const it = items.find((x) => x._id.toString() === d._id.toString());
                return it?.tenancyId ? (
                  <Link href={`/landlord/tenancies/${it.tenancyId._id}?tab=documents`} className="text-xs text-ink-500 hover:underline">{it.tenancyId.tenantName}</Link>
                ) : it?.propertyId ? (
                  <span className="text-xs text-ink-500">{it.propertyId.name}</span>
                ) : null;
              }}
            />
            <Pagination page={page} pageSize={30} total={total} hrefFor={(p) => `?kind=${sp.kind ?? "all"}&page=${p}`} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

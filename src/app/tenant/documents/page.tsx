import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { DocumentList } from "@/components/shared/documents";
import { TenancySwitcher } from "@/components/tenant/tenancy-switcher";
import { TenantDocUpload } from "@/components/tenant/doc-upload";
import { resolveTenantTenancy } from "@/lib/tenant-context";
import { requirePageActor } from "@/server/auth/current";
import { listTenancyDocuments } from "@/server/services/assets";

export const metadata = { title: "Documents" };

export default async function TenantDocumentsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const actor = await requirePageActor("tenant");
  const { tenancy: t, all } = await resolveTenantTenancy(actor, (await searchParams).t);
  if (!t) return <EmptyState title="No tenancy yet" />;
  const id = t._id.toString();
  const docs = await listTenancyDocuments(actor, id);
  return (
    <>
      <PageHeader title="Documents" description="Your tenancy agreement and shared documents. Private to you and your landlord." />
      <TenancySwitcher all={all} currentId={id} base="/tenant/documents" />
      <Card>
        <CardHeader title="Tenancy documents" />
        <CardBody className="space-y-4">
          <DocumentList docs={docs} />
          {t.status === "active" ? <TenantDocUpload tenancyId={id} /> : null}
        </CardBody>
      </Card>
    </>
  );
}

import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { TimelineView } from "@/components/shared/timeline";
import { TenancySwitcher } from "@/components/tenant/tenancy-switcher";
import { resolveTenantTenancy } from "@/lib/tenant-context";
import { requirePageActor } from "@/server/auth/current";
import { getTimeline, timelineQuery } from "@/server/services/records";

export const metadata = { title: "Shared tenancy record" };

export default async function TenantRecordPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requirePageActor("tenant");
  const sp = await searchParams;
  const { tenancy: t, all } = await resolveTenantTenancy(actor, sp.t);
  if (!t) return <EmptyState title="No tenancy yet" />;
  const id = t._id.toString();
  const q = timelineQuery.parse({ category: ["all", "payments", "terms", "maintenance", "documents"].includes(sp.category ?? "") ? sp.category : "all", before: sp.before || undefined });
  const r = await getTimeline(actor, id, q);
  return (
    <>
      <PageHeader title="Shared tenancy record" description="Everything recorded about your tenancy, in order, with who recorded it" />
      <TenancySwitcher all={all} currentId={id} base="/tenant/record" />
      <Card>
        <CardBody>
          <TimelineView events={r.events} basePath={`/tenant/record?t=${id}`} category={q.category} hasMore={r.hasMore} nextBefore={r.nextBefore} tenancyId={id} />
        </CardBody>
      </Card>
    </>
  );
}

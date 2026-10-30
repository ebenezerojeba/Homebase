import { KeyRound } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money, Pagination, Tabs, Table, Td, Th } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { label } from "@/lib/nigeria";
import { requirePageActor } from "@/server/auth/current";
import { listTenancies } from "@/server/services/tenancy";

export const metadata = { title: "Tenancies" };

export default async function TenanciesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const actor = await requirePageActor("landlord");
  const sp = await searchParams;
  const status = ["active", "ended", "terminated"].includes(sp.status ?? "") ? sp.status : sp.status === "all" ? undefined : "active";
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total } = await listTenancies(actor, { status, page, pageSize: 25 });
  const tab = sp.status ?? "active";
  return (
    <>
      <PageHeader title="Tenancies" description="Agreed terms, rent schedules and history" actions={<ButtonLink href="/landlord/tenancies/new">New tenancy</ButtonLink>} />
      <Tabs active={tab} items={[{ key: "active", label: "Active", href: "?status=active" }, { key: "ended", label: "Ended", href: "?status=ended" }, { key: "terminated", label: "Ended early", href: "?status=terminated" }, { key: "all", label: "All", href: "?status=all" }]} />
      {items.length === 0 ? (
        <EmptyState icon={<KeyRound className="size-6" />} title="No tenancies here" description="Create a tenancy for a vacant unit to start tracking rent." action={<ButtonLink href="/landlord/tenancies/new">New tenancy</ButtonLink>} />
      ) : (
        <Card>
          <CardBody>
            <Table>
              <thead><tr><Th>Tenant</Th><Th>Property · unit</Th><Th>Rent</Th><Th>Period</Th><Th>Next due</Th><Th>Status</Th></tr></thead>
              <tbody>
                {items.map((t) => {
                  const rent = [...t.rentSchedule].sort((a, b) => +b.effectiveFrom - +a.effectiveFrom)[0];
                  return (
                    <tr key={t._id.toString()}>
                      <Td>
                        <Link href={`/landlord/tenancies/${t._id}`} className="font-medium text-emerald-700 hover:underline">{t.tenantName}</Link>
                        {!t.tenantId ? <span className="ml-2 text-xs text-amber-700">not joined</span> : null}
                      </Td>
                      <Td>{t.propertyId?.name} · {t.unitId?.unitNumber}</Td>
                      <Td><Money kobo={rent?.amountKobo ?? 0} /> <span className="text-xs text-ink-500">{label(t.frequency).toLowerCase()}</span></Td>
                      <Td>{formatDate(t.startDate)} – {formatDate(t.endDate)}</Td>
                      <Td>{formatDate(t.nextDueDate)}</Td>
                      <Td><StatusBadge status={t.status} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={total} hrefFor={(p) => `?status=${tab}&page=${p}`} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

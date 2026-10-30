import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { NewRequestForm } from "@/components/shared/maintenance-forms";
import { requirePageActor } from "@/server/auth/current";
import { listTenancies } from "@/server/services/tenancy";

export const metadata = { title: "Report a problem" };

export default async function Page() {
  const actor = await requirePageActor("tenant");
  const { items } = await listTenancies(actor, { status: "active", page: 1, pageSize: 20 });
  return (
    <>
      <PageHeader title="Report a problem" back={<Link href="/tenant/maintenance" className="text-sm text-emerald-700 hover:underline">← Maintenance</Link>} />
      <Card className="max-w-2xl">
        <CardBody className="py-6">
          {items.length ? (
            <NewRequestForm base="/tenant/maintenance" tenancies={items.map((t) => ({ id: t._id.toString(), label: `${t.propertyId?.name} · ${t.unitId?.unitNumber}` }))} />
          ) : (
            <Alert tone="info">You need an active tenancy to report a problem.</Alert>
          )}
        </CardBody>
      </Card>
    </>
  );
}

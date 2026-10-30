import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { TenancyForm } from "@/components/landlord/tenancy-forms";
import { toISODate, todayInBusinessTz } from "@/lib/dates";
import { requirePageActor } from "@/server/auth/current";
import { listUnits } from "@/server/services/properties";

export const metadata = { title: "New tenancy" };

export default async function NewTenancyPage({ searchParams }: { searchParams: Promise<{ unitId?: string }> }) {
  const actor = await requirePageActor("landlord");
  const { unitId } = await searchParams;
  const units = (await listUnits(actor, {})).filter((u) => !u.currentTenancyId && u.occupancy !== "unavailable");
  return (
    <>
      <PageHeader title="New tenancy" description="Record the agreed terms and invite your tenant." back={<Link href="/landlord/tenancies" className="text-sm text-emerald-700 hover:underline">← Tenancies</Link>} />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <TenancyForm units={units.map((u) => ({ id: u._id.toString(), label: `${u.propertyId?.name} · ${u.unitNumber}` }))} defaultUnitId={unitId} today={toISODate(todayInBusinessTz())} />
        </CardBody>
      </Card>
    </>
  );
}

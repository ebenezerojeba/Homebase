import { DoorOpen } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { FilterBar, Table, Td, Th } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { label } from "@/lib/nigeria";
import { requirePageActor } from "@/server/auth/current";
import { listProperties, listUnits, listUnitsQuery } from "@/server/services/properties";

export const metadata = { title: "Units" };

export default async function UnitsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requirePageActor("landlord");
  const sp = await searchParams;
  const q = listUnitsQuery.safeParse({ propertyId: sp.propertyId || undefined, occupancy: sp.occupancy || undefined });
  const [units, properties] = await Promise.all([listUnits(actor, q.success ? q.data : {}), listProperties(actor)]);
  return (
    <>
      <PageHeader title="Units" description="Every unit across your properties" />
      <FilterBar>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-500">Property</span>
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="w-56">
            <option value="">All properties</option>
            {properties.map((p) => <option key={p._id.toString()} value={p._id.toString()}>{p.name}</option>)}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-500">Occupancy</span>
          <Select name="occupancy" defaultValue={sp.occupancy ?? ""} className="w-44">
            <option value="">Any</option>
            <option value="occupied">Occupied</option>
            <option value="vacant">Vacant</option>
            <option value="unavailable">Unavailable</option>
          </Select>
        </label>
        <Button type="submit" variant="outline">Filter</Button>
      </FilterBar>
      {units.length === 0 ? (
        <EmptyState icon={<DoorOpen className="size-6" />} title="No units match" description="Add units from a property's page." action={<ButtonLink href="/landlord/properties">Go to properties</ButtonLink>} />
      ) : (
        <Card>
          <CardBody>
            <Table>
              <thead><tr><Th>Unit</Th><Th>Property</Th><Th>Type</Th><Th>Status</Th><Th>Tenant</Th><Th>Next due</Th></tr></thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u._id.toString()}>
                    <Td className="font-medium">{u.unitNumber}</Td>
                    <Td><Link href={`/landlord/properties/${u.propertyId?._id}`} className="text-emerald-700 hover:underline">{u.propertyId?.name}</Link></Td>
                    <Td>{label(u.unitType)}</Td>
                    <Td><StatusBadge status={u.occupancy} /></Td>
                    <Td>
                      {u.currentTenancyId ? (
                        <Link href={`/landlord/tenancies/${u.currentTenancyId._id}`} className="hover:underline">{u.currentTenancyId.tenantName}</Link>
                      ) : u.occupancy === "vacant" ? (
                        <Link href={`/landlord/tenancies/new?unitId=${u._id}`} className="text-emerald-700 hover:underline">Add tenancy</Link>
                      ) : "—"}
                    </Td>
                    <Td>{u.currentTenancyId?.nextDueDate ? formatDate(u.currentTenancyId.nextDueDate) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}

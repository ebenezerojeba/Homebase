import { DoorOpen, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/misc";
import { ArchiveButton, EditPropertyButton, PropertyImages, UnitDialog } from "@/components/landlord/property-forms";
import { formatDate } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { label } from "@/lib/nigeria";
import { requirePageActor } from "@/server/auth/current";
import { getPropertyDetail } from "@/server/services/properties";

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("landlord");
  const { id } = await params;
  const detail = await getPropertyDetail(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { property: p, units, tenancies, images } = detail;
  const currentTenancy = (unitId: string) => tenancies.find((t) => t.unitId.toString() === unitId && t.status === "active");
  return (
    <>
      <PageHeader
        back={<Link href="/landlord/properties" className="text-sm text-emerald-700 hover:underline">← Properties</Link>}
        title={<span className="flex items-center gap-3">{p.name} {p.status === "archived" ? <StatusBadge status="archived" /> : null}</span>}
        description={`${p.address.line1}${p.address.line2 ? `, ${p.address.line2}` : ""}, ${p.address.city}, ${p.address.lga} LGA, ${p.address.state} · ${label(p.propertyType)}`}
        actions={
          <>
            <EditPropertyButton propertyId={id} initial={{ name: p.name, propertyType: p.propertyType, address: p.address, description: p.description }} />
            <ArchiveButton endpoint={`/api/properties/${id}`} archived={p.status === "archived"} noun="property" />
          </>
        }
      />
      {p.description ? <p className="mb-6 max-w-3xl text-sm text-ink-700">{p.description}</p> : null}

      <Card>
        <CardHeader
          title="Units"
          description={`${units.filter((u) => u.status === "active").length} active`}
          action={p.status === "active" ? <UnitDialog propertyId={id} trigger={<Button size="sm"><Plus className="size-4" aria-hidden />Add unit</Button>} /> : null}
        />
        <CardBody>
          {units.length === 0 ? (
            <EmptyState icon={<DoorOpen className="size-6" />} title="No units yet" description="Add each flat, room or shop you let separately. For a whole house, add one unit." className="border-0" />
          ) : (
            <Table>
              <thead>
                <tr><Th>Unit</Th><Th>Type</Th><Th>Status</Th><Th>Current tenant</Th><Th>Next due</Th><Th className="text-right">Actions</Th></tr>
              </thead>
              <tbody>
                {units.map((u) => {
                  const t = currentTenancy(u._id.toString());
                  return (
                    <tr key={u._id.toString()}>
                      <Td className="font-medium">{u.unitNumber}</Td>
                      <Td>{label(u.unitType)}{u.bedrooms ? ` · ${u.bedrooms} bed` : ""}</Td>
                      <Td>{u.status === "archived" ? <StatusBadge status="archived" /> : <StatusBadge status={u.occupancy} />}</Td>
                      <Td>{t ? <Link href={`/landlord/tenancies/${t._id}`} className="text-emerald-700 hover:underline">{t.tenantName}</Link> : <span className="text-ink-400">—</span>}</Td>
                      <Td>{t?.nextDueDate ? formatDate(t.nextDueDate) : "—"}</Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          {u.status === "active" && !u.currentTenancyId ? <ButtonLink href={`/landlord/tenancies/new?unitId=${u._id}`} size="sm" variant="secondary">New tenancy</ButtonLink> : null}
                          {u.status === "active" ? (
                            <UnitDialog propertyId={id} unitId={u._id.toString()} initial={{ unitNumber: u.unitNumber, unitType: u.unitType, bedrooms: u.bedrooms, bathrooms: u.bathrooms, features: u.features, occupancy: u.occupancy }} trigger={<Button size="sm" variant="ghost">Edit</Button>} />
                          ) : null}
                          {!u.currentTenancyId ? <ArchiveButton endpoint={`/api/units/${u._id}`} archived={u.status === "archived"} noun="unit" /> : null}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Photos" description="Visible to you and tenants of this property" />
        <CardBody>
          <PropertyImages propertyId={id} images={images.map((i) => ({ _id: i._id.toString(), displayName: i.displayName }))} />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Tenancy history" description="Current and past tenancies at this property" />
        <CardBody>
          {tenancies.length ? (
            <Table>
              <thead><tr><Th>Tenant</Th><Th>Unit</Th><Th>Period</Th><Th>Status</Th></tr></thead>
              <tbody>
                {tenancies.map((t) => (
                  <tr key={t._id.toString()}>
                    <Td><Link href={`/landlord/tenancies/${t._id}`} className="font-medium text-emerald-700 hover:underline">{t.tenantName}</Link></Td>
                    <Td>{units.find((u) => u._id.equals(t.unitId))?.unitNumber}</Td>
                    <Td>{formatDate(t.startDate)} – {formatDate(t.endDate)}</Td>
                    <Td><StatusBadge status={t.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-ink-500">No tenancies recorded yet.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}

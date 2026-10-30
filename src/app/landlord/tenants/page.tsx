import { Users } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money, Table, Td, Th } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { requirePageActor } from "@/server/auth/current";
import { connectDb } from "@/server/db";
import { RentCharge, Tenancy, User } from "@/server/models";

export const metadata = { title: "Tenants" };

export default async function TenantsPage() {
  const actor = await requirePageActor("landlord");
  await connectDb();
  const tenancies = await Tenancy.find({ landlordId: actor.userId, status: "active" })
    .sort({ tenantName: 1 })
    .populate<{ propertyId: { name: string } }>("propertyId", "name")
    .populate<{ unitId: { unitNumber: string } }>("unitId", "unitNumber")
    .lean();
  const tenantIds = tenancies.map((t) => t.tenantId).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const [users, owed] = await Promise.all([
    User.find({ _id: { $in: tenantIds } }).select("name email phone").lean(),
    RentCharge.aggregate<{ _id: unknown; due: number }>([
      { $match: { tenancyId: { $in: tenancies.map((t) => t._id) }, status: { $in: ["open", "partially_paid"] }, dueDate: { $lte: new Date() } } },
      { $group: { _id: "$tenancyId", due: { $sum: { $subtract: ["$amountKobo", "$allocatedKobo"] } } } },
    ]),
  ]);
  return (
    <>
      <PageHeader title="Tenants" description="People currently renting from you" actions={<ButtonLink href="/landlord/tenancies/new">New tenancy</ButtonLink>} />
      {tenancies.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="No current tenants" description="Create a tenancy and invite your tenant to get started." action={<ButtonLink href="/landlord/tenancies/new">New tenancy</ButtonLink>} />
      ) : (
        <Card>
          <CardBody>
            <Table>
              <thead><tr><Th>Tenant</Th><Th>Contact</Th><Th>Home</Th><Th>Portal</Th><Th className="text-right">Owed now</Th><Th>Next due</Th></tr></thead>
              <tbody>
                {tenancies.map((t) => {
                  const u = users.find((x) => t.tenantId && x._id.equals(t.tenantId));
                  const due = owed.find((o) => String(o._id) === t._id.toString())?.due ?? 0;
                  return (
                    <tr key={t._id.toString()}>
                      <Td><Link href={`/landlord/tenancies/${t._id}`} className="font-medium text-emerald-700 hover:underline">{u?.name ?? t.tenantName}</Link></Td>
                      <Td className="text-xs">{u?.email ?? t.tenantEmail}{u?.phone ? <span className="block">{u.phone}</span> : null}</Td>
                      <Td>{t.propertyId?.name} · {t.unitId?.unitNumber}</Td>
                      <Td>{t.tenantId ? <StatusBadge status="accepted" /> : <span className="text-xs text-amber-700">Invited</span>}</Td>
                      <Td className={`text-right ${due ? "font-semibold text-amber-700" : ""}`}><Money kobo={due} /></Td>
                      <Td>{formatDate(t.nextDueDate)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}

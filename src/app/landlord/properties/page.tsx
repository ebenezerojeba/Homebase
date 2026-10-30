import { Building2, MapPin } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { label } from "@/lib/nigeria";
import { requirePageActor } from "@/server/auth/current";
import { listProperties } from "@/server/services/properties";

export const metadata = { title: "Properties" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const actor = await requirePageActor("landlord");
  const showArchived = (await searchParams).archived === "1";
  const props = await listProperties(actor, { includeArchived: showArchived });
  return (
    <>
      <PageHeader
        title="Properties"
        description={`${props.length} ${showArchived ? "total" : "active"} propert${props.length === 1 ? "y" : "ies"}`}
        actions={
          <>
            <ButtonLink href={showArchived ? "/landlord/properties" : "/landlord/properties?archived=1"} variant="ghost">{showArchived ? "Hide archived" : "Show archived"}</ButtonLink>
            <ButtonLink href="/landlord/properties/new">Add property</ButtonLink>
          </>
        }
      />
      {props.length === 0 ? (
        <EmptyState icon={<Building2 className="size-6" />} title="No properties yet" description="Add the building or house you let out. You'll add units and tenancies next." action={<ButtonLink href="/landlord/properties/new">Add a property</ButtonLink>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {props.map((p) => (
            <Link key={p._id.toString()} href={`/landlord/properties/${p._id}`} className="group">
              <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-pop">
                <div className="aspect-[16/9] bg-gradient-to-br from-sage-200 to-cream-200">
                  {p.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/assets/${p.coverAssetId}`} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid size-full place-items-center text-sage-500"><Building2 className="size-10" aria-hidden /></div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-ink-900 group-hover:text-emerald-800">{p.name}</h2>
                    {p.status === "archived" ? <StatusBadge status="archived" /> : null}
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-sm text-ink-500"><MapPin className="size-3.5" aria-hidden />{p.address.city}, {p.address.state}</p>
                  <p className="mt-3 text-sm text-ink-700">{label(p.propertyType)} · {p.occupiedCount}/{p.unitCount} units occupied</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

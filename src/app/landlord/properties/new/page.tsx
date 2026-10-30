import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { PropertyForm } from "@/components/landlord/property-forms";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Add property" };

export default async function NewPropertyPage() {
  await requirePageActor("landlord");
  return (
    <>
      <PageHeader title="Add a property" back={<Link href="/landlord/properties" className="text-sm text-emerald-700 hover:underline">← Properties</Link>} />
      <Card className="max-w-2xl">
        <CardBody className="py-6">
          <PropertyForm />
        </CardBody>
      </Card>
    </>
  );
}

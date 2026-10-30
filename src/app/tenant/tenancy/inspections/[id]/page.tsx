import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { InspectionView } from "@/components/shared/inspections";
import { InspectionResponse } from "@/components/tenant/payment-forms";
import { AppError } from "@/lib/errors";
import { requirePageActor } from "@/server/auth/current";
import { getInspection } from "@/server/services/records";

export const metadata = { title: "Inspection" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("tenant");
  const { id } = await params;
  const ins = await getInspection(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <>
      <PageHeader title="Inspection" back={<Link href="/tenant/tenancy" className="text-sm text-emerald-700 hover:underline">← My tenancy</Link>} />
      <Card>
        <CardBody className="space-y-6">
          <InspectionView ins={ins} />
          {ins.tenantResponse.status === "pending" ? <InspectionResponse inspectionId={id} /> : null}
        </CardBody>
      </Card>
    </>
  );
}

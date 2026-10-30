import { MaintenanceDetailPage } from "@/components/shared/maintenance-views";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Repair request" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MaintenanceDetailPage actor={await requirePageActor("tenant")} id={(await params).id} />;
}

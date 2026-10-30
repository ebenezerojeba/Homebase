import { MaintenanceListPage } from "@/components/shared/maintenance-views";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Maintenance" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <MaintenanceListPage actor={await requirePageActor("landlord")} sp={await searchParams} />;
}

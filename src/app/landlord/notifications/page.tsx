import { NotificationsPage } from "@/components/shared/notifications-page";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Notifications" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return <NotificationsPage actor={await requirePageActor("landlord")} page={Math.max(1, Number((await searchParams).page) || 1)} />;
}

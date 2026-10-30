import { Bell } from "lucide-react";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/misc";
import type { Actor } from "@/server/auth/actor";
import { listNotifications } from "@/server/services/notifications";
import { NotificationList } from "./notifications";

export async function NotificationsPage({ actor, page }: { actor: Actor; page: number }) {
  const { items, total, unread } = await listNotifications(actor, { page, pageSize: 30 });
  return (
    <>
      <PageHeader title="Notifications" description={unread ? `${unread} unread` : "You're up to date"} />
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" />} title="No notifications yet" description="Reminders, payment updates and repair news will appear here." />
      ) : (
        <>
          <NotificationList items={items.map((n) => ({ _id: n._id.toString(), title: n.title, body: n.body, link: n.link ?? null, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }))} />
          <Pagination page={page} pageSize={30} total={total} hrefFor={(p) => `?page=${p}`} />
        </>
      )}
    </>
  );
}

import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { requirePageActor } from "@/server/auth/current";
import { totalUnreadMessages } from "@/server/services/messaging";
import { unreadNotificationCount } from "@/server/services/notifications";

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor("tenant");
  const [messages, notifications] = await Promise.all([totalUnreadMessages(actor), unreadNotificationCount(actor)]);
  const nav: NavItem[] = [
    { href: "/tenant", label: "Home", icon: "home", primary: true },
    { href: "/tenant/tenancy", label: "My tenancy", icon: "tenancies" },
    { href: "/tenant/payments", label: "Rent & payments", icon: "payments", primary: true },
    { href: "/tenant/receipts", label: "Receipts & statements", icon: "receipts" },
    { href: "/tenant/maintenance", label: "Maintenance", icon: "maintenance", primary: true },
    { href: "/tenant/messages", label: "Messages", icon: "messages", badge: messages, primary: true },
    { href: "/tenant/documents", label: "Documents", icon: "documents" },
    { href: "/tenant/record", label: "Shared tenancy record", icon: "record" },
    { href: "/tenant/notifications", label: "Notifications", icon: "notifications", badge: notifications },
    { href: "/tenant/profile", label: "Profile", icon: "profile" },
  ];
  return (
    <AppShell nav={nav} root="/tenant" user={{ name: actor.name, roleLabel: "Tenant" }}>
      {children}
    </AppShell>
  );
}

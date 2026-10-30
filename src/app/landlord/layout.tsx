import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { VerifyEmailBanner } from "@/components/shell/verify-banner";
import { requirePageActor } from "@/server/auth/current";
import { connectDb } from "@/server/db";
import { MaintenanceRequest, Payment } from "@/server/models";
import { totalUnreadMessages } from "@/server/services/messaging";
import { unreadNotificationCount } from "@/server/services/notifications";

export default async function LandlordLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor("landlord");
  await connectDb();
  const [claims, maintenance, messages, notifications] = await Promise.all([
    Payment.countDocuments({ landlordId: actor.userId, status: "pending_verification" }),
    MaintenanceRequest.countDocuments({ landlordId: actor.userId, status: "submitted" }),
    totalUnreadMessages(actor),
    unreadNotificationCount(actor),
  ]);
  const nav: NavItem[] = [
    { href: "/landlord", label: "Overview", icon: "overview", primary: true },
    { href: "/landlord/properties", label: "Properties", icon: "properties", primary: true },
    { href: "/landlord/units", label: "Units", icon: "units" },
    { href: "/landlord/tenants", label: "Tenants", icon: "tenants" },
    { href: "/landlord/tenancies", label: "Tenancies", icon: "tenancies" },
    { href: "/landlord/payments", label: "Rent & payments", icon: "payments", primary: true },
    { href: "/landlord/reconciliation", label: "Payment review", icon: "reconciliation", badge: claims },
    { href: "/landlord/maintenance", label: "Maintenance", icon: "maintenance", badge: maintenance, primary: true },
    { href: "/landlord/messages", label: "Messages", icon: "messages", badge: messages },
    { href: "/landlord/documents", label: "Documents", icon: "documents" },
    { href: "/landlord/reports", label: "Financial reports", icon: "reports" },
    { href: "/landlord/notifications", label: "Notifications", icon: "notifications", badge: notifications },
    { href: "/landlord/settings", label: "Settings", icon: "settings" },
  ];
  return (
    <AppShell nav={nav} root="/landlord" user={{ name: actor.name, roleLabel: "Landlord" }} banner={actor.emailVerified ? null : <VerifyEmailBanner email={actor.email} />}>
      {children}
    </AppShell>
  );
}

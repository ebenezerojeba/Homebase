import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { requirePageActor } from "@/server/auth/current";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor("admin");
  const nav: NavItem[] = [
    { href: "/admin", label: "Operations", icon: "admin", primary: true },
    { href: "/admin/users", label: "Users", icon: "tenants", primary: true },
    { href: "/admin/data-requests", label: "Data requests", icon: "documents", primary: true },
    { href: "/admin/audit", label: "Audit log", icon: "record", primary: true },
  ];
  return (
    <AppShell nav={nav} root="/admin" user={{ name: actor.name, roleLabel: "Platform admin" }}>
      {children}
    </AppShell>
  );
}

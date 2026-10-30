"use client";

import {
  Bell,
  Building2,
  ClipboardCheck,
  DoorOpen,
  FileText,
  Home,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  Users,
  Wallet,
  Wrench,
  BarChart3,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { APP_NAME } from "@/lib/brand";
import { Logo } from "@/components/brand/logo";

const ICONS = {
  overview: LayoutDashboard,
  home: Home,
  properties: Building2,
  units: DoorOpen,
  tenants: Users,
  tenancies: KeyRound,
  payments: Wallet,
  reconciliation: ClipboardCheck,
  maintenance: Wrench,
  messages: MessageSquare,
  documents: FileText,
  reports: BarChart3,
  notifications: Bell,
  settings: Settings,
  receipts: Receipt,
  record: ScrollText,
  profile: User,
  admin: Shield,
} as const;
export type IconName = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  /** Shown in the mobile bottom bar. */
  primary?: boolean;
}

function isActive(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ nav, root, user, children, banner }: { nav: NavItem[]; root: string; user: { name: string; roleLabel: string }; children: ReactNode; banner?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = nav.filter((n) => n.primary).slice(0, 4);
  const moreBadge = nav.filter((n) => !n.primary).reduce((s, n) => s + (n.badge ?? 0), 0);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  const NavLink = ({ item, onClick, dark }: { item: NavItem; onClick?: () => void; dark?: boolean }) => {
    const Icon = ICONS[item.icon];
    const active = isActive(pathname, item.href, root);
    return (
      <Link
        href={item.href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
          dark
            ? active
              ? "bg-white/10 text-white"
              : "text-ink-300 hover:bg-white/5 hover:text-white"
            : active
              ? "bg-ink-900 text-white"
              : "text-ink-600 hover:bg-cream-200 hover:text-ink-900",
        )}
      >
        <Icon
          className={cn("size-[18px]", active ? "text-emerald-500" : dark ? "text-ink-400 group-hover:text-emerald-500" : "text-sage-500 group-hover:text-emerald-700")}
          aria-hidden
        />
        <span className="flex-1">{item.label}</span>
        {item.badge ? (
          <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs font-semibold", active || dark ? "bg-emerald-500 text-ink-900" : "bg-amber-100 text-amber-700")}>{item.badge > 99 ? "99+" : item.badge}</span>
        ) : null}
      </Link>
    );
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[260px_1fr]">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col bg-ink-900 md:flex">
        <div className="flex h-[4.5rem] items-center px-5">
          <Link href={root} aria-label={`${APP_NAME} home`} className="rounded-lg focus-visible:outline-emerald-500">
            <Logo tone="onDark" size="md" />
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
          {nav.map((item) => (
            <NavLink key={item.href} item={item} dark />
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="grid size-9 place-items-center rounded-full bg-emerald-500 text-sm font-bold text-ink-900" aria-hidden>
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user.name}</p>
              <p className="text-xs text-ink-400">{user.roleLabel}</p>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-ink-300 hover:bg-white/10 hover:text-white focus-visible:outline-emerald-500" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar */}
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-cream-300 bg-white/90 px-4 backdrop-blur md:hidden">
          <Link href={root} aria-label={`${APP_NAME} home`}>
            <Logo size="sm" compact />
          </Link>
          <Link href={nav.find((n) => n.icon === "notifications")?.href ?? root} className="relative grid size-9 place-items-center rounded-xl border border-cream-300 bg-white text-ink-700" aria-label="Notifications">
            <Bell className="size-5" />
            {nav.find((n) => n.icon === "notifications")?.badge ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-rose-700" /> : null}
          </Link>
        </header>
        {banner}
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-cream-300 bg-white/95 backdrop-blur md:hidden" aria-label="Main">
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href, root);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-emerald-700" : "text-ink-500")}>
                  <Icon className="size-5" aria-hidden />
                  {item.label.split(" ")[0]}
                  {item.badge ? <span className="absolute right-[22%] top-1.5 size-2 rounded-full bg-amber-700" /> : null}
                </Link>
              </li>
            );
          })}
          <li>
            <button onClick={() => setMoreOpen(true)} className="relative flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-ink-500" aria-haspopup="dialog" aria-expanded={moreOpen}>
              <MoreHorizontal className="size-5" aria-hidden />
              More
              {moreBadge ? <span className="absolute right-[22%] top-1.5 size-2 rounded-full bg-amber-700" /> : null}
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More navigation">
          <button className="absolute inset-0 animate-fade-in bg-ink-900/40" onClick={() => setMoreOpen(false)} aria-label="Close menu" />
          <div className="safe-bottom absolute inset-x-0 bottom-0 max-h-[85dvh] animate-slide-up overflow-y-auto rounded-t-3xl bg-cream-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-ink-900">{user.name}</p>
              <button onClick={() => setMoreOpen(false)} className="rounded-lg p-1.5 text-ink-500" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {nav.map((item) => (
                <NavLink key={item.href} item={item} onClick={() => setMoreOpen(false)} />
              ))}
              <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink-600 hover:bg-cream-200">
                <LogOut className="size-[18px] text-sage-500" aria-hidden /> Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

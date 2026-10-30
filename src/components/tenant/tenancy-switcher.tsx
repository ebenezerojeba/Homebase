import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";

/** Lets tenants with past tenancies (renewals, moves) switch which record they're viewing. */
export function TenancySwitcher({ all, currentId, base }: { all: { _id: { toString(): string }; startDate: Date; endDate: Date; status: string; unitId?: { unitNumber: string } | null }[]; currentId: string; base: string }) {
  if (all.length < 2) return null;
  return (
    <nav className="no-print mb-5 flex flex-wrap gap-1.5" aria-label="Choose tenancy">
      {all.map((t) => (
        <Link key={t._id.toString()} href={`${base}?t=${t._id}`} aria-current={t._id.toString() === currentId ? "true" : undefined} className={cn("rounded-full px-3 py-1 text-xs font-medium", t._id.toString() === currentId ? "bg-emerald-700 text-white" : "bg-cream-200 text-ink-700 hover:bg-cream-300")}>
          {t.unitId?.unitNumber} · {formatDate(t.startDate)}–{formatDate(t.endDate)}
          {t.status !== "active" ? " (past)" : ""}
        </Link>
      ))}
    </nav>
  );
}

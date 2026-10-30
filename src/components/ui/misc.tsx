import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatKobo } from "@/lib/money";

export function Money({ kobo, className, signed }: { kobo: number; className?: string; signed?: boolean }) {
  return <span className={cn("tabular", className)}>{signed && kobo > 0 ? "+" : ""}{formatKobo(kobo)}</span>;
}

/** Server-rendered pagination using query strings. */
export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <p className="text-ink-500">
        Page {page} of {pages} · {total} total
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-cream-300 bg-white px-3 hover:bg-cream-50" rel="prev">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-cream-300 bg-white px-3 hover:bg-cream-50" rel="next">
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("-mx-5 overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cn("border-b border-cream-200 px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-500", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-cream-200/70 px-5 py-3 align-middle text-ink-800", className)}>{children}</td>;
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <nav className="no-print -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-cream-300" aria-label="Sections">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            i.key === active ? "border-emerald-700 text-emerald-800" : "border-transparent text-ink-500 hover:text-ink-800",
          )}
        >
          {i.label}
          {i.count ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <form className="no-print mb-4 flex flex-wrap items-end gap-3">{children}</form>;
}

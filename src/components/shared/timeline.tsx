import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileText,
  KeyRound,
  Receipt,
  RotateCcw,
  UserPlus,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ITimelineEvent } from "@/server/models";
import { SourceBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/dates";
import { label } from "@/lib/nigeria";
import { cn } from "@/lib/cn";

type Event = Omit<ITimelineEvent, "actorId"> & { actorId: { name: string } | null };

const ICON: Record<string, typeof CheckCircle2> = {
  tenancy_created: KeyRound,
  tenancy_terms_changed: ClipboardList,
  tenancy_renewed: KeyRound,
  tenancy_ended: Ban,
  tenant_invited: UserPlus,
  tenant_joined: UserPlus,
  terms_acknowledged: CheckCircle2,
  charge_created: CircleDollarSign,
  charge_adjusted: ClipboardList,
  payment_submitted: CircleDollarSign,
  payment_recorded: CircleDollarSign,
  payment_initiated: CircleDollarSign,
  payment_confirmed: CheckCircle2,
  payment_rejected: AlertTriangle,
  payment_failed: AlertTriangle,
  payment_reversed: RotateCcw,
  payment_refunded: RotateCcw,
  credit_applied: CircleDollarSign,
  receipt_issued: Receipt,
  agreement_uploaded: FileText,
  document_uploaded: FileText,
  maintenance_submitted: Wrench,
  maintenance_status_changed: Wrench,
  maintenance_comment: Wrench,
  maintenance_tenant_confirmation: Wrench,
  inspection_recorded: ClipboardList,
  inspection_response: ClipboardList,
  notice_sent: FileText,
  correction: RotateCcw,
};

const TONE: Record<string, string> = {
  payment_confirmed: "bg-emerald-100 text-emerald-800",
  receipt_issued: "bg-emerald-100 text-emerald-800",
  payment_rejected: "bg-rose-100 text-rose-700",
  payment_failed: "bg-rose-100 text-rose-700",
  payment_reversed: "bg-rose-100 text-rose-700",
  payment_refunded: "bg-rose-100 text-rose-700",
  correction: "bg-amber-100 text-amber-700",
  charge_adjusted: "bg-amber-100 text-amber-700",
  payment_submitted: "bg-amber-100 text-amber-700",
};

const CATEGORIES = [
  ["all", "Everything"],
  ["payments", "Money"],
  ["terms", "Terms"],
  ["maintenance", "Repairs"],
  ["documents", "Documents & inspections"],
] as const;

export function TimelineView({ events, basePath, category, hasMore, nextBefore, tenancyId }: { events: Event[]; basePath: string; category: string; hasMore: boolean; nextBefore: string | null; tenancyId: string }) {
  const sep = basePath.includes("?") ? "&" : "?";
  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1.5" aria-label="Filter record">
          {CATEGORIES.map(([k, l]) => (
            <Link key={k} href={`${basePath}${sep}category=${k}`} aria-current={category === k ? "true" : undefined} className={cn("rounded-full px-3 py-1 text-xs font-medium", category === k ? "bg-emerald-700 text-white" : "bg-cream-200 text-ink-700 hover:bg-cream-300")}>
              {l}
            </Link>
          ))}
        </nav>
        <div className="flex gap-2">
          <a href={`/api/exports?kind=timeline&tenancyId=${tenancyId}`} className={buttonClass("outline", "sm")}>Download CSV</a>
          <Link href={`/print/record/${tenancyId}`} className={buttonClass("outline", "sm")} target="_blank">Printable record</Link>
        </div>
      </div>
      {events.length === 0 ? (
        <EmptyState title="Nothing recorded here yet" description="Events appear as the tenancy progresses." />
      ) : (
        <ol className="relative space-y-0 border-l border-cream-300 pl-6">
          {events.map((e) => {
            const Icon = ICON[e.type] ?? FileText;
            return (
              <li key={e._id.toString()} className="relative pb-6 last:pb-0">
                <span className={cn("absolute -left-[37px] grid size-7 place-items-center rounded-full ring-4 ring-cream-100", TONE[e.type] ?? "bg-sage-100 text-sage-600")} aria-hidden>
                  <Icon className="size-3.5" />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink-900">{label(e.type)}</p>
                  <SourceBadge source={e.source} />
                  {e.visibility === "landlord_only" ? <span className="text-xs text-ink-500">(only you can see this)</span> : null}
                </div>
                <p className="mt-0.5 text-sm text-ink-700">{e.summary}</p>
                <p className="mt-1 text-xs text-ink-500">
                  <time dateTime={e.occurredAt.toISOString()}>{formatDateTime(e.occurredAt)} WAT</time>
                  {" · "}
                  {e.actorId?.name ?? (e.actorRole === "system" || !e.actorRole ? "System" : "Former user")}
                  {e.correctsEventId ? " · corrects an earlier entry" : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {hasMore && nextBefore ? (
        <div className="mt-6">
          <Link href={`${basePath}${sep}category=${category}&before=${encodeURIComponent(nextBefore)}`} className={buttonClass("outline", "sm")}>Older entries</Link>
        </div>
      ) : null}
      <p className="mt-6 text-xs text-ink-500">
        This record shows who recorded or confirmed each entry and when (server time). It organises the tenancy history; it does not by itself prove liability or verify that uploaded documents are authentic.
      </p>
    </div>
  );
}

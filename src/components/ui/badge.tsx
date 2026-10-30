import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "sage";
const tones: Record<Tone, string> = {
  neutral: "bg-cream-200 text-ink-700",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-700/15",
  amber: "bg-amber-50 text-amber-700 ring-amber-700/20",
  red: "bg-rose-50 text-rose-700 ring-rose-700/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-700/15",
  sage: "bg-sage-100 text-sage-600 ring-sage-600/15",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", tones[tone], className)}>{children}</span>;
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  // payments
  initiated: { tone: "neutral", label: "Started" },
  pending: { tone: "blue", label: "Awaiting provider" },
  pending_verification: { tone: "amber", label: "Awaiting review" },
  confirmed: { tone: "green", label: "Confirmed" },
  rejected: { tone: "red", label: "Not confirmed" },
  failed: { tone: "red", label: "Failed" },
  abandoned: { tone: "neutral", label: "Not completed" },
  reversed: { tone: "red", label: "Reversed" },
  refunded: { tone: "sage", label: "Refunded" },
  // charges
  open: { tone: "amber", label: "Unpaid" },
  partially_paid: { tone: "blue", label: "Part paid" },
  paid: { tone: "green", label: "Paid" },
  waived: { tone: "sage", label: "Waived" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  overdue: { tone: "red", label: "Overdue" },
  // tenancy
  active: { tone: "green", label: "Active" },
  ended: { tone: "neutral", label: "Ended" },
  terminated: { tone: "neutral", label: "Terminated" },
  archived: { tone: "neutral", label: "Archived" },
  // units
  vacant: { tone: "sage", label: "Vacant" },
  occupied: { tone: "green", label: "Occupied" },
  unavailable: { tone: "neutral", label: "Unavailable" },
  // maintenance
  submitted: { tone: "amber", label: "Submitted" },
  acknowledged: { tone: "blue", label: "Acknowledged" },
  scheduled: { tone: "blue", label: "Scheduled" },
  in_progress: { tone: "blue", label: "In progress" },
  awaiting_tenant: { tone: "amber", label: "Awaiting tenant" },
  completed: { tone: "green", label: "Completed" },
  // receipts / misc
  valid: { tone: "green", label: "Valid" },
  voided: { tone: "red", label: "Voided" },
  accepted: { tone: "green", label: "Accepted" },
  revoked: { tone: "neutral", label: "Revoked" },
  draft: { tone: "neutral", label: "Draft" },
  finalized: { tone: "green", label: "Finalized" },
  disputed: { tone: "red", label: "Disputed" },
  recorded: { tone: "green", label: "Recorded" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, label: status.replace(/_/g, " ") };
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}

const SOURCE: Record<string, { tone: Tone; label: string }> = {
  tenant_submitted: { tone: "amber", label: "Tenant-submitted" },
  landlord_recorded: { tone: "blue", label: "Landlord-recorded" },
  landlord_confirmed: { tone: "green", label: "Landlord-confirmed" },
  provider_confirmed: { tone: "green", label: "Provider-confirmed" },
  system: { tone: "neutral", label: "System" },
  provider: { tone: "green", label: "Payment provider" },
  tenant_claim: { tone: "amber", label: "Tenant claim" },
  landlord_record: { tone: "blue", label: "Landlord record" },
};

export function SourceBadge({ source }: { source: string }) {
  const s = SOURCE[source] ?? { tone: "neutral" as Tone, label: source };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

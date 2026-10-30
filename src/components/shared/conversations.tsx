import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import type { listConversations } from "@/server/services/messaging";

export function ConversationList({ items, base, activeId, role }: { items: Awaited<ReturnType<typeof listConversations>>; base: string; activeId?: string; role: "landlord" | "tenant" }) {
  if (!items.length) {
    return <EmptyState icon={<MessageSquare className="size-6" />} title="No conversations yet" description={role === "landlord" ? "A conversation opens automatically when a tenant joins their tenancy." : "Your conversation with your landlord appears once you've joined a tenancy."} />;
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-cream-200">
        {items.map((c) => (
          <li key={c._id}>
            <Link href={`${base}/${c._id}`} aria-current={activeId === c._id ? "page" : undefined} className={cn("flex items-center gap-3 px-4 py-3 hover:bg-cream-50", activeId === c._id && "bg-emerald-50")}>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage-200 font-semibold text-emerald-900" aria-hidden>{c.otherPartyName.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("truncate text-sm", c.unread ? "font-semibold text-ink-900" : "font-medium text-ink-800")}>{c.otherPartyName}</p>
                  {c.lastMessageAt ? <span className="shrink-0 text-xs text-ink-400">{formatDateTime(c.lastMessageAt)}</span> : null}
                </div>
                <p className="truncate text-xs text-ink-500">{role === "landlord" && c.tenantName ? `${c.tenantName} · ` : ""}{c.lastMessagePreview ?? "No messages yet"}</p>
              </div>
              {c.unread ? <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white">{c.unread}<span className="sr-only"> unread</span></span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

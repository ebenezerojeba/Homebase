import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/card";
import type { Actor } from "@/server/auth/actor";
import { listConversations } from "@/server/services/messaging";
import { Chat } from "./chat";
import { ConversationList } from "./conversations";

export async function MessagesPage({ actor, conversationId }: { actor: Actor; conversationId?: string }) {
  const role = actor.role as "landlord" | "tenant";
  const base = `/${role}/messages`;
  const items = await listConversations(actor);
  const active = conversationId ? items.find((c) => c._id === conversationId) : undefined;
  if (conversationId && !active) notFound();
  return (
    <>
      <PageHeader title="Messages" description="Private conversations, kept with the tenancy record" />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className={active ? "hidden lg:block" : undefined}>
          <ConversationList items={items} base={base} activeId={conversationId} role={role} />
        </div>
        {active ? (
          <div>
            <Link href={base} className="mb-2 inline-block text-sm text-emerald-700 hover:underline lg:hidden">← All conversations</Link>
            <Chat conversationId={active._id} otherName={role === "landlord" && active.tenantName ? `${active.otherPartyName} · ${active.tenantName}` : active.otherPartyName} />
          </div>
        ) : items.length ? (
          <div className="hidden place-items-center rounded-card border border-dashed border-cream-300 text-sm text-ink-500 lg:grid">Choose a conversation</div>
        ) : null}
      </div>
    </>
  );
}

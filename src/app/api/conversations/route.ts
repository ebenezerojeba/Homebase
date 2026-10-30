import { authed } from "@/server/http";
import { listConversations } from "@/server/services/messaging";

export const dynamic = "force-dynamic";
export const GET = authed({ roles: ["landlord", "tenant"] }, async ({ actor }) => ({ items: await listConversations(actor) }));

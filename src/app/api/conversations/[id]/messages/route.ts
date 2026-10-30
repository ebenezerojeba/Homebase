import { RULES } from "@/server/auth/rate-limit";
import { authed, parseJson, parseQuery } from "@/server/http";
import { listMessages, markConversationRead, messagesQuery, sendMessage, sendMessageSchema } from "@/server/services/messaging";

export const dynamic = "force-dynamic";

/** Polled by the chat view. Reading marks the conversation as read for the caller. */
export const GET = authed<{ id: string }>({ roles: ["landlord", "tenant"] }, async ({ req, actor, params }) => {
  const q = parseQuery(req, messagesQuery);
  const res = await listMessages(actor, params.id, q);
  if (!q.before) await markConversationRead(actor, params.id);
  return res;
});

export const POST = authed<{ id: string }>({ roles: ["landlord", "tenant"], rateLimit: RULES.message }, async ({ req, actor, params }) => {
  const m = await sendMessage(actor, params.id, await parseJson(req, sendMessageSchema));
  return { messageId: m._id.toString() };
});

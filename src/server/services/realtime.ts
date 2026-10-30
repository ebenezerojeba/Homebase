import "server-only";
import mongoose from "mongoose";
import { logger } from "@/lib/logger";
import { connectDb } from "@/server/db";
import { Conversation, Message } from "@/server/models";

export type ConversationEvent = { type: "new_message"; at: string } | { type: "read"; at: string };

const POLL_MS = 3000;

/**
 * Watch one conversation for new messages and read-receipt changes.
 *
 * Uses MongoDB change streams (Atlas / any replica set) so events arrive instantly. If change streams
 * aren't available (standalone server, permissions), it falls back to light polling. Events only
 * signal "something changed" — the client re-fetches through the normal, authorised messages API,
 * so no message content flows through this channel.
 */
export async function subscribeConversation(
  conversationId: string,
  onEvent: (e: ConversationEvent) => void,
  opts: { forcePolling?: boolean } = {},
): Promise<() => Promise<void>> {
  await connectDb();
  const id = new mongoose.Types.ObjectId(conversationId);
  let stopped = false;
  const emit = (type: ConversationEvent["type"]) => {
    if (!stopped) onEvent({ type, at: new Date().toISOString() });
  };

  const startPolling = async () => {
    let lastMessageAt = (await Message.findOne({ conversationId: id }).sort({ createdAt: -1 }).select("createdAt").lean())?.createdAt ?? new Date(0);
    let lastConvUpdate = (await Conversation.findById(id).select("updatedAt").lean())?.updatedAt ?? new Date(0);
    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        const [m, c] = await Promise.all([
          Message.findOne({ conversationId: id, createdAt: { $gt: lastMessageAt } }).sort({ createdAt: -1 }).select("createdAt").lean(),
          Conversation.findById(id).select("updatedAt").lean(),
        ]);
        if (m) {
          lastMessageAt = m.createdAt;
          emit("new_message");
        } else if (c && c.updatedAt > lastConvUpdate) {
          emit("read");
        }
        if (c) lastConvUpdate = c.updatedAt;
      } catch (e) {
        logger.warn("realtime_poll_failed", { error: e });
      }
    }, POLL_MS);
    return async () => {
      stopped = true;
      clearInterval(timer);
    };
  };

  if (opts.forcePolling) return startPolling();

  try {
    const messages = Message.watch([{ $match: { operationType: "insert", "fullDocument.conversationId": id } }]);
    const convo = Conversation.watch([{ $match: { operationType: "update", "documentKey._id": id } }]);
    let fallback: (() => Promise<void>) | null = null;
    const onError = async (e: unknown) => {
      if (stopped || fallback) return;
      logger.warn("realtime_change_stream_unavailable", { error: e });
      await Promise.allSettled([messages.close(), convo.close()]);
      fallback = await startPolling();
    };
    messages.on("change", () => emit("new_message"));
    convo.on("change", () => emit("read"));
    messages.on("error", onError);
    convo.on("error", onError);
    return async () => {
      stopped = true;
      await Promise.allSettled([messages.close(), convo.close()]);
      if (fallback) await fallback();
    };
  } catch (e) {
    logger.warn("realtime_change_stream_unavailable", { error: e });
    return startPolling();
  }
}

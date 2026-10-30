import "server-only";
import mongoose from "mongoose";
import { z } from "zod";
import { errors, isDuplicateKeyError } from "@/lib/errors";
import { objectId, shortText } from "@/lib/validation";
import { connectDb } from "@/server/db";
import { Conversation, Message, Tenancy, User } from "@/server/models";
import type { Actor } from "@/server/auth/actor";
import { assertId } from "./access";
import { assertOwnAssets } from "./assets";
import { notify } from "./notifications";

const { ObjectId } = mongoose.Types;

/** Only the two participants can see a conversation. Returns NOT_FOUND otherwise. */
export async function getConversationForActor(actor: Actor, conversationId: string) {
  await connectDb();
  if (actor.role === "admin") throw errors.notFound();
  const c = await Conversation.findOne({ _id: assertId(conversationId), participantIds: new ObjectId(actor.userId) }).lean();
  if (!c) throw errors.notFound("Conversation not found");
  return c;
}

export async function listConversations(actor: Actor) {
  await connectDb();
  const me = new ObjectId(actor.userId);
  const convs = await Conversation.find({ participantIds: me })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(200)
    .populate<{ tenancyId: { _id: mongoose.Types.ObjectId; tenantName: string; status: string; propertyId: mongoose.Types.ObjectId } }>("tenancyId", "tenantName status propertyId")
    .lean();
  const otherIds = convs.map((c) => (c.landlordId.equals(me) ? c.tenantId : c.landlordId));
  const others = await User.find({ _id: { $in: otherIds } }).select("name").lean();
  const nameOf = new Map(others.map((u) => [u._id.toString(), u.name]));
  // Unread counts: one indexed count per conversation (bounded by the 200 limit above).
  const unread = await Promise.all(
    convs.map((c) => {
      const lastRead = c.readState.find((r) => r.userId.equals(me))?.lastReadAt ?? new Date(0);
      return Message.countDocuments({ conversationId: c._id, createdAt: { $gt: lastRead }, senderId: { $ne: me } });
    }),
  );
  return convs.map((c, i) => ({
    _id: c._id.toString(),
    tenancyId: c.tenancyId?._id.toString(),
    tenancyStatus: c.tenancyId?.status,
    otherPartyName: nameOf.get(otherIds[i]!.toString()) ?? "Unknown",
    tenantName: c.tenancyId?.tenantName,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    unread: unread[i] ?? 0,
  }));
}

export async function totalUnreadMessages(actor: Actor) {
  const list = await listConversations(actor);
  return list.reduce((s, c) => s + c.unread, 0);
}

export const messagesQuery = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });

/** Cursor pagination (newest first), using the (conversationId, createdAt) index. */
export async function listMessages(actor: Actor, conversationId: string, q: z.infer<typeof messagesQuery>) {
  const c = await getConversationForActor(actor, conversationId);
  const filter: Record<string, unknown> = { conversationId: c._id };
  if (q.before) filter.createdAt = { $lt: new Date(q.before) };
  const items = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).lean();
  const hasMore = items.length > q.limit;
  const page = items.slice(0, q.limit);
  const other = c.landlordId.toString() === actor.userId ? c.tenantId : c.landlordId;
  const otherRead = c.readState.find((r) => r.userId.equals(other))?.lastReadAt ?? null;
  return {
    conversation: { _id: c._id.toString(), tenancyId: c.tenancyId.toString() },
    messages: page.reverse().map((m) => ({
      _id: m._id.toString(),
      senderId: m.senderId.toString(),
      mine: m.senderId.toString() === actor.userId,
      body: m.body,
      attachmentAssetIds: m.attachmentAssetIds.map(String),
      createdAt: m.createdAt,
      readByOther: Boolean(otherRead && m.createdAt <= otherRead),
    })),
    hasMore,
    nextBefore: hasMore ? page[0]?.createdAt.toISOString() : null,
  };
}

export const sendMessageSchema = z
  .object({
    body: shortText(4000).default(""),
    attachmentAssetIds: z.array(objectId).max(4).default([]),
    clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  })
  .refine((v) => v.body.trim().length > 0 || v.attachmentAssetIds.length > 0, { message: "Write a message or attach a file", path: ["body"] });

export async function sendMessage(actor: Actor, conversationId: string, input: z.infer<typeof sendMessageSchema>) {
  const c = await getConversationForActor(actor, conversationId);
  const tenancy = await Tenancy.findById(c.tenancyId).select("status").lean();
  if (!tenancy || tenancy.status === "cancelled") throw errors.conflict("This conversation is closed");
  const attachments = await assertOwnAssets(actor, input.attachmentAssetIds, c.tenancyId.toString(), ["message_attachment"]);
  let message;
  try {
    message = await Message.create({ conversationId: c._id, senderId: actor.userId, body: input.body.trim(), attachmentAssetIds: attachments, clientId: input.clientId ?? null });
  } catch (e) {
    if (isDuplicateKeyError(e) && input.clientId) {
      const existing = await Message.findOne({ conversationId: c._id, senderId: actor.userId, clientId: input.clientId }).lean();
      if (existing) return existing; // retried send
    }
    throw e;
  }
  const preview = input.body.trim().slice(0, 140) || "📎 Attachment";
  await Conversation.updateOne({ _id: c._id }, { $set: { lastMessageAt: message.createdAt, lastMessagePreview: preview } });
  await markConversationRead(actor, conversationId);
  const recipient = c.landlordId.toString() === actor.userId ? c.tenantId.toString() : c.landlordId.toString();
  // At most one "new message" notification per conversation per recipient per hour.
  const hourBucket = Math.floor(Date.now() / 3600_000);
  await notify({
    userId: recipient,
    type: "message_received",
    title: `New message from ${actor.name}`,
    body: preview,
    link: recipient === c.tenantId.toString() ? `/tenant/messages/${c._id}` : `/landlord/messages/${c._id}`,
    dedupeKey: `message:${c._id}:${recipient}:${hourBucket}`,
  });
  return message.toObject();
}

export async function markConversationRead(actor: Actor, conversationId: string) {
  const c = await getConversationForActor(actor, conversationId);
  const me = new ObjectId(actor.userId);
  const now = new Date();
  const res = await Conversation.updateOne({ _id: c._id, "readState.userId": me }, { $set: { "readState.$.lastReadAt": now } });
  if (res.matchedCount === 0) await Conversation.updateOne({ _id: c._id }, { $push: { readState: { userId: me, lastReadAt: now } } });
}

export async function conversationForTenancy(actor: Actor, tenancyId: string) {
  await connectDb();
  const c = await Conversation.findOne({ tenancyId: assertId(tenancyId), participantIds: new ObjectId(actor.userId) }).select("_id").lean();
  return c?._id.toString() ?? null;
}

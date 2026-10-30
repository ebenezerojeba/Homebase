import "server-only";
import { z } from "zod";
import { errors } from "@/lib/errors";
import { requiredText, shortText } from "@/lib/validation";
import { connectDb } from "@/server/db";
import { AuditLog, DataRequest, Job, Notification, Payment, Receipt, Tenancy, User, WebhookEvent } from "@/server/models";
import type { Actor } from "@/server/auth/actor";
import { revokeAllSessions } from "@/server/auth/session";
import { assertId } from "./access";
import { audit } from "./audit";

function requireAdmin(actor: Actor) {
  if (actor.role !== "admin") throw errors.notFound();
}

/* ---------------- Data subject requests (NDPA 2023) ---------------- */

export const dataRequestSchema = z.object({
  type: z.enum(["access", "correction", "deletion"]),
  details: requiredText(2000, "Tell us what you need"),
});

export async function createDataRequest(actor: Actor, input: z.infer<typeof dataRequestSchema>) {
  await connectDb();
  const open = await DataRequest.countDocuments({ userId: actor.userId, status: { $in: ["open", "in_progress"] } });
  if (open >= 3) throw errors.conflict("You already have open requests. We'll respond to those first.");
  const r = await DataRequest.create({ userId: actor.userId, type: input.type, details: input.details });
  await audit(actor, "privacy.request_created", "DataRequest", r._id.toString(), { type: input.type });
  return r.toObject();
}

export async function listMyDataRequests(actor: Actor) {
  await connectDb();
  return DataRequest.find({ userId: actor.userId }).sort({ createdAt: -1 }).limit(20).lean();
}

/** Self-service copy of the personal data we hold about the user (right of access). */
export async function exportMyData(actor: Actor) {
  await connectDb();
  const user = await User.findById(actor.userId).select("name email phone role emailVerifiedAt status createdAt emailOptOut privacyAcceptedAt").lean();
  const tenancyFilter = actor.role === "landlord" ? { landlordId: actor.userId } : { tenantId: actor.userId };
  const [tenancies, payments, receipts, notifications] = await Promise.all([
    Tenancy.find(tenancyFilter).select("tenantName tenantEmail startDate endDate frequency rentSchedule status propertyId unitId").lean(),
    Payment.find(actor.role === "landlord" ? { landlordId: actor.userId } : { tenantId: actor.userId }).select("-statusHistory -providerData").lean(),
    Receipt.find(actor.role === "landlord" ? { landlordId: actor.userId } : { tenantId: actor.userId }).lean(),
    Notification.find({ userId: actor.userId }).select("type title createdAt readAt").sort({ createdAt: -1 }).limit(500).lean(),
  ]);
  await audit(actor, "privacy.data_exported", "User", actor.userId);
  return { exportedAt: new Date().toISOString(), user, tenancies, payments, receipts, notifications };
}

export async function listDataRequests(actor: Actor, status?: string) {
  requireAdmin(actor);
  await connectDb();
  const filter: Record<string, unknown> = status ? { status } : {};
  return DataRequest.find(filter).sort({ createdAt: 1 }).limit(200).populate<{ userId: { name: string; email: string; role: string } }>("userId", "name email role").lean();
}

export const resolveRequestSchema = z.object({ status: z.enum(["in_progress", "completed", "declined"]), resolutionNote: shortText(2000).optional() });

export async function resolveDataRequest(actor: Actor, id: string, input: z.infer<typeof resolveRequestSchema>) {
  requireAdmin(actor);
  await connectDb();
  const r = await DataRequest.findOneAndUpdate(
    { _id: assertId(id) },
    { $set: { status: input.status, resolutionNote: input.resolutionNote ?? null, ...(input.status !== "in_progress" ? { resolvedBy: actor.userId, resolvedAt: new Date() } : {}) } },
    { returnDocument: "after" },
  ).lean();
  if (!r) throw errors.notFound();
  await audit(actor, "admin.data_request_updated", "DataRequest", r._id.toString(), { status: input.status });
}

/* ---------------- Admin console (no access to tenancy financial detail) ---------------- */

export async function adminOverview(actor: Actor) {
  requireAdmin(actor);
  await connectDb();
  const [users, openRequests, deadJobs, failedWebhooks, failedEmails] = await Promise.all([
    User.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$role", n: { $sum: 1 } } }]),
    DataRequest.countDocuments({ status: { $in: ["open", "in_progress"] } }),
    Job.find({ status: "dead" }).sort({ updatedAt: -1 }).limit(20).select("type dedupeKey lastError updatedAt attempts").lean(),
    WebhookEvent.find({ status: "failed" }).sort({ receivedAt: -1 }).limit(20).select("provider eventType reference lastError attempts receivedAt").lean(),
    Notification.countDocuments({ "email.status": "failed" }),
  ]);
  return { users, openRequests, deadJobs, failedWebhooks, failedEmails };
}

export const adminUserQuery = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1) });

export async function adminListUsers(actor: Actor, q: z.infer<typeof adminUserQuery>) {
  requireAdmin(actor);
  await connectDb();
  const filter: Record<string, unknown> = {};
  if (q.q) {
    const escaped = q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ email: { $regex: escaped, $options: "i" } }, { name: { $regex: escaped, $options: "i" } }];
  }
  await audit(actor, "admin.users_viewed", "User", null, { query: q.q ?? null });
  const items = await User.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * 50).limit(50).select("name email role status emailVerifiedAt createdAt lastLoginAt").lean();
  return { items };
}

export async function adminSetUserStatus(actor: Actor, userId: string, status: "active" | "deactivated", reason: string) {
  requireAdmin(actor);
  if (userId === actor.userId) throw errors.conflict("You can't change your own account status");
  await connectDb();
  const u = await User.findOneAndUpdate(
    { _id: assertId(userId), role: { $ne: "admin" } },
    { $set: { status, deactivatedAt: status === "deactivated" ? new Date() : null, deactivationReason: status === "deactivated" ? reason : null } },
    { returnDocument: "after" },
  ).lean();
  if (!u) throw errors.notFound();
  if (status === "deactivated") await revokeAllSessions(userId);
  await audit(actor, `admin.user_${status}`, "User", userId, { reason });
}

export async function adminAuditLog(actor: Actor, page = 1) {
  requireAdmin(actor);
  await connectDb();
  return AuditLog.find({}).sort({ at: -1 }).skip((page - 1) * 100).limit(100).populate<{ actorId: { name: string; email: string } | null }>("actorId", "name email").lean();
}

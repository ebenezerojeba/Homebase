import "server-only";
import mongoose from "mongoose";
import { z } from "zod";
import { parseISODate } from "@/lib/dates";
import { errors } from "@/lib/errors";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { isoDate, objectId, requiredText, shortText } from "@/lib/validation";
import { connectDb, withTransaction } from "@/server/db";
import {
  Expense,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  MaintenanceComment,
  MaintenanceRequest,
  type IMaintenanceRequest,
  type MaintenanceStatus,
} from "@/server/models";
import type { Actor } from "@/server/auth/actor";
import { assertId, getTenancyForActor, tenancyScope } from "./access";
import { assertOwnAssets } from "./assets";
import { audit, recordTimeline } from "./audit";
import { notify } from "./notifications";

const opt = (s: mongoose.ClientSession | null) => ({ session: s ?? undefined });

/** Allowed landlord transitions. Completed/cancelled requests can be reopened (back to acknowledged). */
const TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  submitted: ["acknowledged", "scheduled", "in_progress", "awaiting_tenant", "completed", "cancelled"],
  acknowledged: ["scheduled", "in_progress", "awaiting_tenant", "completed", "cancelled"],
  scheduled: ["in_progress", "awaiting_tenant", "completed", "cancelled"],
  in_progress: ["awaiting_tenant", "scheduled", "completed", "cancelled"],
  awaiting_tenant: ["acknowledged", "scheduled", "in_progress", "completed", "cancelled"],
  completed: ["acknowledged", "in_progress"],
  cancelled: ["acknowledged"],
};

export function allowedNextStatuses(from: MaintenanceStatus): MaintenanceStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: MaintenanceStatus, to: MaintenanceStatus) {
  return TRANSITIONS[from].includes(to);
}

export const createRequestSchema = z.object({
  tenancyId: objectId,
  title: requiredText(120, "Add a short title"),
  description: requiredText(4000, "Describe the problem"),
  category: z.enum(MAINTENANCE_CATEGORIES),
  priority: z.enum(MAINTENANCE_PRIORITIES).default("normal"),
  assetIds: z.array(objectId).max(8).default([]),
});

export async function createMaintenanceRequest(actor: Actor, input: z.infer<typeof createRequestSchema>) {
  const t = await getTenancyForActor(actor, input.tenancyId);
  if (t.status !== "active") throw errors.conflict("Repair requests can only be raised on active tenancies");
  const assetIds = await assertOwnAssets(actor, input.assetIds, t._id.toString(), ["maintenance_photo"]);
  return withTransaction(async (session) => {
    const now = new Date();
    const [req] = await MaintenanceRequest.create(
      [
        {
          tenancyId: t._id,
          propertyId: t.propertyId,
          unitId: t.unitId,
          landlordId: t.landlordId,
          tenantId: t.tenantId ?? null,
          reportedBy: actor.userId,
          title: input.title,
          description: input.description,
          category: input.category,
          priority: input.priority,
          assetIds,
          lastActivityAt: now,
        },
      ],
      opt(session),
    );
    await MaintenanceComment.create(
      [{ requestId: req!._id, tenancyId: t._id, authorId: actor.userId, authorRole: actor.role, visibility: "shared", kind: "status_change", toStatus: "submitted", body: null, assetIds: [] }],
      opt(session),
    );
    await recordTimeline(
      {
        tenancyId: t._id.toString(),
        landlordId: t.landlordId.toString(),
        type: "maintenance_submitted",
        source: actor.role === "tenant" ? "tenant_submitted" : "landlord_recorded",
        actor,
        summary: `Repair request: "${input.title}" (${label(input.category)}, ${input.priority} priority)`,
        entityType: "MaintenanceRequest",
        entityId: req!._id.toString(),
        metadata: { photos: assetIds.length },
      },
      session,
    );
    const recipient = actor.role === "tenant" ? t.landlordId.toString() : t.tenantId?.toString();
    if (recipient) {
      await notify(
        {
          userId: recipient,
          type: "maintenance_update",
          title: `New repair request: ${input.title}`,
          body: `${actor.role === "tenant" ? t.tenantName : "Your landlord"} reported: ${input.title} (${input.priority} priority).`,
          link: actor.role === "tenant" ? `/landlord/maintenance/${req!._id}` : `/tenant/maintenance/${req!._id}`,
          dedupeKey: `maintenance_new:${req!._id}`,
        },
        session,
      );
    }
    await audit(actor, "maintenance.created", "MaintenanceRequest", req!._id.toString(), undefined, session);
    return req!;
  });
}

async function getRequestForActor(actor: Actor, requestId: string, session: mongoose.ClientSession | null = null) {
  await connectDb();
  const scope = await tenancyScope(actor);
  const req = await MaintenanceRequest.findOne({ _id: assertId(requestId), ...scope }).session(session).lean();
  if (!req) throw errors.notFound("Request not found");
  return req;
}

export const updateRequestSchema = z.object({
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
  assignedTo: shortText(120).nullable().optional(),
  expectedDate: isoDate.nullable().optional(),
  completionNotes: shortText(2000).optional(),
  costKobo: z.number().int().min(0).max(100_000_000_000_00).nullable().optional(),
  /** Tenant-visible message accompanying the change. */
  message: shortText(4000).optional(),
  recordExpense: z.boolean().default(false),
});

/** Landlord workflow update. Every change is logged in the request history and shared tenancy record. */
export async function updateMaintenanceRequest(actor: Actor, requestId: string, input: z.infer<typeof updateRequestSchema>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  const req = await getRequestForActor(actor, requestId);
  if (input.status && input.status !== req.status && !canTransition(req.status, input.status)) {
    throw errors.validation(`Can't move a ${label(req.status)} request to ${label(input.status)}`);
  }
  return withTransaction(async (session) => {
    const set: Partial<IMaintenanceRequest> & Record<string, unknown> = { lastActivityAt: new Date() };
    const changes: string[] = [];
    if (input.priority && input.priority !== req.priority) {
      set.priority = input.priority;
      changes.push(`priority set to ${input.priority}`);
    }
    if (input.assignedTo !== undefined && input.assignedTo !== req.assignedTo) {
      set.assignedTo = input.assignedTo || null;
      changes.push(input.assignedTo ? `assigned to ${input.assignedTo}` : "assignment cleared");
    }
    if (input.expectedDate !== undefined) {
      set.expectedDate = input.expectedDate ? parseISODate(input.expectedDate) : null;
      if (input.expectedDate) changes.push(`expected ${input.expectedDate}`);
    }
    if (input.completionNotes !== undefined) set.completionNotes = input.completionNotes || null;
    if (input.costKobo !== undefined) set.costKobo = input.costKobo;
    const statusChanged = Boolean(input.status && input.status !== req.status);
    if (statusChanged) {
      set.status = input.status!;
      if (input.status === "completed") {
        set.completedAt = new Date();
        set.tenantConfirmation = req.tenantId ? "pending" : "not_requested";
      }
      if (input.status !== "completed" && req.status === "completed") set.completedAt = null;
      changes.unshift(`status ${label(req.status)} → ${label(input.status!)}`);
    }
    const res = await MaintenanceRequest.updateOne({ _id: req._id, status: req.status }, { $set: set }, opt(session));
    if (res.matchedCount !== 1) throw errors.conflict("This request was updated by someone else. Please reload.");

    if (statusChanged || changes.length || input.message) {
      await MaintenanceComment.create(
        [
          {
            requestId: req._id,
            tenancyId: req.tenancyId,
            authorId: actor.userId,
            authorRole: "landlord",
            visibility: "shared",
            kind: statusChanged ? "status_change" : input.message ? "comment" : "assignment",
            body: [changes.length && !statusChanged ? changes.join("; ") : null, input.message].filter(Boolean).join("\n") || null,
            fromStatus: statusChanged ? req.status : null,
            toStatus: statusChanged ? input.status : null,
            assetIds: [],
          },
        ],
        opt(session),
      );
    }
    if (statusChanged) {
      await recordTimeline(
        {
          tenancyId: req.tenancyId.toString(),
          landlordId: actor.userId,
          type: "maintenance_status_changed",
          source: "landlord_recorded",
          actor,
          summary: `Repair "${req.title}": ${changes.join(", ")}`,
          entityType: "MaintenanceRequest",
          entityId: req._id.toString(),
          before: { status: req.status },
          after: { status: input.status },
        },
        session,
      );
    }
    let expenseId: string | null = null;
    if (input.recordExpense && input.costKobo && input.costKobo > 0) {
      const existing = await Expense.findOne({ maintenanceRequestId: req._id, status: "recorded" }).session(session).lean();
      if (existing) throw errors.conflict("An expense is already recorded for this request. Void it first to record a new one.");
      const [exp] = await Expense.create(
        [
          {
            landlordId: actor.userId,
            propertyId: req.propertyId,
            unitId: req.unitId,
            maintenanceRequestId: req._id,
            category: "repairs",
            description: `Repair: ${req.title}`,
            amountKobo: input.costKobo,
            incurredOn: new Date(),
            recordedBy: actor.userId,
          },
        ],
        opt(session),
      );
      expenseId = exp!._id.toString();
      await audit(actor, "expense.recorded", "Expense", expenseId, { amountKobo: input.costKobo, maintenanceRequestId: req._id.toString() }, session);
    }
    if (req.tenantId && (statusChanged || input.message)) {
      await notify(
        {
          userId: req.tenantId.toString(),
          type: "maintenance_update",
          title: `Repair update: ${req.title}`,
          body: statusChanged
            ? `Status is now ${label(input.status!)}.${input.status === "completed" ? " Please confirm whether the issue is resolved." : ""}${input.message ? ` Message: ${input.message.slice(0, 200)}` : ""}`
            : `New message from your landlord: ${input.message!.slice(0, 200)}`,
          link: `/tenant/maintenance/${req._id}`,
          dedupeKey: `maintenance:${req._id}:${Date.now()}`,
        },
        session,
      );
    }
    await audit(actor, "maintenance.updated", "MaintenanceRequest", req._id.toString(), { changes }, session);
    return { expenseId, costKobo: input.costKobo ? formatKobo(input.costKobo) : null };
  });
}

export const commentSchema = z.object({
  body: requiredText(4000, "Write a message"),
  /** Only landlords can post internal notes. */
  internal: z.boolean().default(false),
  assetIds: z.array(objectId).max(6).default([]),
});

export async function addMaintenanceComment(actor: Actor, requestId: string, input: z.infer<typeof commentSchema>) {
  const req = await getRequestForActor(actor, requestId);
  if (input.internal && actor.role !== "landlord") throw errors.forbidden("Only landlords can add internal notes");
  const assetIds = await assertOwnAssets(actor, input.assetIds, req.tenancyId.toString(), ["maintenance_photo"]);
  return withTransaction(async (session) => {
    const [c] = await MaintenanceComment.create(
      [
        {
          requestId: req._id,
          tenancyId: req.tenancyId,
          authorId: actor.userId,
          authorRole: actor.role,
          visibility: input.internal ? "internal" : "shared",
          kind: "comment",
          body: input.body,
          assetIds,
        },
      ],
      opt(session),
    );
    await MaintenanceRequest.updateOne(
      { _id: req._id },
      { $set: { lastActivityAt: new Date(), ...(actor.role === "tenant" && req.status === "awaiting_tenant" ? { status: "acknowledged" } : {}) } },
      opt(session),
    );
    if (!input.internal) {
      if (actor.role === "tenant" && req.status === "awaiting_tenant") {
        await MaintenanceComment.create(
          [{ requestId: req._id, tenancyId: req.tenancyId, authorId: null, authorRole: "system", visibility: "shared", kind: "status_change", fromStatus: "awaiting_tenant", toStatus: "acknowledged", body: "Tenant responded", assetIds: [] }],
          opt(session),
        );
      }
      const recipient = actor.role === "tenant" ? req.landlordId.toString() : req.tenantId?.toString();
      if (recipient) {
        await notify(
          {
            userId: recipient,
            type: "maintenance_update",
            title: `New comment on "${req.title}"`,
            body: input.body.slice(0, 200),
            link: actor.role === "tenant" ? `/landlord/maintenance/${req._id}` : `/tenant/maintenance/${req._id}`,
            dedupeKey: `maintenance_comment:${c!._id}`,
          },
          session,
        );
      }
    }
    return c!;
  });
}

export const tenantConfirmSchema = z.object({ resolved: z.boolean(), comment: shortText(1000).optional() });

/** Tenant confirms the repair is done, or reports it's still not resolved (which reopens it). */
export async function tenantConfirmCompletion(actor: Actor, requestId: string, input: z.infer<typeof tenantConfirmSchema>) {
  if (actor.role !== "tenant") throw errors.forbidden();
  const req = await getRequestForActor(actor, requestId);
  if (req.status !== "completed" || req.tenantConfirmation !== "pending") throw errors.conflict("This request isn't awaiting your confirmation");
  return withTransaction(async (session) => {
    const res = await MaintenanceRequest.updateOne(
      { _id: req._id, status: "completed", tenantConfirmation: "pending" },
      {
        $set: {
          tenantConfirmation: input.resolved ? "confirmed_resolved" : "reported_unresolved",
          lastActivityAt: new Date(),
          ...(input.resolved ? {} : { status: "acknowledged", completedAt: null }),
        },
      },
      opt(session),
    );
    if (res.modifiedCount !== 1) throw errors.conflict("Already confirmed");
    await MaintenanceComment.create(
      [
        {
          requestId: req._id,
          tenancyId: req.tenancyId,
          authorId: actor.userId,
          authorRole: "tenant",
          visibility: "shared",
          kind: "tenant_confirmation",
          body: `${input.resolved ? "Tenant confirmed the issue is resolved" : "Tenant reported the issue is NOT resolved"}${input.comment ? `: ${input.comment}` : ""}`,
          fromStatus: input.resolved ? null : "completed",
          toStatus: input.resolved ? null : "acknowledged",
          assetIds: [],
        },
      ],
      opt(session),
    );
    await recordTimeline(
      {
        tenancyId: req.tenancyId.toString(),
        landlordId: req.landlordId.toString(),
        type: "maintenance_tenant_confirmation",
        source: "tenant_submitted",
        actor,
        summary: `Repair "${req.title}": tenant ${input.resolved ? "confirmed it is resolved" : "reported it is not resolved — reopened"}`,
        entityType: "MaintenanceRequest",
        entityId: req._id.toString(),
      },
      session,
    );
    await notify(
      {
        userId: req.landlordId.toString(),
        type: "maintenance_update",
        title: input.resolved ? `Repair confirmed: ${req.title}` : `Repair not resolved: ${req.title}`,
        body: input.resolved ? "The tenant confirmed the repair is complete." : `The tenant reports the issue is not resolved.${input.comment ? ` "${input.comment.slice(0, 200)}"` : ""}`,
        link: `/landlord/maintenance/${req._id}`,
        dedupeKey: `maintenance_confirm:${req._id}:${Date.now()}`,
      },
      session,
    );
  });
}

export async function getMaintenanceDetail(actor: Actor, requestId: string) {
  const req = await getRequestForActor(actor, requestId);
  // Internal notes are filtered in the query itself, never in the UI.
  const visibility: ("shared" | "internal")[] = actor.role === "landlord" ? ["shared", "internal"] : ["shared"];
  const [history, expense] = await Promise.all([
    MaintenanceComment.find({ requestId: req._id, visibility: { $in: visibility } }).sort({ createdAt: 1 }).populate<{ authorId: { name: string } | null }>("authorId", "name").lean(),
    actor.role === "landlord" ? Expense.findOne({ maintenanceRequestId: req._id, status: "recorded" }).select("amountKobo incurredOn").lean() : null,
  ]);
  const tenancy = await getTenancyForActor(actor, req.tenancyId.toString());
  return { request: req, history, expense, tenancy: { _id: tenancy._id, tenantName: tenancy.tenantName } };
}

export const maintenanceFilter = z.object({
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  open: z.enum(["true", "false"]).optional(),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
  propertyId: objectId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listMaintenance(actor: Actor, f: z.infer<typeof maintenanceFilter>) {
  const scope = await tenancyScope(actor);
  const filter: Record<string, unknown> = { ...scope };
  if (f.status) filter.status = f.status;
  else if (f.open === "true") filter.status = { $nin: ["completed", "cancelled"] };
  if (f.priority) filter.priority = f.priority;
  if (f.propertyId && actor.role === "landlord") filter.propertyId = f.propertyId;
  const [items, total] = await Promise.all([
    MaintenanceRequest.find(filter)
      .sort({ lastActivityAt: -1 })
      .skip((f.page - 1) * f.pageSize)
      .limit(f.pageSize)
      .populate<{ propertyId: { name: string } }>("propertyId", "name")
      .populate<{ unitId: { unitNumber: string } }>("unitId", "unitNumber")
      .lean(),
    MaintenanceRequest.countDocuments(filter),
  ]);
  return { items, total };
}

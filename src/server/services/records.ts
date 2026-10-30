import "server-only";
import type mongoose from "mongoose";
import { z } from "zod";
import { parseISODate } from "@/lib/dates";
import { errors } from "@/lib/errors";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { isoDate, koboAmount, objectId, requiredText, shortText } from "@/lib/validation";
import { connectDb, withTransaction } from "@/server/db";
import { EXPENSE_CATEGORIES, Expense, Inspection, TIMELINE_EVENT_TYPES, TimelineEvent } from "@/server/models";
import type { Actor } from "@/server/auth/actor";
import { assertId, getOwnedProperty, getOwnedUnit, getTenancyForActor } from "./access";
import { assertOwnAssets } from "./assets";
import { audit, recordTimeline } from "./audit";
import { notify } from "./notifications";

/* ---------------- Shared Tenancy Record ---------------- */

export const timelineQuery = z.object({
  type: z.enum(TIMELINE_EVENT_TYPES).optional(),
  category: z.enum(["all", "payments", "terms", "maintenance", "documents"]).default("all"),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const CATEGORY_TYPES: Record<string, string[]> = {
  payments: ["payment_submitted", "payment_recorded", "payment_initiated", "payment_confirmed", "payment_rejected", "payment_failed", "payment_reversed", "payment_refunded", "credit_applied", "receipt_issued", "charge_created", "charge_adjusted", "correction"],
  terms: ["tenancy_created", "tenancy_terms_changed", "tenancy_renewed", "tenancy_ended", "tenant_invited", "tenant_joined", "terms_acknowledged", "notice_sent"],
  maintenance: ["maintenance_submitted", "maintenance_status_changed", "maintenance_comment", "maintenance_tenant_confirmation"],
  documents: ["agreement_uploaded", "document_uploaded", "inspection_recorded", "inspection_response"],
};

/** Chronological, filterable timeline. Tenants never see landlord-only entries. */
export async function getTimeline(actor: Actor, tenancyId: string, q: z.infer<typeof timelineQuery>) {
  const t = await getTenancyForActor(actor, tenancyId);
  const filter: Record<string, unknown> = { tenancyId: t._id };
  if (actor.role !== "landlord") filter.visibility = "shared";
  if (q.type) filter.type = q.type;
  else if (q.category !== "all") filter.type = { $in: CATEGORY_TYPES[q.category] };
  if (q.before) filter.occurredAt = { $lt: new Date(q.before) };
  const items = await TimelineEvent.find(filter)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(q.limit + 1)
    .populate<{ actorId: { name: string } | null }>("actorId", "name")
    .lean();
  const hasMore = items.length > q.limit;
  const page = items.slice(0, q.limit);
  return { tenancy: t, events: page, hasMore, nextBefore: hasMore ? page[page.length - 1]!.occurredAt.toISOString() : null };
}

/* ---------------- Inspections ---------------- */

export const inspectionSchema = z.object({
  tenancyId: objectId,
  type: z.enum(["move_in", "move_out"]),
  inspectedOn: isoDate,
  summary: shortText(2000).optional(),
  items: z
    .array(
      z.object({
        area: requiredText(80, "Name the area"),
        condition: z.enum(["good", "fair", "poor", "damaged", "missing"]),
        notes: shortText(1000).optional(),
        assetIds: z.array(objectId).max(8).default([]),
      }),
    )
    .min(1, "Add at least one area")
    .max(60),
  finalize: z.boolean().default(true),
});

export async function recordInspection(actor: Actor, input: z.infer<typeof inspectionSchema>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  const t = await getTenancyForActor(actor, input.tenancyId);
  const items: { area: string; condition: "good" | "fair" | "poor" | "damaged" | "missing"; notes: string | null; assetIds: mongoose.Types.ObjectId[] }[] = [];
  for (const it of input.items) {
    items.push({ ...it, notes: it.notes ?? null, assetIds: await assertOwnAssets(actor, it.assetIds, t._id.toString(), ["inspection_photo"]) });
  }
  const photoCount = items.reduce((s, i) => s + i.assetIds.length, 0);
  return withTransaction(async (session) => {
    const [ins] = await Inspection.create(
      [
        {
          tenancyId: t._id,
          landlordId: t.landlordId,
          tenantId: t.tenantId ?? null,
          type: input.type,
          inspectedOn: parseISODate(input.inspectedOn),
          conductedBy: actor.userId,
          items,
          summary: input.summary ?? null,
          status: (input.finalize ? "finalized" : "draft") as "finalized" | "draft",
          finalizedAt: input.finalize ? new Date() : null,
        },
      ],
      { session: session ?? undefined },
    );
    if (input.finalize) {
      await recordTimeline(
        {
          tenancyId: t._id.toString(),
          landlordId: actor.userId,
          type: "inspection_recorded",
          source: "landlord_recorded",
          actor,
          summary: `${label(input.type)} inspection recorded for ${input.inspectedOn}: ${items.length} area(s), ${photoCount} dated photo(s)`,
          entityType: "Inspection",
          entityId: ins!._id.toString(),
          metadata: { conditions: items.map((i) => `${i.area}: ${i.condition}`).slice(0, 20) },
        },
        session,
      );
      if (t.tenantId) {
        await notify(
          {
            userId: t.tenantId.toString(),
            type: "tenancy_update",
            title: `${label(input.type)} inspection recorded`,
            body: `Your landlord recorded a ${label(input.type).toLowerCase()} inspection. Please review it and acknowledge or note anything you disagree with.`,
            link: `/tenant/tenancy/inspections/${ins!._id}`,
            dedupeKey: `inspection:${ins!._id}`,
          },
          session,
        );
      }
    }
    await audit(actor, "inspection.recorded", "Inspection", ins!._id.toString(), undefined, session);
    return ins!;
  });
}

export const inspectionResponseSchema = z.object({ status: z.enum(["acknowledged", "disputed"]), comment: shortText(1000).optional() });

export async function respondToInspection(actor: Actor, inspectionId: string, input: z.infer<typeof inspectionResponseSchema>) {
  if (actor.role !== "tenant") throw errors.forbidden();
  await connectDb();
  const ins = await Inspection.findOne({ _id: assertId(inspectionId), tenantId: actor.userId, status: "finalized" }).lean();
  if (!ins) throw errors.notFound("Inspection not found");
  if (input.status === "disputed" && !input.comment) throw errors.validation("Say what you disagree with", { comment: ["Required when disputing"] });
  await withTransaction(async (session) => {
    const res = await Inspection.updateOne(
      { _id: ins._id, "tenantResponse.status": "pending" },
      { $set: { tenantResponse: { status: input.status, at: new Date(), comment: input.comment ?? null } } },
      { session: session ?? undefined },
    );
    if (res.modifiedCount !== 1) throw errors.conflict("You've already responded to this inspection");
    await recordTimeline(
      {
        tenancyId: ins.tenancyId.toString(),
        landlordId: ins.landlordId.toString(),
        type: "inspection_response",
        source: "tenant_submitted",
        actor,
        summary: `Tenant ${input.status} the ${label(ins.type).toLowerCase()} inspection${input.comment ? `: ${input.comment}` : ""}`,
        entityType: "Inspection",
        entityId: ins._id.toString(),
      },
      session,
    );
    await notify(
      {
        userId: ins.landlordId.toString(),
        type: "tenancy_update",
        title: `Tenant ${input.status} the inspection`,
        body: input.comment ? input.comment.slice(0, 200) : `The ${label(ins.type).toLowerCase()} inspection was acknowledged.`,
        link: `/landlord/tenancies/${ins.tenancyId}`,
        dedupeKey: `inspection_response:${ins._id}`,
      },
      session,
    );
  });
}

export async function listInspections(actor: Actor, tenancyId: string) {
  const t = await getTenancyForActor(actor, tenancyId);
  const filter: Record<string, unknown> = { tenancyId: t._id };
  if (actor.role === "tenant") filter.status = "finalized";
  return Inspection.find(filter).sort({ inspectedOn: -1 }).lean();
}

export async function getInspection(actor: Actor, inspectionId: string) {
  await connectDb();
  const ins = await Inspection.findById(assertId(inspectionId)).lean();
  if (!ins) throw errors.notFound();
  await getTenancyForActor(actor, ins.tenancyId.toString()); // access check
  if (actor.role === "tenant" && ins.status !== "finalized") throw errors.notFound();
  return ins;
}

/* ---------------- Expenses ---------------- */

export const expenseSchema = z.object({
  propertyId: objectId,
  unitId: objectId.optional(),
  category: z.enum(EXPENSE_CATEGORIES),
  description: requiredText(500, "Describe the expense"),
  amountKobo: koboAmount,
  incurredOn: isoDate,
  vendor: shortText(120).optional(),
  receiptAssetId: objectId.optional(),
});

export async function recordExpense(actor: Actor, input: z.infer<typeof expenseSchema>) {
  const p = await getOwnedProperty(actor, input.propertyId);
  if (input.unitId) {
    const u = await getOwnedUnit(actor, input.unitId);
    if (!u.propertyId.equals(p._id)) throw errors.validation("That unit is on a different property");
  }
  const e = await Expense.create({
    landlordId: actor.userId,
    propertyId: p._id,
    unitId: input.unitId ?? null,
    category: input.category,
    description: input.description,
    amountKobo: input.amountKobo,
    incurredOn: parseISODate(input.incurredOn),
    vendor: input.vendor ?? null,
    receiptAssetId: input.receiptAssetId ?? null,
    recordedBy: actor.userId,
  });
  await audit(actor, "expense.recorded", "Expense", e._id.toString(), { amountKobo: input.amountKobo, category: input.category });
  return e.toObject();
}

/** Expenses are voided with a reason rather than deleted. */
export async function voidExpense(actor: Actor, expenseId: string, reason: string) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const res = await Expense.findOneAndUpdate(
    { _id: assertId(expenseId), landlordId: actor.userId, status: "recorded" },
    { $set: { status: "voided", voidReason: reason, voidedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!res) throw errors.notFound("Expense not found");
  await audit(actor, "expense.voided", "Expense", res._id.toString(), { reason, amount: formatKobo(res.amountKobo) });
}

export const expenseFilter = z.object({
  propertyId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listExpenses(actor: Actor, f: z.infer<typeof expenseFilter>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const filter: Record<string, unknown> = { landlordId: actor.userId };
  if (f.propertyId) filter.propertyId = f.propertyId;
  if (f.from || f.to) filter.incurredOn = { ...(f.from ? { $gte: parseISODate(f.from) } : {}), ...(f.to ? { $lte: parseISODate(f.to) } : {}) };
  const [items, total] = await Promise.all([
    Expense.find(filter).sort({ incurredOn: -1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).populate<{ propertyId: { name: string } }>("propertyId", "name").lean(),
    Expense.countDocuments(filter),
  ]);
  return { items, total };
}

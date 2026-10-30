import "server-only";
import mongoose from "mongoose";
import { z } from "zod";
import { addDays, diffDays, parseISODate, toISODate, todayInBusinessTz } from "@/lib/dates";
import { env } from "@/lib/env";
import { errors, isDuplicateKeyError } from "@/lib/errors";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { email, isoDate, koboAmount, objectId, password, personName, shortText } from "@/lib/validation";
import { connectDb, withTransaction } from "@/server/db";
import {
  Conversation,
  FREQUENCIES,
  Invitation,
  MaintenanceRequest,
  Payment,
  Property,
  Receipt,
  RentCharge,
  Tenancy,
  Unit,
  User,
  type ITenancy,
} from "@/server/models";
import { emailProvider, renderEmail } from "@/server/providers/email";
import type { Actor } from "@/server/auth/actor";
import { generateToken, hashPassword, hashToken } from "@/server/auth/crypto";
import { createSession } from "@/server/auth/session";
import { assertId, getLandlordTenancy, getOwnedUnit, getTenancyForActor } from "./access";
import { audit, recordTimeline } from "./audit";
import { CHARGE_LOOKAHEAD_DAYS, generateCharges, refreshNextDueDate } from "./ledger";
import { notify } from "./notifications";
import { periodAt } from "./schedule";

const { ObjectId } = mongoose.Types;
const INVITE_TTL_DAYS = 7;
const MAX_TENANCY_YEARS = 10;

const agreedChargeInput = z.object({
  label: z.string().trim().min(1).max(80),
  amountKobo: koboAmount,
  recurrence: z.enum(["recurring", "once"]),
});

export const createTenancySchema = z
  .object({
    unitId: objectId,
    tenantName: personName,
    tenantEmail: email,
    startDate: isoDate,
    endDate: isoDate,
    frequency: z.enum(FREQUENCIES),
    rentAmountKobo: koboAmount,
    gracePeriodDays: z.number().int().min(0).max(90).default(0),
    depositAmountKobo: z.number().int().min(0).max(100_000_000_000_00).default(0),
    agreedCharges: z.array(agreedChargeInput).max(10).default([]),
    prorateFinalPeriod: z.boolean().default(false),
    notes: shortText(2000).optional(),
    sendInvite: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const s = parseISODate(v.startDate);
    const e = parseISODate(v.endDate);
    if (e <= s) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after the start date" });
    if (diffDays(e, s) > MAX_TENANCY_YEARS * 366) ctx.addIssue({ code: "custom", path: ["endDate"], message: `Tenancies longer than ${MAX_TENANCY_YEARS} years aren't supported` });
  });

async function assertNoOverlap(unitId: string, start: Date, end: Date, ignoreTenancyId?: string | null, session: mongoose.ClientSession | null = null) {
  const filter: Record<string, unknown> = {
    unitId,
    status: { $in: ["active", "ended", "terminated"] },
    startDate: { $lte: end },
    endDate: { $gte: start },
  };
  if (ignoreTenancyId) filter._id = { $ne: ignoreTenancyId };
  const clash = await Tenancy.findOne(filter).select("startDate endDate").session(session).lean();
  if (clash) {
    throw errors.conflict(
      `These dates overlap another tenancy on this unit (${toISODate(clash.startDate)} to ${toISODate(clash.endDate)}).`,
    );
  }
}

export async function createTenancy(actor: Actor, input: z.infer<typeof createTenancySchema>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  if (!actor.emailVerified) throw errors.forbidden("Please verify your email address before creating tenancies");
  const unit = await getOwnedUnit(actor, input.unitId);
  if (unit.status !== "active") throw errors.conflict("This unit is archived");
  const property = await Property.findOne({ _id: unit.propertyId, landlordId: actor.userId, status: "active" }).lean();
  if (!property) throw errors.conflict("This property is archived");
  const start = parseISODate(input.startDate);
  const end = parseISODate(input.endDate);

  const tenancy = await withTransaction(async (session) => {
    await assertNoOverlap(input.unitId, start, end, null, session);
    const tenancyId = new ObjectId();
    // Atomically claim the unit; fails if another live tenancy holds it.
    const claimed = await Unit.findOneAndUpdate(
      { _id: unit._id, landlordId: actor.userId, status: "active", currentTenancyId: null },
      { $set: { currentTenancyId: tenancyId, occupancy: "occupied" } },
      { session: session ?? undefined, returnDocument: "after" },
    );
    if (!claimed) throw errors.conflict("This unit already has an active tenancy. End or renew it first.");
    const now = new Date();
    const [created] = await Tenancy.create(
      [
        {
          _id: tenancyId,
          landlordId: actor.userId,
          propertyId: unit.propertyId,
          unitId: unit._id,
          tenantName: input.tenantName,
          tenantEmail: input.tenantEmail,
          startDate: start,
          endDate: end,
          frequency: input.frequency,
          rentSchedule: [{ effectiveFrom: start, amountKobo: input.rentAmountKobo, recordedBy: actor.userId, recordedAt: now }],
          agreedCharges: input.agreedCharges,
          gracePeriodDays: input.gracePeriodDays,
          depositAmountKobo: input.depositAmountKobo,
          prorateFinalPeriod: input.prorateFinalPeriod,
          notes: input.notes ?? null,
          createdBy: actor.userId,
        },
      ],
      { session: session ?? undefined },
    );
    await recordTimeline(
      {
        tenancyId: tenancyId.toString(),
        landlordId: actor.userId,
        type: "tenancy_created",
        source: "landlord_recorded",
        actor,
        summary: `Tenancy recorded for ${property.name}, unit ${unit.unitNumber}: ${formatKobo(input.rentAmountKobo)} ${label(input.frequency).toLowerCase()}, ${input.startDate} to ${input.endDate}`,
        entityType: "Tenancy",
        entityId: tenancyId.toString(),
        after: {
          startDate: input.startDate,
          endDate: input.endDate,
          frequency: input.frequency,
          rentAmountKobo: input.rentAmountKobo,
          gracePeriodDays: input.gracePeriodDays,
          depositAmountKobo: input.depositAmountKobo,
          agreedCharges: input.agreedCharges,
        },
      },
      session,
    );
    await audit(actor, "tenancy.created", "Tenancy", tenancyId.toString(), { unitId: input.unitId }, session);
    await generateCharges(tenancyId.toString(), addDays(todayInBusinessTz(), CHARGE_LOOKAHEAD_DAYS), session);
    return created!;
  });

  if (input.sendInvite) {
    await createInvitation(actor, tenancy._id.toString());
  }
  return tenancy;
}

/* ---------------- Invitations ---------------- */

export async function createInvitation(actor: Actor, tenancyId: string) {
  const t = await getLandlordTenancy(actor, tenancyId);
  if (t.tenantId) throw errors.conflict("A tenant has already joined this tenancy");
  if (t.status !== "active") throw errors.conflict("Only active tenancies can have invitations");
  const property = await Property.findById(t.propertyId).select("name").lean();
  const token = generateToken();
  const now = new Date();
  await withTransaction(async (session) => {
    await Invitation.updateMany(
      { tenancyId: t._id, status: "pending" },
      { $set: { status: "revoked", revokedAt: now } },
      { session: session ?? undefined },
    );
    await Invitation.create(
      [
        {
          landlordId: actor.userId,
          tenancyId: t._id,
          email: t.tenantEmail,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86400_000),
          lastSentAt: now,
        },
      ],
      { session: session ?? undefined },
    );
    await recordTimeline(
      {
        tenancyId: t._id.toString(),
        landlordId: actor.userId,
        type: "tenant_invited",
        source: "landlord_recorded",
        actor,
        summary: `Invitation sent to ${t.tenantEmail}`,
        entityType: "Tenancy",
        entityId: t._id.toString(),
      },
      session,
    );
  });
  const url = `${env().APP_URL}/invite/${encodeURIComponent(token)}`;
  const { text, html } = renderEmail({
    heading: `${actor.name} invited you to ${env().APP_NAME}`,
    paragraphs: [
      `Hello ${t.tenantName},`,
      `${actor.name} has set up your tenancy at ${property?.name ?? "their property"} on ${env().APP_NAME}. You'll be able to review the agreed terms, see due dates, pay rent, get receipts and report repairs.`,
      `Please review the terms carefully before accepting. This invitation expires in ${INVITE_TTL_DAYS} days and can be used once.`,
    ],
    cta: { label: "Review invitation", url },
  });
  await emailProvider().send({ to: { email: t.tenantEmail, name: t.tenantName }, subject: `Your tenancy invitation from ${actor.name}`, text, html });
  await audit(actor, "invitation.sent", "Tenancy", t._id.toString());
  return { sent: true, expiresInDays: INVITE_TTL_DAYS, devUrl: process.env.NODE_ENV !== "production" ? url : undefined };
}

export async function revokeInvitation(actor: Actor, tenancyId: string) {
  const t = await getLandlordTenancy(actor, tenancyId);
  await Invitation.updateMany({ tenancyId: t._id, status: "pending" }, { $set: { status: "revoked", revokedAt: new Date() } });
  await audit(actor, "invitation.revoked", "Tenancy", t._id.toString());
}

async function findLiveInvitation(token: string) {
  await connectDb();
  if (!token || token.length > 100) return null;
  const inv = await Invitation.findOne({ tokenHash: hashToken(token) }).lean();
  if (!inv || inv.status !== "pending" || inv.expiresAt <= new Date()) return null;
  return inv;
}

function maskEmail(e: string) {
  const [u, d] = e.split("@");
  return `${u!.slice(0, 2)}${"*".repeat(Math.max(1, u!.length - 2))}@${d}`;
}

/** Public preview of an invitation. Reveals only what the invitee needs to review the terms. */
export async function getInvitationPreview(token: string) {
  const inv = await findLiveInvitation(token);
  if (!inv) return null;
  const t = await Tenancy.findById(inv.tenancyId).lean();
  if (!t || t.status !== "active" || t.tenantId) return null;
  const [property, unit, landlord, accountExists] = await Promise.all([
    Property.findById(t.propertyId).select("name address").lean(),
    Unit.findById(t.unitId).select("unitNumber unitType").lean(),
    User.findById(t.landlordId).select("name").lean(),
    User.exists({ email: inv.email }),
  ]);
  const firstPeriod = periodAt(t, 0);
  return {
    email: inv.email,
    emailMasked: maskEmail(inv.email),
    accountExists: Boolean(accountExists),
    expiresAt: inv.expiresAt,
    landlordName: landlord?.name ?? "Your landlord",
    property: property ? { name: property.name, city: property.address.city, state: property.address.state } : null,
    unit: unit ? { unitNumber: unit.unitNumber, unitType: unit.unitType } : null,
    terms: {
      tenantName: t.tenantName,
      startDate: t.startDate,
      endDate: t.endDate,
      frequency: t.frequency,
      rentAmountKobo: t.rentSchedule[0]!.amountKobo,
      gracePeriodDays: t.gracePeriodDays,
      depositAmountKobo: t.depositAmountKobo,
      agreedCharges: t.agreedCharges.map((c) => ({ label: c.label, amountKobo: c.amountKobo, recurrence: c.recurrence })),
      firstDueDate: firstPeriod?.dueDate ?? null,
    },
  };
}

export const acceptInviteSchema = z.object({
  token: z.string().min(10).max(100),
  acknowledgeTerms: z.literal(true, { error: "Please confirm you have reviewed the tenancy terms" }),
  registration: z
    .object({ name: personName, password, acceptPrivacy: z.literal(true, { error: "Please accept the privacy notice" }) })
    .optional(),
});

/**
 * Accept an invitation. Either the signed-in tenant whose email matches, or a new user registering
 * with the invited email (the emailed link proves they control it). Single use, atomic.
 */
export async function acceptInvitation(actor: Actor | null, input: z.infer<typeof acceptInviteSchema>, userAgent?: string | null) {
  const inv = await findLiveInvitation(input.token);
  if (!inv) throw errors.badRequest("This invitation is invalid, expired or already used. Ask your landlord to send a new one.");

  let tenantId: string;
  let newSession: Awaited<ReturnType<typeof createSession>> | null = null;
  if (actor) {
    if (actor.role !== "tenant") throw errors.forbidden("Please sign in with a tenant account to accept this invitation");
    if (actor.email !== inv.email) throw errors.forbidden("This invitation was sent to a different email address");
    tenantId = actor.userId;
  } else {
    if (!input.registration) throw errors.validation("Create your account to accept this invitation");
    if (await User.exists({ email: inv.email })) {
      throw errors.conflict("An account already exists for this email. Please sign in to accept the invitation.");
    }
    try {
      const user = await User.create({
        name: input.registration.name,
        email: inv.email,
        passwordHash: await hashPassword(input.registration.password),
        role: "tenant",
        emailVerifiedAt: new Date(),
        privacyAcceptedAt: new Date(),
      });
      tenantId = user._id.toString();
    } catch (e) {
      if (isDuplicateKeyError(e)) throw errors.conflict("An account already exists for this email. Please sign in.");
      throw e;
    }
  }

  const result = await withTransaction(async (session) => {
    const claimed = await Invitation.findOneAndUpdate(
      { _id: inv._id, status: "pending", expiresAt: { $gt: new Date() } },
      { $set: { status: "accepted", acceptedAt: new Date(), acceptedBy: tenantId } },
      { session: session ?? undefined, returnDocument: "after" },
    );
    if (!claimed) throw errors.conflict("This invitation has already been used.");
    const now = new Date();
    const tenancy = await Tenancy.findOneAndUpdate(
      { _id: inv.tenancyId, tenantId: null, status: "active" },
      { $set: { tenantId, termsAcknowledgedAt: now } },
      { session: session ?? undefined, returnDocument: "after" },
    );
    if (!tenancy) throw errors.conflict("This tenancy is no longer available.");
    // Link records created before the tenant joined.
    await Payment.updateMany({ tenancyId: tenancy._id, tenantId: null }, { $set: { tenantId } }, { session: session ?? undefined });
    await Receipt.updateMany({ tenancyId: tenancy._id, tenantId: null }, { $set: { tenantId } }, { session: session ?? undefined });
    await MaintenanceRequest.updateMany({ tenancyId: tenancy._id, tenantId: null }, { $set: { tenantId } }, { session: session ?? undefined });
    await Conversation.updateOne(
      { tenancyId: tenancy._id, tenantId },
      {
        $setOnInsert: {
          tenancyId: tenancy._id,
          landlordId: tenancy.landlordId,
          tenantId,
          participantIds: [tenancy.landlordId, new ObjectId(tenantId)],
          readState: [],
        },
      },
      { upsert: true, session: session ?? undefined },
    );
    const tenantActor = { userId: tenantId, role: "tenant" as const, name: "", email: inv.email, emailVerified: true };
    await recordTimeline(
      {
        tenancyId: tenancy._id.toString(),
        landlordId: tenancy.landlordId.toString(),
        type: "tenant_joined",
        source: "tenant_submitted",
        actor: tenantActor,
        summary: `Tenant accepted the invitation and joined`,
        entityType: "Tenancy",
        entityId: tenancy._id.toString(),
      },
      session,
    );
    await recordTimeline(
      {
        tenancyId: tenancy._id.toString(),
        landlordId: tenancy.landlordId.toString(),
        type: "terms_acknowledged",
        source: "tenant_submitted",
        actor: tenantActor,
        summary: `Tenant confirmed they reviewed the recorded tenancy terms`,
        entityType: "Tenancy",
        entityId: tenancy._id.toString(),
        metadata: { rentSchedule: tenancy.rentSchedule.map((r) => ({ effectiveFrom: toISODate(r.effectiveFrom), amountKobo: r.amountKobo })) },
      },
      session,
    );
    await notify(
      {
        userId: tenancy.landlordId.toString(),
        type: "tenancy_update",
        title: `${tenancy.tenantName} joined their tenancy`,
        body: `${tenancy.tenantName} accepted your invitation and can now see their rent schedule, pay and message you.`,
        link: `/landlord/tenancies/${tenancy._id}`,
        dedupeKey: `tenant_joined:${tenancy._id}`,
      },
      session,
    );
    await audit(tenantActor, "invitation.accepted", "Tenancy", tenancy._id.toString(), undefined, session);
    return tenancy;
  });

  if (!actor) newSession = await createSession(tenantId, "tenant", userAgent);
  return { tenancyId: result._id.toString(), session: newSession };
}

/* ---------------- Term changes ---------------- */

export const changeRentSchema = z.object({
  amountKobo: koboAmount,
  effectiveFrom: isoDate,
  note: shortText(500).optional(),
});

/** Record a future rent change. Already-generated charges (and their payments) are never altered. */
export async function changeRent(actor: Actor, tenancyId: string, input: z.infer<typeof changeRentSchema>) {
  const t = await getLandlordTenancy(actor, tenancyId);
  if (t.status !== "active") throw errors.conflict("Only active tenancies can be changed");
  const effectiveFrom = parseISODate(input.effectiveFrom);
  const lastGenerated = periodAt(t, t.generatedThroughIndex);
  if (lastGenerated && effectiveFrom <= lastGenerated.periodStart) {
    throw errors.validation(
      `Rent for periods up to ${toISODate(lastGenerated.periodStart)} has already been billed. Choose a later date, or adjust individual charges instead.`,
      { effectiveFrom: ["Must be after the most recently billed period"] },
    );
  }
  if (effectiveFrom > t.endDate) throw errors.validation("Effective date is after the tenancy ends", { effectiveFrom: ["After tenancy end"] });
  const before = t.rentSchedule.map((r) => ({ effectiveFrom: toISODate(r.effectiveFrom), amountKobo: r.amountKobo }));
  await withTransaction(async (session) => {
    const res = await Tenancy.updateOne(
      { _id: t._id, generatedThroughIndex: t.generatedThroughIndex },
      { $push: { rentSchedule: { effectiveFrom, amountKobo: input.amountKobo, recordedBy: actor.userId, recordedAt: new Date(), note: input.note ?? null } } },
      { session: session ?? undefined },
    );
    if (res.modifiedCount !== 1) throw errors.conflict("The tenancy changed. Please reload and try again.");
    await recordTimeline(
      {
        tenancyId: t._id.toString(),
        landlordId: actor.userId,
        type: "tenancy_terms_changed",
        source: "landlord_recorded",
        actor,
        summary: `Rent recorded as ${formatKobo(input.amountKobo)} from ${input.effectiveFrom}${input.note ? ` (${input.note})` : ""}`,
        entityType: "Tenancy",
        entityId: t._id.toString(),
        before: { rentSchedule: before },
        after: { rentSchedule: [...before, { effectiveFrom: input.effectiveFrom, amountKobo: input.amountKobo }] },
      },
      session,
    );
    await audit(actor, "tenancy.rent_changed", "Tenancy", t._id.toString(), { amountKobo: input.amountKobo, effectiveFrom: input.effectiveFrom }, session);
    if (t.tenantId) {
      await notify(
        {
          userId: t.tenantId.toString(),
          type: "tenancy_update",
          title: "Your recorded rent terms changed",
          body: `Your landlord recorded rent of ${formatKobo(input.amountKobo)} from ${input.effectiveFrom}. Earlier charges are unchanged. Contact your landlord if this doesn't match what you agreed.`,
          link: `/tenant/tenancy`,
          dedupeKey: `rent_change:${t._id}:${input.effectiveFrom}:${input.amountKobo}`,
        },
        session,
      );
    }
  });
}

export const updateTermsSchema = z.object({ gracePeriodDays: z.number().int().min(0).max(90), notes: shortText(2000).optional() });

export async function updateTerms(actor: Actor, tenancyId: string, input: z.infer<typeof updateTermsSchema>) {
  const t = await getLandlordTenancy(actor, tenancyId);
  if (t.status !== "active") throw errors.conflict("Only active tenancies can be changed");
  await withTransaction(async (session) => {
    await Tenancy.updateOne({ _id: t._id }, { $set: { gracePeriodDays: input.gracePeriodDays, notes: input.notes ?? t.notes ?? null } }, { session: session ?? undefined });
    if (input.gracePeriodDays !== t.gracePeriodDays) {
      await recordTimeline(
        {
          tenancyId: t._id.toString(),
          landlordId: actor.userId,
          type: "tenancy_terms_changed",
          source: "landlord_recorded",
          actor,
          summary: `Grace period changed from ${t.gracePeriodDays} to ${input.gracePeriodDays} days`,
          entityType: "Tenancy",
          entityId: t._id.toString(),
          before: { gracePeriodDays: t.gracePeriodDays },
          after: { gracePeriodDays: input.gracePeriodDays },
        },
        session,
      );
    }
  });
}

export const endTenancySchema = z.object({
  endDate: isoDate,
  kind: z.enum(["ended", "terminated"]),
  reason: z.string().trim().min(3, "Please give a reason").max(1000),
});

/**
 * End a tenancy (natural end or early termination). Future charges that have no payments are
 * cancelled (with a timeline entry); anything already paid or part-paid is left untouched.
 */
export async function endTenancy(actor: Actor, tenancyId: string, input: z.infer<typeof endTenancySchema>) {
  const t = await getLandlordTenancy(actor, tenancyId);
  if (t.status !== "active") throw errors.conflict("This tenancy is not active");
  const endDate = parseISODate(input.endDate);
  if (endDate < t.startDate) throw errors.validation("End date can't be before the tenancy started", { endDate: ["Before start"] });
  await withTransaction(async (session) => {
    const res = await Tenancy.updateOne(
      { _id: t._id, status: "active" },
      { $set: { status: input.kind, endDate, endedAt: new Date(), endReason: input.reason, nextDueDate: null } },
      { session: session ?? undefined },
    );
    if (res.modifiedCount !== 1) throw errors.conflict("This tenancy was already ended");
    const cancellable = await RentCharge.find({ tenancyId: t._id, periodStart: { $gt: endDate }, allocatedKobo: 0, status: "open" }).session(session).lean();
    if (cancellable.length) {
      await RentCharge.updateMany({ _id: { $in: cancellable.map((c) => c._id) }, allocatedKobo: 0 }, { $set: { status: "cancelled" } }, { session: session ?? undefined });
    }
    await Unit.updateOne({ _id: t.unitId, currentTenancyId: t._id }, { $set: { currentTenancyId: null, occupancy: "vacant" } }, { session: session ?? undefined });
    await Invitation.updateMany({ tenancyId: t._id, status: "pending" }, { $set: { status: "revoked", revokedAt: new Date() } }, { session: session ?? undefined });
    await recordTimeline(
      {
        tenancyId: t._id.toString(),
        landlordId: actor.userId,
        type: "tenancy_ended",
        source: "landlord_recorded",
        actor,
        summary: `Tenancy ${input.kind === "terminated" ? "terminated early" : "ended"} on ${input.endDate}: ${input.reason}${cancellable.length ? ` (${cancellable.length} unpaid future charge(s) cancelled)` : ""}`,
        entityType: "Tenancy",
        entityId: t._id.toString(),
        before: { status: "active", endDate: toISODate(t.endDate) },
        after: { status: input.kind, endDate: input.endDate },
      },
      session,
    );
    await audit(actor, "tenancy.ended", "Tenancy", t._id.toString(), { kind: input.kind, cancelledCharges: cancellable.length }, session);
    if (t.tenantId) {
      await notify(
        {
          userId: t.tenantId.toString(),
          type: "tenancy_update",
          title: "Your tenancy record was updated",
          body: `Your landlord recorded that the tenancy ${input.kind === "terminated" ? "was terminated" : "ended"} on ${input.endDate}. Your records remain available to you.`,
          link: `/tenant/tenancy`,
          dedupeKey: `tenancy_ended:${t._id}`,
        },
        session,
      );
    }
  });
}

export const renewTenancySchema = z
  .object({
    endDate: isoDate,
    rentAmountKobo: koboAmount,
    frequency: z.enum(FREQUENCIES),
    gracePeriodDays: z.number().int().min(0).max(90),
    agreedCharges: z.array(agreedChargeInput).max(10).default([]),
  });

/** Renewal creates a new linked tenancy starting the day after the current one ends. History stays separate and intact. */
export async function renewTenancy(actor: Actor, tenancyId: string, input: z.infer<typeof renewTenancySchema>) {
  const t = await getLandlordTenancy(actor, tenancyId);
  if (t.status !== "active") throw errors.conflict("Only active tenancies can be renewed");
  if (t.renewedToId) throw errors.conflict("This tenancy has already been renewed");
  const start = addDays(t.endDate, 1);
  const end = parseISODate(input.endDate);
  if (end <= start) throw errors.validation("The renewal must end after it starts", { endDate: [`Must be after ${toISODate(start)}`] });
  return withTransaction(async (session) => {
    await assertNoOverlap(t.unitId.toString(), start, end, t._id.toString(), session);
    const newId = new ObjectId();
    const linked = await Tenancy.updateOne({ _id: t._id, renewedToId: null, status: "active" }, { $set: { renewedToId: newId } }, { session: session ?? undefined });
    if (linked.modifiedCount !== 1) throw errors.conflict("This tenancy has already been renewed");
    const now = new Date();
    await Tenancy.create(
      [
        {
          _id: newId,
          landlordId: t.landlordId,
          propertyId: t.propertyId,
          unitId: t.unitId,
          tenantId: t.tenantId ?? null,
          tenantName: t.tenantName,
          tenantEmail: t.tenantEmail,
          startDate: start,
          endDate: end,
          frequency: input.frequency,
          rentSchedule: [{ effectiveFrom: start, amountKobo: input.rentAmountKobo, recordedBy: actor.userId, recordedAt: now }],
          agreedCharges: input.agreedCharges,
          gracePeriodDays: input.gracePeriodDays,
          depositAmountKobo: 0,
          renewedFromId: t._id,
          createdBy: actor.userId,
        },
      ],
      { session: session ?? undefined },
    );
    // Hand the unit claim to the renewal so the old tenancy ending doesn't mark the unit vacant.
    await Unit.updateOne({ _id: t.unitId, currentTenancyId: t._id }, { $set: { currentTenancyId: newId, occupancy: "occupied" } }, { session: session ?? undefined });
    if (t.tenantId) {
      await Conversation.updateOne(
        { tenancyId: newId, tenantId: t.tenantId },
        { $setOnInsert: { tenancyId: newId, landlordId: t.landlordId, tenantId: t.tenantId, participantIds: [t.landlordId, t.tenantId], readState: [] } },
        { upsert: true, session: session ?? undefined },
      );
    }
    const summary = `Renewal recorded: ${toISODate(start)} to ${input.endDate} at ${formatKobo(input.rentAmountKobo)} ${label(input.frequency).toLowerCase()}`;
    for (const id of [t._id.toString(), newId.toString()]) {
      await recordTimeline(
        { tenancyId: id, landlordId: actor.userId, type: "tenancy_renewed", source: "landlord_recorded", actor, summary, entityType: "Tenancy", entityId: newId.toString(), metadata: { previousTenancyId: t._id.toString(), renewalTenancyId: newId.toString() } },
        session,
      );
    }
    await audit(actor, "tenancy.renewed", "Tenancy", t._id.toString(), { renewalTenancyId: newId.toString() }, session);
    await generateCharges(newId.toString(), addDays(todayInBusinessTz(), CHARGE_LOOKAHEAD_DAYS), session);
    if (t.tenantId) {
      await notify(
        {
          userId: t.tenantId.toString(),
          type: "tenancy_renewal",
          title: "Tenancy renewal recorded",
          body: `${summary}. Please review the terms and contact your landlord if anything doesn't match what you agreed.`,
          link: `/tenant/tenancy`,
          dedupeKey: `renewal:${newId}`,
        },
        session,
      );
    }
    return { tenancyId: newId.toString() };
  });
}

/** Mark tenancies past their end date as ended and release units (daily job). */
export async function closeExpiredTenancies(today = todayInBusinessTz()) {
  await connectDb();
  const expired = await Tenancy.find({ status: "active", endDate: { $lt: today } }).select("_id unitId landlordId endDate").limit(500).lean();
  for (const t of expired) {
    await withTransaction(async (session) => {
      const res = await Tenancy.updateOne({ _id: t._id, status: "active" }, { $set: { status: "ended", endedAt: new Date(), nextDueDate: null } }, { session: session ?? undefined });
      if (res.modifiedCount !== 1) return;
      await Unit.updateOne({ _id: t.unitId, currentTenancyId: t._id }, { $set: { currentTenancyId: null, occupancy: "vacant" } }, { session: session ?? undefined });
      await recordTimeline(
        {
          tenancyId: t._id.toString(),
          landlordId: t.landlordId.toString(),
          type: "tenancy_ended",
          source: "system",
          actor: { userId: null, role: "system" },
          summary: `Tenancy reached its recorded end date (${toISODate(t.endDate)})`,
          entityType: "Tenancy",
          entityId: t._id.toString(),
          dedupeKey: `tenancy_expired:${t._id}`,
        },
        session,
      );
    });
  }
  return expired.length;
}

/* ---------------- Queries ---------------- */

export async function listTenancies(actor: Actor, opts: { status?: string; propertyId?: string; page: number; pageSize: number }) {
  await connectDb();
  const filter: Record<string, unknown> =
    actor.role === "landlord" ? { landlordId: actor.userId } : actor.role === "tenant" ? { tenantId: actor.userId } : { _id: null };
  if (opts.status) filter.status = opts.status;
  if (opts.propertyId) filter.propertyId = assertId(opts.propertyId);
  const [items, total] = await Promise.all([
    Tenancy.find(filter)
      .sort({ status: 1, startDate: -1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .populate<{ propertyId: { _id: mongoose.Types.ObjectId; name: string } }>("propertyId", "name")
      .populate<{ unitId: { _id: mongoose.Types.ObjectId; unitNumber: string } }>("unitId", "unitNumber")
      .lean(),
    Tenancy.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getTenancyDetail(actor: Actor, tenancyId: string) {
  const t = await getTenancyForActor(actor, tenancyId);
  const [property, unit, landlord, tenant, invitation] = await Promise.all([
    Property.findById(t.propertyId).select("name address propertyType").lean(),
    Unit.findById(t.unitId).select("unitNumber unitType").lean(),
    User.findById(t.landlordId).select("name email phone").lean(),
    t.tenantId ? User.findById(t.tenantId).select("name email phone").lean() : null,
    actor.role === "landlord" ? Invitation.findOne({ tenancyId: t._id }).sort({ createdAt: -1 }).select("status expiresAt lastSentAt").lean() : null,
  ]);
  return { tenancy: t, property, unit, landlord, tenant, invitation };
}

export async function refreshAllActiveTenancies(through: Date) {
  await connectDb();
  const ids = await Tenancy.find({ status: "active" }).distinct("_id");
  let created = 0;
  for (const id of ids) {
    created += await withTransaction((session) => generateCharges(id.toString(), through, session));
  }
  return { tenancies: ids.length, created };
}

export { refreshNextDueDate };
export type { ITenancy };

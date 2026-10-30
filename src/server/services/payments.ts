import "server-only";
import { randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import { parseISODate, todayInBusinessTz, toISODate, addDays } from "@/lib/dates";
import { env } from "@/lib/env";
import { errors, isDuplicateKeyError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { formatKobo } from "@/lib/money";
import { isoDate, koboAmount, normalizeReference, objectId, shortText } from "@/lib/validation";
import { connectDb, withTransaction } from "@/server/db";
import {
  Asset,
  Counter,
  Payment,
  PaymentAllocation,
  Receipt,
  RentCharge,
  Tenancy,
  TimelineEvent,
  User,
  WebhookEvent,
  type IPayment,
  type IPaymentStatusEntry,
  type PaymentStatus,
} from "@/server/models";
import { paymentProvider, type PaymentProvider } from "@/server/providers/payments";
import type { Actor } from "@/server/auth/actor";
import { assertId, getLandlordTenancy, getTenancyForActor, tenancyScope } from "./access";
import { audit, recordTimeline } from "./audit";
import { allocatePayment, reverseAllocations } from "./ledger";
import { notify } from "./notifications";

const { ObjectId } = mongoose.Types;
type S = ClientSession | null;
const opt = (s: S) => ({ session: s ?? undefined });
const sys = { userId: null, role: "system" as const };

function historyEntry(status: PaymentStatus, source: IPaymentStatusEntry["source"], actorId?: string | null, note?: string | null) {
  return { status, at: new Date(), actorId: actorId ?? null, source, note: note ?? null };
}

/* ---------------- Receipts ---------------- */

async function nextReceiptNumber(session: S): Promise<string> {
  const year = new Date().getUTCFullYear();
  const c = await Counter.findOneAndUpdate({ _id: `receipt:${year}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after", ...opt(session) }).lean();
  return `HB-${year}-${String(c!.seq).padStart(6, "0")}`;
}

/** Issue the single receipt for a confirmed payment. Idempotent (unique paymentId). */
export async function issueReceipt(paymentId: string, session: S) {
  const payment = await Payment.findById(paymentId).session(session).lean();
  if (!payment || payment.status !== "confirmed") return null;
  const existing = await Receipt.findOne({ paymentId: payment._id }).session(session).lean();
  if (existing) return existing;
  const allocations = await PaymentAllocation.find({ paymentId: payment._id, status: "active" }).populate<{ rentChargeId: { _id: mongoose.Types.ObjectId; label: string; periodStart: Date; periodEnd: Date } }>("rentChargeId", "label periodStart periodEnd").session(session).lean();
  try {
    const [receipt] = await Receipt.create(
      [
        {
          receiptNumber: await nextReceiptNumber(session),
          paymentId: payment._id,
          tenancyId: payment.tenancyId,
          landlordId: payment.landlordId,
          tenantId: payment.tenantId ?? null,
          propertyId: payment.propertyId,
          amountKobo: payment.amountKobo,
          purpose: payment.purpose,
          method: payment.method,
          paidOn: payment.paidOn,
          issuedAt: new Date(),
          confirmedBy: payment.source === "provider" ? "provider" : "landlord",
          confirmedByUserId: payment.verifiedBy ?? null,
          lines: allocations.map((a) => ({
            rentChargeId: a.rentChargeId._id,
            label: a.rentChargeId.label,
            periodStart: a.rentChargeId.periodStart,
            periodEnd: a.rentChargeId.periodEnd,
            amountKobo: a.amountKobo,
          })),
          creditKobo: payment.unallocatedKobo,
        },
      ],
      opt(session),
    );
    await Payment.updateOne({ _id: payment._id }, { $set: { receiptId: receipt!._id } }, opt(session));
    await recordTimeline(
      {
        tenancyId: payment.tenancyId.toString(),
        landlordId: payment.landlordId.toString(),
        type: "receipt_issued",
        source: "system",
        actor: sys,
        summary: `Receipt ${receipt!.receiptNumber} issued for ${formatKobo(payment.amountKobo)}`,
        entityType: "Receipt",
        entityId: receipt!._id.toString(),
        metadata: { receiptNumber: receipt!.receiptNumber, amountKobo: payment.amountKobo },
        dedupeKey: `receipt_issued:${payment._id}`,
      },
      session,
    );
    if (payment.tenantId) {
      await notify(
        {
          userId: payment.tenantId.toString(),
          type: "receipt_issued",
          title: `Receipt ${receipt!.receiptNumber}`,
          body: `Your receipt for ${formatKobo(payment.amountKobo)} is ready to view and download.`,
          link: `/tenant/receipts/${receipt!._id}`,
          dedupeKey: `receipt:${payment._id}`,
        },
        session,
      );
    }
    return receipt!;
  } catch (e) {
    if (isDuplicateKeyError(e)) return Receipt.findOne({ paymentId: payment._id }).session(session).lean();
    throw e;
  }
}

/* ---------------- Confirmation core ---------------- */

interface ConfirmOptions {
  from: PaymentStatus[];
  by: { actor: Actor | null; source: IPaymentStatusEntry["source"] };
  note?: string | null;
  providerData?: IPayment["providerData"];
}

/**
 * Move a payment to `confirmed` exactly once, allocate it, and issue its receipt.
 * The status transition is an atomic compare-and-set; a second caller (duplicate webhook, double click,
 * concurrent landlord tab) finds the payment already confirmed and gets the existing result back.
 */
export async function confirmPayment(paymentId: string, o: ConfirmOptions, session: S) {
  const set: Record<string, unknown> = { status: "confirmed", verifiedAt: new Date(), verifiedBy: o.by.actor?.userId ?? null };
  if (o.providerData) set.providerData = o.providerData;
  let updated: IPayment | null;
  try {
    updated = await Payment.findOneAndUpdate(
      { _id: paymentId, status: { $in: o.from } },
      { $set: set, $push: { statusHistory: historyEntry("confirmed", o.by.source, o.by.actor?.userId, o.note) } },
      { returnDocument: "after", ...opt(session) },
    ).lean();
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      throw errors.conflict("Another confirmed payment already uses this transfer reference. Check for a duplicate submission.");
    }
    throw e;
  }
  if (!updated) {
    const current = await Payment.findById(paymentId).session(session).lean();
    if (current?.status === "confirmed") return { payment: current, alreadyConfirmed: true };
    throw errors.conflict(`This payment can't be confirmed from its current status (${current?.status ?? "unknown"}).`);
  }
  const { allocated, credit } = await allocatePayment(paymentId, session);
  const receipt = await issueReceipt(paymentId, session);
  const sourceLabel = o.by.source === "provider" ? "provider_confirmed" : "landlord_confirmed";
  await recordTimeline(
    {
      tenancyId: updated.tenancyId.toString(),
      landlordId: updated.landlordId.toString(),
      type: "payment_confirmed",
      source: sourceLabel,
      actor: o.by.actor ?? sys,
      summary: `${updated.purpose === "deposit" ? "Deposit" : "Payment"} of ${formatKobo(updated.amountKobo)} confirmed ${o.by.source === "provider" ? "by the payment provider" : "by the landlord"}${credit > 0 && updated.purpose === "rent" ? ` (${formatKobo(credit)} held as credit)` : ""}`,
      entityType: "Payment",
      entityId: updated._id.toString(),
      metadata: { amountKobo: updated.amountKobo, allocatedKobo: allocated, creditKobo: credit, method: updated.method, reference: updated.externalReference ?? updated.providerReference ?? null },
      before: { status: o.from.join("|") },
      after: { status: "confirmed" },
      dedupeKey: `payment_confirmed:${updated._id}`,
    },
    session,
  );
  if (updated.tenantId && updated.source !== "landlord_record") {
    await notify(
      {
        userId: updated.tenantId.toString(),
        type: "payment_confirmed",
        title: "Payment confirmed",
        body: `Your payment of ${formatKobo(updated.amountKobo)} has been confirmed${receipt ? ` and receipt ${receipt.receiptNumber} issued` : ""}.`,
        link: `/tenant/payments`,
        dedupeKey: `payment_confirmed:${updated._id}`,
      },
      session,
    );
  }
  return { payment: { ...updated, receiptId: receipt?._id ?? null }, alreadyConfirmed: false };
}

/* ---------------- External payment claims (tenant) ---------------- */

export const claimSchema = z.object({
  tenancyId: objectId,
  purpose: z.enum(["rent", "deposit"]).default("rent"),
  amountKobo: koboAmount,
  paidOn: isoDate,
  method: z.enum(["bank_transfer", "pos", "cash", "other"]),
  reference: z.string().trim().min(3, "Enter the transfer reference or session ID").max(100),
  bankName: shortText(80).optional(),
  proofAssetId: objectId.optional(),
  chargeIds: z.array(objectId).max(24).default([]),
  note: shortText(1000).optional(),
});

async function validateIntendedCharges(tenancyId: mongoose.Types.ObjectId, chargeIds: string[]) {
  if (chargeIds.length === 0) return [];
  const found = await RentCharge.countDocuments({ _id: { $in: chargeIds }, tenancyId });
  if (found !== new Set(chargeIds).size) throw errors.validation("Some selected charges don't belong to this tenancy");
  return chargeIds.map((id) => new ObjectId(id));
}

export async function submitPaymentClaim(actor: Actor, input: z.infer<typeof claimSchema>) {
  if (actor.role !== "tenant") throw errors.forbidden();
  const t = await getTenancyForActor(actor, input.tenancyId);
  if (t.status !== "active" && t.status !== "ended" && t.status !== "terminated") throw errors.conflict("This tenancy can't receive payments");
  const paidOn = parseISODate(input.paidOn);
  if (paidOn > addDays(todayInBusinessTz(), 1)) throw errors.validation("Payment date can't be in the future", { paidOn: ["Can't be in the future"] });
  const refNorm = normalizeReference(input.reference);
  if (refNorm.length < 3) throw errors.validation("Enter a valid reference", { reference: ["Enter a valid reference"] });
  const dup = await Payment.findOne({ landlordId: t.landlordId, externalReferenceNormalized: refNorm, status: { $in: ["pending_verification", "confirmed"] } }).select("_id status").lean();
  if (dup) {
    throw errors.conflict(dup.status === "confirmed" ? "A payment with this reference has already been confirmed." : "You've already submitted a payment with this reference. It's awaiting review.");
  }
  if (input.proofAssetId) {
    const asset = await Asset.findOne({ _id: input.proofAssetId, ownerId: actor.userId, kind: "payment_proof", status: "active" }).lean();
    if (!asset) throw errors.validation("The attached proof file wasn't found", { proofAssetId: ["Upload the file again"] });
  }
  const intended = await validateIntendedCharges(t._id, input.chargeIds);
  return withTransaction(async (session) => {
    const [payment] = await Payment.create(
      [
        {
          tenancyId: t._id,
          landlordId: t.landlordId,
          propertyId: t.propertyId,
          tenantId: actor.userId,
          purpose: input.purpose,
          method: input.method,
          source: "tenant_claim",
          status: "pending_verification",
          amountKobo: input.amountKobo,
          paidOn,
          intendedChargeIds: intended,
          externalReference: input.reference,
          externalReferenceNormalized: refNorm,
          bankName: input.bankName ?? null,
          proofAssetId: input.proofAssetId ?? null,
          note: input.note ?? null,
          submittedBy: actor.userId,
          submittedAt: new Date(),
          statusHistory: [historyEntry("pending_verification", "tenant", actor.userId)],
        },
      ],
      opt(session),
    );
    await recordTimeline(
      {
        tenancyId: t._id.toString(),
        landlordId: t.landlordId.toString(),
        type: "payment_submitted",
        source: "tenant_submitted",
        actor,
        summary: `Tenant reported a ${input.method.replace("_", " ")} of ${formatKobo(input.amountKobo)} on ${input.paidOn} (ref ${input.reference}) — awaiting landlord verification`,
        entityType: "Payment",
        entityId: payment!._id.toString(),
        metadata: { amountKobo: input.amountKobo, reference: input.reference, paidOn: input.paidOn, hasProof: Boolean(input.proofAssetId) },
      },
      session,
    );
    await notify(
      {
        userId: t.landlordId.toString(),
        type: "payment_claim_submitted",
        title: "Payment awaiting your review",
        body: `${t.tenantName} reported paying ${formatKobo(input.amountKobo)} on ${input.paidOn} (ref ${input.reference}). Check your bank records, then confirm or reject it.`,
        link: `/landlord/reconciliation?focus=${payment!._id}`,
        dedupeKey: `claim:${payment!._id}`,
      },
      session,
    );
    await audit(actor, "payment.claim_submitted", "Payment", payment!._id.toString(), { amountKobo: input.amountKobo }, session);
    return payment!;
  });
}

/* ---------------- Landlord-recorded payments (cash etc.) ---------------- */

export const recordPaymentSchema = z.object({
  tenancyId: objectId,
  purpose: z.enum(["rent", "deposit"]).default("rent"),
  amountKobo: koboAmount,
  paidOn: isoDate,
  method: z.enum(["cash", "bank_transfer", "pos", "cheque", "other"]),
  reference: shortText(100).optional(),
  chargeIds: z.array(objectId).max(24).default([]),
  note: shortText(1000).optional(),
});

export async function recordLandlordPayment(actor: Actor, input: z.infer<typeof recordPaymentSchema>) {
  const t = await getLandlordTenancy(actor, input.tenancyId);
  if (t.status === "cancelled") throw errors.conflict("This tenancy was cancelled");
  const paidOn = parseISODate(input.paidOn);
  if (paidOn > addDays(todayInBusinessTz(), 1)) throw errors.validation("Payment date can't be in the future", { paidOn: ["Can't be in the future"] });
  const refNorm = input.reference ? normalizeReference(input.reference) || null : null;
  const intended = await validateIntendedCharges(t._id, input.chargeIds);
  return withTransaction(async (session) => {
    const [payment] = await Payment.create(
      [
        {
          tenancyId: t._id,
          landlordId: t.landlordId,
          propertyId: t.propertyId,
          tenantId: t.tenantId ?? null,
          purpose: input.purpose,
          method: input.method,
          source: "landlord_record",
          status: "pending_verification",
          amountKobo: input.amountKobo,
          paidOn,
          intendedChargeIds: intended,
          externalReference: input.reference ?? null,
          externalReferenceNormalized: refNorm,
          note: input.note ?? null,
          submittedBy: actor.userId,
          submittedAt: new Date(),
          statusHistory: [historyEntry("pending_verification", "landlord", actor.userId, "Recorded by landlord")],
        },
      ],
      opt(session),
    );
    await recordTimeline(
      {
        tenancyId: t._id.toString(),
        landlordId: actor.userId,
        type: "payment_recorded",
        source: "landlord_recorded",
        actor,
        summary: `Landlord recorded a ${input.method.replace("_", " ")} ${input.purpose === "deposit" ? "deposit " : ""}payment of ${formatKobo(input.amountKobo)} received on ${input.paidOn}`,
        entityType: "Payment",
        entityId: payment!._id.toString(),
        metadata: { amountKobo: input.amountKobo, method: input.method, reference: input.reference ?? null },
      },
      session,
    );
    const result = await confirmPayment(payment!._id.toString(), { from: ["pending_verification"], by: { actor, source: "landlord" }, note: "Recorded and confirmed by landlord" }, session);
    await audit(actor, "payment.recorded", "Payment", payment!._id.toString(), { amountKobo: input.amountKobo, method: input.method }, session);
    if (t.tenantId) {
      await notify(
        {
          userId: t.tenantId.toString(),
          type: "payment_confirmed",
          title: "Payment recorded",
          body: `Your landlord recorded a ${input.method.replace("_", " ")} payment of ${formatKobo(input.amountKobo)} received on ${input.paidOn}. Contact them if this isn't correct.`,
          link: `/tenant/payments`,
          dedupeKey: `payment_recorded:${payment!._id}`,
        },
        session,
      );
    }
    return result.payment;
  });
}

/* ---------------- Landlord review ---------------- */

async function getLandlordPayment(actor: Actor, paymentId: string, session: S = null) {
  if (actor.role !== "landlord") throw errors.notFound();
  const p = await Payment.findOne({ _id: assertId(paymentId), landlordId: actor.userId }).session(session).lean();
  if (!p) throw errors.notFound("Payment not found");
  return p;
}

export async function approvePaymentClaim(actor: Actor, paymentId: string, note?: string | null) {
  await connectDb();
  const p = await getLandlordPayment(actor, paymentId);
  if (p.source !== "tenant_claim") throw errors.conflict("Only tenant-submitted payments need review");
  return withTransaction(async (session) => {
    const res = await confirmPayment(p._id.toString(), { from: ["pending_verification"], by: { actor, source: "landlord" }, note: note ?? "Verified by landlord" }, session);
    if (!res.alreadyConfirmed) await audit(actor, "payment.claim_approved", "Payment", p._id.toString(), { amountKobo: p.amountKobo }, session);
    return res;
  });
}

export const rejectSchema = z.object({ reason: z.string().trim().min(5, "Explain why so the tenant can follow up").max(1000) });

export async function rejectPaymentClaim(actor: Actor, paymentId: string, reason: string) {
  await connectDb();
  const p = await getLandlordPayment(actor, paymentId);
  return withTransaction(async (session) => {
    const updated = await Payment.findOneAndUpdate(
      { _id: p._id, status: "pending_verification", source: "tenant_claim" },
      { $set: { status: "rejected", rejectionReason: reason, verifiedBy: actor.userId, verifiedAt: new Date() }, $push: { statusHistory: historyEntry("rejected", "landlord", actor.userId, reason) } },
      { returnDocument: "after", ...opt(session) },
    ).lean();
    if (!updated) throw errors.conflict("This payment is no longer awaiting review");
    await recordTimeline(
      {
        tenancyId: p.tenancyId.toString(),
        landlordId: actor.userId,
        type: "payment_rejected",
        source: "landlord_confirmed",
        actor,
        summary: `Reported payment of ${formatKobo(p.amountKobo)} (ref ${p.externalReference}) was not confirmed by the landlord: ${reason}`,
        entityType: "Payment",
        entityId: p._id.toString(),
        before: { status: "pending_verification" },
        after: { status: "rejected" },
        metadata: { reason },
      },
      session,
    );
    if (p.tenantId) {
      await notify(
        {
          userId: p.tenantId.toString(),
          type: "payment_rejected",
          title: "Reported payment not confirmed",
          body: `Your landlord could not confirm your payment of ${formatKobo(p.amountKobo)} (ref ${p.externalReference}). Reason: ${reason}. You can message them or submit corrected details.`,
          link: `/tenant/payments`,
          dedupeKey: `payment_rejected:${p._id}`,
        },
        session,
      );
    }
    await audit(actor, "payment.claim_rejected", "Payment", p._id.toString(), { reason }, session);
    return updated;
  });
}

/**
 * Reverse a confirmed payment (e.g. bounced transfer, recorded in error). The payment, its allocations
 * and its receipt are kept and marked reversed/voided; a correction event links to the original confirmation.
 */
export async function reversePayment(actor: Actor | null, paymentId: string, reason: string, kind: "reversed" | "refunded" = "reversed", session0: S = null) {
  await connectDb();
  const run = async (session: S) => {
    const p = actor ? await getLandlordPayment(actor, paymentId, session) : await Payment.findById(paymentId).session(session).lean();
    if (!p) throw errors.notFound();
    if (p.status === kind) return p; // idempotent
    if (actor && p.source === "provider") throw errors.conflict("Online payments are reversed or refunded through the payment provider");
    const updated = await Payment.findOneAndUpdate(
      { _id: p._id, status: "confirmed" },
      { $set: { status: kind, reversalReason: reason }, $push: { statusHistory: historyEntry(kind, actor ? "landlord" : "provider", actor?.userId, reason) } },
      { returnDocument: "after", ...opt(session) },
    ).lean();
    if (!updated) throw errors.conflict("Only confirmed payments can be reversed");
    await reverseAllocations(p._id.toString(), reason, session);
    await Receipt.updateOne({ paymentId: p._id, status: "valid" }, { $set: { status: "voided", voidedAt: new Date(), voidReason: reason } }, opt(session));
    const original = await TimelineEvent.findOne({ entityId: p._id, type: "payment_confirmed" }).select("_id").session(session).lean();
    await recordTimeline(
      {
        tenancyId: p.tenancyId.toString(),
        landlordId: p.landlordId.toString(),
        type: kind === "refunded" ? "payment_refunded" : "payment_reversed",
        source: actor ? "landlord_recorded" : "provider_confirmed",
        actor: actor ?? sys,
        summary: `Payment of ${formatKobo(p.amountKobo)} ${kind}: ${reason}. Its receipt was voided and the amount is outstanding again where applicable.`,
        entityType: "Payment",
        entityId: p._id.toString(),
        before: { status: "confirmed" },
        after: { status: kind },
        correctsEventId: original?._id.toString() ?? null,
        dedupeKey: `payment_${kind}:${p._id}`,
      },
      session,
    );
    if (p.tenantId) {
      await notify(
        {
          userId: p.tenantId.toString(),
          type: "payment_reversed",
          title: `Payment ${kind}`,
          body: `A payment of ${formatKobo(p.amountKobo)} was marked ${kind}. Reason: ${reason}. Your balance has been updated.`,
          link: `/tenant/payments`,
          dedupeKey: `payment_${kind}:${p._id}`,
        },
        session,
      );
    }
    await audit(actor ?? sys, `payment.${kind}`, "Payment", p._id.toString(), { reason }, session);
    return updated;
  };
  return session0 ? run(session0) : withTransaction(run);
}

/* ---------------- Online payments ---------------- */

export const initiateSchema = z.object({
  tenancyId: objectId,
  chargeIds: z.array(objectId).min(1, "Choose what you're paying for").max(24),
  amountKobo: koboAmount.optional(),
});

/** Create a server-side payment bound to the tenant, tenancy, charges, amount and currency, then open checkout. */
export async function initiateOnlinePayment(actor: Actor, input: z.infer<typeof initiateSchema>) {
  if (actor.role !== "tenant") throw errors.forbidden();
  const provider = paymentProvider();
  const t = await getTenancyForActor(actor, input.tenancyId);
  if (t.status !== "active") throw errors.conflict("Online payment is only available for active tenancies");
  const charges = await RentCharge.find({ _id: { $in: input.chargeIds }, tenancyId: t._id, status: { $in: ["open", "partially_paid"] } }).lean();
  if (charges.length !== new Set(input.chargeIds).size) throw errors.validation("Some selected charges are already paid or don't belong to this tenancy");
  const due = charges.reduce((s, c) => s + (c.amountKobo - c.allocatedKobo), 0);
  const amount = input.amountKobo ?? due;
  if (amount <= 0 || amount > due) throw errors.validation(`Amount must be between ₦0.01 and ${formatKobo(due)}`, { amountKobo: ["Invalid amount"] });
  const user = await User.findById(actor.userId).select("email").lean();
  const reference = `HB_${new ObjectId().toString()}_${randomBytes(4).toString("hex")}`;
  const payment = await Payment.create({
    tenancyId: t._id,
    landlordId: t.landlordId,
    propertyId: t.propertyId,
    tenantId: actor.userId,
    purpose: "rent",
    method: "online",
    source: "provider",
    status: "initiated",
    amountKobo: amount,
    paidOn: todayInBusinessTz(),
    intendedChargeIds: charges.map((c) => c._id),
    provider: provider.name,
    providerReference: reference,
    submittedBy: actor.userId,
    submittedAt: new Date(),
    statusHistory: [historyEntry("initiated", "tenant", actor.userId)],
  });
  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await provider.initialize({
      reference,
      amountKobo: amount,
      email: user!.email,
      callbackUrl: `${env().APP_URL}/tenant/payments/callback`,
      metadata: { paymentId: payment._id.toString(), tenancyId: t._id.toString() },
    }));
  } catch (e) {
    await Payment.updateOne({ _id: payment._id, status: "initiated" }, { $set: { status: "failed" }, $push: { statusHistory: historyEntry("failed", "system", null, "Could not start checkout") } });
    throw e;
  }
  await Payment.updateOne({ _id: payment._id }, { $set: { "providerData.authorizationUrl": authorizationUrl } });
  await recordTimeline({
    tenancyId: t._id.toString(),
    landlordId: t.landlordId.toString(),
    type: "payment_initiated",
    source: "tenant_submitted",
    actor,
    summary: `Online payment of ${formatKobo(amount)} started (awaiting provider confirmation)`,
    entityType: "Payment",
    entityId: payment._id.toString(),
    visibility: "shared",
    metadata: { amountKobo: amount, reference },
  });
  return { paymentId: payment._id.toString(), reference, authorizationUrl };
}

/**
 * Verify a transaction with the provider and apply the result. This is the ONLY path that confirms
 * an online payment; redirects and client-reported statuses are never trusted.
 */
export async function verifyAndApplyProviderPayment(reference: string, provider: PaymentProvider = paymentProvider()) {
  await connectDb();
  const payment = await Payment.findOne({ providerReference: reference, provider: provider.name }).lean();
  if (!payment) {
    logger.warn("provider_payment_unknown_reference", { reference });
    return { status: "unknown_reference" as const };
  }
  const tx = await provider.verify(reference);
  if (tx.reference !== reference) throw errors.provider("Provider returned a different reference");

  const flags: string[] = [];
  if (tx.currency !== "NGN") flags.push("currency_mismatch");
  if (tx.amountKobo !== payment.amountKobo) flags.push("amount_mismatch");
  const providerData = {
    channel: tx.channel,
    paidAt: tx.paidAt,
    gatewayResponse: tx.gatewayResponse,
    authorizationUrl: payment.providerData?.authorizationUrl ?? null,
  };

  if (tx.status === "success") {
    if (flags.length) {
      // Do not credit the ledger. Surface for manual reconciliation.
      await Payment.updateOne(
        { _id: payment._id },
        {
          $addToSet: { flags: { $each: flags } },
          $set: { status: payment.status === "initiated" ? "pending" : payment.status, providerData },
          $push: { statusHistory: historyEntry("pending", "provider", null, `Provider reported success but ${flags.join(", ")} (expected ${formatKobo(payment.amountKobo)} NGN, got ${tx.amountKobo} ${tx.currency}). Not credited.`) },
        },
      );
      await audit(sys, "payment.provider_mismatch", "Payment", payment._id.toString(), { flags, expected: payment.amountKobo, received: tx.amountKobo, currency: tx.currency });
      logger.warn("provider_payment_mismatch", { paymentId: payment._id.toString(), flags });
      return { status: "mismatch" as const, flags };
    }
    const res = await withTransaction((session) =>
      confirmPayment(payment._id.toString(), { from: ["initiated", "pending", "failed", "abandoned"], by: { actor: null, source: "provider" }, providerData, note: tx.gatewayResponse }, session),
    );
    return { status: "confirmed" as const, alreadyConfirmed: res.alreadyConfirmed };
  }

  if (tx.status === "failed" || tx.status === "abandoned") {
    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $in: ["initiated", "pending"] } },
      { $set: { status: tx.status, providerData }, $push: { statusHistory: historyEntry(tx.status, "provider", null, tx.gatewayResponse) } },
      { returnDocument: "after" },
    ).lean();
    if (updated) {
      await recordTimeline({
        tenancyId: payment.tenancyId.toString(),
        landlordId: payment.landlordId.toString(),
        type: "payment_failed",
        source: "provider_confirmed",
        actor: sys,
        summary: `Online payment of ${formatKobo(payment.amountKobo)} ${tx.status === "failed" ? "failed" : "was not completed"}`,
        entityType: "Payment",
        entityId: payment._id.toString(),
        dedupeKey: `payment_${tx.status}:${payment._id}`,
      });
    }
    return { status: tx.status };
  }

  if (tx.status === "reversed") {
    if (payment.status === "confirmed") await reversePayment(null, payment._id.toString(), "Reversed by payment provider");
    return { status: "reversed" as const };
  }

  if (payment.status === "initiated") {
    await Payment.updateOne({ _id: payment._id, status: "initiated" }, { $set: { status: "pending", providerData }, $push: { statusHistory: historyEntry("pending", "provider", null, tx.gatewayResponse) } });
  }
  return { status: "pending" as const };
}

/**
 * Process a provider webhook delivery: verify signature, de-duplicate, then re-verify the transaction
 * with the provider API before touching the ledger. Safe under duplicate and out-of-order delivery.
 */
export async function processWebhook(provider: PaymentProvider, rawBody: string, signature: string | null) {
  await connectDb();
  if (!provider.verifySignature(rawBody, signature)) {
    logger.warn("webhook_invalid_signature", { provider: provider.name });
    return { httpStatus: 401, result: "invalid_signature" as const };
  }
  let parsed;
  try {
    parsed = provider.parseWebhook(rawBody);
  } catch {
    return { httpStatus: 400, result: "malformed" as const };
  }
  let event;
  try {
    event = await WebhookEvent.create({
      provider: provider.name,
      eventKey: parsed.eventKey,
      eventType: parsed.eventType,
      reference: parsed.reference,
      status: "received",
      receivedAt: new Date(),
      summary: { eventType: parsed.eventType, reference: parsed.reference },
    });
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const existing = await WebhookEvent.findOne({ provider: provider.name, eventKey: parsed.eventKey }).lean();
    if (existing && existing.status !== "failed") return { httpStatus: 200, result: "duplicate" as const };
    event = existing!;
  }
  // Claim the event for processing (prevents two concurrent retries processing it at once).
  const claimed = await WebhookEvent.findOneAndUpdate(
    { _id: event._id, status: { $in: ["received", "failed"] } },
    { $set: { status: "received" }, $inc: { attempts: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) return { httpStatus: 200, result: "duplicate" as const };
  try {
    let outcome = "ignored";
    if ((parsed.kind === "charge_success" || parsed.kind === "charge_failed") && parsed.reference) {
      const r = await verifyAndApplyProviderPayment(parsed.reference, provider);
      outcome = r.status;
    } else if (parsed.kind === "refund_processed" && parsed.reference) {
      const p = await Payment.findOne({ providerReference: parsed.reference, provider: provider.name }).lean();
      if (p && p.status === "confirmed") {
        await reversePayment(null, p._id.toString(), "Refunded through the payment provider", "refunded");
        outcome = "refunded";
      }
    }
    await WebhookEvent.updateOne(
      { _id: event._id },
      { $set: { status: outcome === "ignored" || outcome === "unknown_reference" ? "ignored" : "processed", processedAt: new Date(), lastError: null, summary: { eventType: parsed.eventType, reference: parsed.reference, outcome } } },
    );
    return { httpStatus: 200, result: outcome };
  } catch (e) {
    await WebhookEvent.updateOne({ _id: event._id }, { $set: { status: "failed", lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
    logger.error("webhook_processing_failed", { error: e, eventType: parsed.eventType });
    // Non-2xx makes the provider retry; our idempotency makes the retry safe.
    return { httpStatus: 500, result: "error" as const };
  }
}

/** Re-verify online payments whose outcome is unclear (job + manual "check status"). */
export async function reconcilePendingOnlinePayments(now = new Date()) {
  await connectDb();
  const stale = await Payment.find({
    source: "provider",
    status: { $in: ["initiated", "pending"] },
    createdAt: { $lte: new Date(now.getTime() - 10 * 60_000), $gte: new Date(now.getTime() - 7 * 86400_000) },
  })
    .select("providerReference")
    .limit(100)
    .lean();
  const results: Record<string, number> = {};
  for (const p of stale) {
    if (!p.providerReference) continue;
    try {
      const r = await verifyAndApplyProviderPayment(p.providerReference);
      results[r.status] = (results[r.status] ?? 0) + 1;
    } catch (e) {
      results.error = (results.error ?? 0) + 1;
      logger.warn("reconcile_verify_failed", { paymentId: p._id.toString(), error: e });
    }
  }
  // Give up on checkouts nobody completed within 7 days.
  await Payment.updateMany(
    { source: "provider", status: "initiated", createdAt: { $lt: new Date(now.getTime() - 7 * 86400_000) } },
    { $set: { status: "abandoned" }, $push: { statusHistory: historyEntry("abandoned", "system", null, "Checkout not completed") } },
  );
  return { checked: stale.length, results };
}

export async function checkPaymentStatus(actor: Actor, paymentId: string) {
  await connectDb();
  const scope = await tenancyScope(actor);
  const p = await Payment.findOne({ _id: assertId(paymentId), ...scope }).lean();
  if (!p) throw errors.notFound();
  if (p.source === "provider" && p.providerReference && ["initiated", "pending", "abandoned", "failed"].includes(p.status)) {
    await verifyAndApplyProviderPayment(p.providerReference);
  }
  return Payment.findById(p._id).select("status amountKobo receiptId flags").lean();
}

/* ---------------- Queries ---------------- */

export const paymentFilterSchema = z.object({
  status: z.enum(["initiated", "pending", "pending_verification", "confirmed", "rejected", "failed", "abandoned", "reversed", "refunded"]).optional(),
  tenancyId: objectId.optional(),
  propertyId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listPayments(actor: Actor, f: z.infer<typeof paymentFilterSchema>) {
  const scope = await tenancyScope(actor);
  const filter: Record<string, unknown> = { ...scope };
  if (f.status) filter.status = f.status;
  if (f.tenancyId) filter.tenancyId = f.tenancyId;
  if (f.propertyId) filter.propertyId = f.propertyId;
  if (f.from || f.to) {
    filter.paidOn = { ...(f.from ? { $gte: parseISODate(f.from) } : {}), ...(f.to ? { $lte: parseISODate(f.to) } : {}) };
  }
  if (actor.role === "tenant") {
    // Tenants can't narrow the scope to other tenancies: tenancyId filter is intersected with scope.
    if (f.tenancyId) filter.tenancyId = { $in: ((scope.tenancyId as { $in: mongoose.Types.ObjectId[] }).$in).filter((id) => id.toString() === f.tenancyId) };
  }
  const [items, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip((f.page - 1) * f.pageSize)
      .limit(f.pageSize)
      .populate<{ tenancyId: { _id: mongoose.Types.ObjectId; tenantName: string } }>("tenancyId", "tenantName")
      .populate<{ verifiedBy: { _id: mongoose.Types.ObjectId; name: string } | null }>("verifiedBy", "name")
      .populate<{ receiptId: { _id: mongoose.Types.ObjectId; receiptNumber: string; status: string } | null }>("receiptId", "receiptNumber status")
      .lean(),
    Payment.countDocuments(filter),
  ]);
  return { items, total };
}

/** Landlord payment-review workspace: claims, warnings and unclear transactions in one place. */
export async function reconciliationWorkspace(actor: Actor) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const landlordId = new ObjectId(actor.userId);
  const today = todayInBusinessTz();
  const [pending, awaitingProvider, problem, recentConfirmed, outstandingCharges, dupGroups] = await Promise.all([
    Payment.find({ landlordId, status: "pending_verification" })
      .sort({ submittedAt: 1 })
      .populate<{ tenancyId: { _id: mongoose.Types.ObjectId; tenantName: string; unitId: mongoose.Types.ObjectId } }>("tenancyId", "tenantName unitId")
      .populate<{ proofAssetId: { _id: mongoose.Types.ObjectId; displayName: string; mimeType: string } | null }>("proofAssetId", "displayName mimeType")
      .lean(),
    Payment.find({ landlordId, source: "provider", status: { $in: ["initiated", "pending"] } }).sort({ createdAt: -1 }).limit(50).populate<{ tenancyId: { tenantName: string } }>("tenancyId", "tenantName").lean(),
    Payment.find({ landlordId, $or: [{ status: { $in: ["failed", "reversed", "refunded"] }, updatedAt: { $gte: addDays(today, -60) } }, { "flags.0": { $exists: true } }] })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate<{ tenancyId: { tenantName: string } }>("tenancyId", "tenantName")
      .lean(),
    Payment.find({ landlordId, status: "confirmed" }).sort({ verifiedAt: -1 }).limit(20).populate<{ tenancyId: { tenantName: string } }>("tenancyId", "tenantName").populate<{ receiptId: { receiptNumber: string } | null }>("receiptId", "receiptNumber").lean(),
    RentCharge.find({ landlordId, status: { $in: ["open", "partially_paid"] }, dueDate: { $lte: today } })
      .sort({ dueDate: 1 })
      .limit(100)
      .populate<{ tenancyId: { tenantName: string; status: string } }>("tenancyId", "tenantName status")
      .lean(),
    Payment.aggregate<{ _id: string; count: number }>([
      { $match: { landlordId, externalReferenceNormalized: { $type: "string" }, status: { $in: ["pending_verification", "confirmed", "rejected"] } } },
      { $group: { _id: "$externalReferenceNormalized", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]),
  ]);
  const dupRefs = new Set(dupGroups.map((d) => d._id));

  // Build per-claim review hints. These are prompts to check, not conclusions.
  const tenancyIds = [...new Set(pending.map((p) => p.tenancyId._id.toString()))];
  // Owed now (due on or before today) vs billed in advance (generated but not yet due).
  const openByTenancy = new Map<string, { dueNow: number; billed: number }>();
  if (tenancyIds.length) {
    const agg = await RentCharge.aggregate<{ _id: mongoose.Types.ObjectId; dueNow: number; billed: number }>([
      { $match: { tenancyId: { $in: tenancyIds.map((id) => new ObjectId(id)) }, status: { $in: ["open", "partially_paid"] } } },
      { $set: { left: { $subtract: ["$amountKobo", "$allocatedKobo"] } } },
      { $group: { _id: "$tenancyId", billed: { $sum: "$left" }, dueNow: { $sum: { $cond: [{ $lte: ["$dueDate", today] }, "$left", 0] } } } },
    ]);
    for (const a of agg) openByTenancy.set(a._id.toString(), { dueNow: a.dueNow, billed: a.billed });
  }
  const claims = pending.map((p) => {
    const hints: string[] = [];
    if (p.externalReferenceNormalized && dupRefs.has(p.externalReferenceNormalized)) hints.push("Same reference appears on another submission");
    const { dueNow, billed } = openByTenancy.get(p.tenancyId._id.toString()) ?? { dueNow: 0, billed: 0 };
    if (p.purpose === "rent") {
      if (billed === 0) hints.push("No unpaid charge — this would be held as credit");
      else if (p.amountKobo > billed) hints.push(`Amount exceeds the ${formatKobo(billed)} billed so far; the excess would be held as credit`);
      else if (p.amountKobo < dueNow) hints.push(`Partial payment: ${formatKobo(dueNow - p.amountKobo)} would remain outstanding`);
      else if (p.amountKobo > dueNow) hints.push(`Covers everything due now; ${formatKobo(p.amountKobo - dueNow)} goes towards upcoming charges`);
    }
    if (!p.proofAssetId) hints.push("No supporting document attached");
    return { ...p, hints, openDueKobo: dueNow };
  });
  return {
    claims,
    awaitingProvider,
    problem,
    recentConfirmed,
    outstandingCharges: outstandingCharges.filter((c) => c.tenancyId?.status !== "cancelled"),
    duplicateReferenceCount: dupGroups.length,
  };
}

export async function getReceiptForActor(actor: Actor, receiptId: string) {
  await connectDb();
  const scope = await tenancyScope(actor);
  const r = await Receipt.findOne({ _id: assertId(receiptId), ...scope }).lean();
  if (!r) throw errors.notFound("Receipt not found");
  const [tenancy, landlord, payment] = await Promise.all([
    Tenancy.findById(r.tenancyId).populate<{ propertyId: { name: string; address: { line1: string; city: string; state: string } } }>("propertyId", "name address").populate<{ unitId: { unitNumber: string } }>("unitId", "unitNumber").lean(),
    User.findById(r.landlordId).select("name email phone").lean(),
    Payment.findById(r.paymentId).select("externalReference providerReference source verifiedAt").populate<{ verifiedBy: { name: string } | null }>("verifiedBy", "name").lean(),
  ]);
  return { receipt: r, tenancy, landlord, payment };
}

export async function listReceipts(actor: Actor, opts: { tenancyId?: string; page: number; pageSize: number }) {
  await connectDb();
  const scope = await tenancyScope(actor);
  const filter: Record<string, unknown> = { ...scope };
  if (opts.tenancyId) {
    const t = await getTenancyForActor(actor, opts.tenancyId);
    filter.tenancyId = t._id;
  }
  const [items, total] = await Promise.all([
    Receipt.find(filter).sort({ issuedAt: -1 }).skip((opts.page - 1) * opts.pageSize).limit(opts.pageSize).lean(),
    Receipt.countDocuments(filter),
  ]);
  return { items, total };
}

export { toISODate };

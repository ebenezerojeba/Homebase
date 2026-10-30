import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { addDays, todayInBusinessTz } from "@/lib/dates";
import { errors } from "@/lib/errors";
import { formatKobo, sumKobo } from "@/lib/money";
import { connectDb, withTransaction } from "@/server/db";
import {
  Payment,
  PaymentAllocation,
  RentCharge,
  Tenancy,
  type ChargeStatus,
  type IRentCharge,
  type ITenancy,
} from "@/server/models";
import type { Actor } from "@/server/auth/actor";
import { getLandlordTenancy, getTenancyForActor } from "./access";
import { audit, recordTimeline } from "./audit";
import { isOverdue, periodAt, rentForPeriod } from "./schedule";

const { ObjectId } = mongoose.Types;
type S = ClientSession | null;
const sys = { userId: null, role: "system" as const };

/** Charges are generated this many days before they fall due, so tenants can see and pay them in advance. */
export const CHARGE_LOOKAHEAD_DAYS = 45;

export function deriveChargeStatus(amountKobo: number, allocatedKobo: number, current?: ChargeStatus): ChargeStatus {
  if (current === "cancelled") return "cancelled";
  if (amountKobo === 0) return allocatedKobo === 0 ? "waived" : "paid";
  if (allocatedKobo >= amountKobo) return "paid";
  if (allocatedKobo > 0) return "partially_paid";
  return "open";
}

function chargeKey(tenancyId: string, index: number, kind: "rent" | "agreed", chargeId?: string) {
  return kind === "rent" ? `${tenancyId}:${index}:rent` : `${tenancyId}:${index}:charge:${chargeId}`;
}

/**
 * Idempotently create every charge whose due date is on/before `through`.
 * Safe to run any number of times: each charge has a unique idempotency key and is upserted with $setOnInsert.
 */
export async function generateCharges(tenancyId: string, through: Date, session: S = null): Promise<number> {
  const tenancy = await Tenancy.findById(tenancyId).session(session).lean();
  if (!tenancy || tenancy.status !== "active") return 0;
  const tid = tenancy._id.toString();
  const ops: Parameters<typeof RentCharge.bulkWrite>[0] = [];
  const newKeys: { key: string; label: string; amountKobo: number; dueDate: Date }[] = [];
  let lastIndex = tenancy.generatedThroughIndex;
  for (let i = Math.max(0, tenancy.generatedThroughIndex + 1); ; i++) {
    const p = periodAt(tenancy, i);
    if (!p || p.dueDate > through) break;
    lastIndex = i;
    const rent = rentForPeriod(tenancy, p);
    const common = {
      tenancyId: tenancy._id,
      landlordId: tenancy.landlordId,
      propertyId: tenancy.propertyId,
      periodIndex: i,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      dueDate: p.dueDate,
      adjustments: [],
      allocatedKobo: 0,
    };
    const rentKey = chargeKey(tid, i, "rent");
    ops.push({
      updateOne: {
        filter: { idempotencyKey: rentKey },
        update: { $setOnInsert: { ...common, kind: "rent", label: "Rent", baseAmountKobo: rent, amountKobo: rent, status: "open", idempotencyKey: rentKey } },
        upsert: true,
      },
    });
    newKeys.push({ key: rentKey, label: "Rent", amountKobo: rent, dueDate: p.dueDate });
    for (const c of tenancy.agreedCharges) {
      if (c.recurrence === "once" && i !== 0) continue;
      const key = chargeKey(tid, i, "agreed", c._id.toString());
      ops.push({
        updateOne: {
          filter: { idempotencyKey: key },
          update: { $setOnInsert: { ...common, kind: "agreed_charge", label: c.label, baseAmountKobo: c.amountKobo, amountKobo: c.amountKobo, status: "open", idempotencyKey: key } },
          upsert: true,
        },
      });
      newKeys.push({ key, label: c.label, amountKobo: c.amountKobo, dueDate: p.dueDate });
    }
  }
  if (ops.length === 0) return 0;
  const res = await RentCharge.bulkWrite(ops, { session: session ?? undefined, ordered: true });
  // Only move the high-water mark forward.
  await Tenancy.updateOne(
    { _id: tenancy._id, generatedThroughIndex: { $lt: lastIndex } },
    { $set: { generatedThroughIndex: lastIndex } },
    { session: session ?? undefined },
  );
  const inserted = res.upsertedCount ?? 0;
  if (inserted > 0) {
    const insertedIdx = new Set(Object.keys(res.upsertedIds ?? {}).map(Number));
    for (const [idx, k] of newKeys.entries()) {
      if (!insertedIdx.has(idx)) continue;
      await recordTimeline(
        {
          tenancyId: tid,
          landlordId: tenancy.landlordId.toString(),
          type: "charge_created",
          source: "system",
          actor: sys,
          summary: `${k.label} of ${formatKobo(k.amountKobo)} scheduled, due ${k.dueDate.toISOString().slice(0, 10)}`,
          entityType: "RentCharge",
          metadata: { amountKobo: k.amountKobo, dueDate: k.dueDate.toISOString().slice(0, 10), label: k.label },
          dedupeKey: `charge_created:${k.key}`,
        },
        session,
      );
    }
    await applyCredits(tid, session);
  }
  await refreshNextDueDate(tid, session);
  return inserted;
}

export async function refreshNextDueDate(tenancyId: string, session: S = null) {
  const next = await RentCharge.findOne({ tenancyId, status: { $in: ["open", "partially_paid"] } })
    .sort({ dueDate: 1 })
    .select("dueDate")
    .session(session)
    .lean();
  let nextDue = next?.dueDate ?? null;
  if (!nextDue) {
    const t = await Tenancy.findById(tenancyId).session(session).lean();
    if (t && t.status === "active") {
      const p = periodAt(t, t.generatedThroughIndex + 1);
      nextDue = p?.dueDate ?? null;
    }
  }
  await Tenancy.updateOne({ _id: tenancyId }, { $set: { nextDueDate: nextDue } }, { session: session ?? undefined });
}

/** Charges are allocated to in this order: payer's intended charges first, then oldest due date, rent before other charges. */
async function openChargesInOrder(tenancyId: string, intended: string[], session: S) {
  const charges = await RentCharge.find({ tenancyId, status: { $in: ["open", "partially_paid"] } })
    .sort({ dueDate: 1, kind: -1, _id: 1 })
    .session(session)
    .lean();
  const set = new Set(intended);
  return [...charges.filter((c) => set.has(c._id.toString())), ...charges.filter((c) => !set.has(c._id.toString()))];
}

/**
 * Atomically add `amount` to a charge's allocated total using an optimistic check on the value we read.
 * Returns false if the charge changed underneath us.
 */
async function bumpChargeAllocation(charge: Pick<IRentCharge, "_id" | "allocatedKobo" | "amountKobo" | "status">, delta: number, session: S) {
  const allocated = charge.allocatedKobo + delta;
  if (allocated < 0 || allocated > charge.amountKobo) throw new Error("Allocation would exceed charge amount");
  const res = await RentCharge.updateOne(
    { _id: charge._id, allocatedKobo: charge.allocatedKobo, amountKobo: charge.amountKobo },
    { $set: { allocatedKobo: allocated, status: deriveChargeStatus(charge.amountKobo, allocated, charge.status) } },
    { session: session ?? undefined },
  );
  return res.modifiedCount === 1;
}

/**
 * Allocate up to `available` kobo from a confirmed payment across open charges.
 * Returns the amount actually allocated.
 */
async function allocateFrom(paymentId: mongoose.Types.ObjectId, tenancyId: string, available: number, intended: string[], session: S): Promise<number> {
  let remaining = available;
  for (let attempt = 0; attempt < 3 && remaining > 0; attempt++) {
    const charges = await openChargesInOrder(tenancyId, intended, session);
    let conflict = false;
    for (const c of charges) {
      if (remaining <= 0) break;
      const due = c.amountKobo - c.allocatedKobo;
      if (due <= 0) continue;
      const amt = Math.min(due, remaining);
      if (!(await bumpChargeAllocation(c, amt, session))) {
        conflict = true;
        break;
      }
      await PaymentAllocation.updateOne(
        { paymentId, rentChargeId: c._id },
        {
          $inc: { amountKobo: amt },
          $set: { status: "active", reversedAt: null, reversalReason: null },
          $setOnInsert: { tenancyId: c.tenancyId },
        },
        { upsert: true, session: session ?? undefined },
      );
      remaining -= amt;
    }
    if (!conflict) break;
  }
  return available - remaining;
}

/** Allocate a freshly confirmed rent payment. Leftover becomes credit on the payment (unallocatedKobo). */
export async function allocatePayment(paymentId: string, session: S = null) {
  const payment = await Payment.findById(paymentId).session(session).lean();
  if (!payment || payment.status !== "confirmed" || payment.purpose !== "rent") return { allocated: 0, credit: 0 };
  const existing = await PaymentAllocation.countDocuments({ paymentId: payment._id }).session(session);
  if (existing > 0) {
    // Already allocated on a previous (partially completed) attempt — nothing to redo.
    return { allocated: payment.amountKobo - payment.unallocatedKobo, credit: payment.unallocatedKobo };
  }
  const allocated = await allocateFrom(
    payment._id,
    payment.tenancyId.toString(),
    payment.amountKobo,
    payment.intendedChargeIds.map(String),
    session,
  );
  const credit = payment.amountKobo - allocated;
  await Payment.updateOne({ _id: payment._id }, { $set: { unallocatedKobo: credit } }, { session: session ?? undefined });
  await refreshNextDueDate(payment.tenancyId.toString(), session);
  return { allocated, credit };
}

/** Apply unallocated credit (advance payments / overpayments) to open charges, oldest payment first. */
export async function applyCredits(tenancyId: string, session: S = null) {
  const payments = await Payment.find({ tenancyId, status: "confirmed", purpose: "rent", unallocatedKobo: { $gt: 0 } })
    .sort({ verifiedAt: 1, _id: 1 })
    .session(session)
    .lean();
  let applied = 0;
  for (const p of payments) {
    // Claim the credit first so concurrent runs can't spend it twice.
    const claimed = await Payment.updateOne(
      { _id: p._id, unallocatedKobo: p.unallocatedKobo },
      { $set: { unallocatedKobo: 0 } },
      { session: session ?? undefined },
    );
    if (claimed.modifiedCount !== 1) continue;
    const used = await allocateFrom(p._id, tenancyId, p.unallocatedKobo, [], session);
    const left = p.unallocatedKobo - used;
    if (left > 0) await Payment.updateOne({ _id: p._id }, { $inc: { unallocatedKobo: left } }, { session: session ?? undefined });
    if (used > 0) {
      applied += used;
      await recordTimeline(
        {
          tenancyId,
          landlordId: p.landlordId.toString(),
          type: "credit_applied",
          source: "system",
          actor: sys,
          summary: `${formatKobo(used)} of available credit applied to outstanding charges`,
          entityType: "Payment",
          entityId: p._id.toString(),
          metadata: { amountKobo: used },
        },
        session,
      );
    }
  }
  if (applied > 0) await refreshNextDueDate(tenancyId, session);
  return applied;
}

/** Undo a payment's allocations (reversal/refund). History is kept: allocations are marked reversed, never deleted. */
export async function reverseAllocations(paymentId: string, reason: string, session: S = null) {
  const allocations = await PaymentAllocation.find({ paymentId, status: "active" }).session(session).lean();
  for (const a of allocations) {
    for (let attempt = 0; ; attempt++) {
      const charge = await RentCharge.findById(a.rentChargeId).session(session).lean();
      if (!charge) break;
      const allocated = charge.allocatedKobo - a.amountKobo;
      const res = await RentCharge.updateOne(
        { _id: charge._id, allocatedKobo: charge.allocatedKobo },
        { $set: { allocatedKobo: Math.max(0, allocated), status: deriveChargeStatus(charge.amountKobo, Math.max(0, allocated), charge.status) } },
        { session: session ?? undefined },
      );
      if (res.modifiedCount === 1) break;
      if (attempt > 3) throw errors.conflict("The ledger changed while reversing. Please retry.");
    }
    await PaymentAllocation.updateOne(
      { _id: a._id },
      { $set: { status: "reversed", reversedAt: new Date(), reversalReason: reason.slice(0, 500) } },
      { session: session ?? undefined },
    );
  }
  await Payment.updateOne({ _id: paymentId }, { $set: { unallocatedKobo: 0 } }, { session: session ?? undefined });
  const p = await Payment.findById(paymentId).select("tenancyId").session(session).lean();
  if (p) await refreshNextDueDate(p.tenancyId.toString(), session);
}

/**
 * Landlord adjustment to a charge (discount, waiver, additional charge or correction).
 * The original amount is never edited; adjustments are appended. If the new amount is below what has
 * already been allocated, the excess is released back to the payments as credit.
 */
export async function adjustCharge(
  actor: Actor,
  chargeId: string,
  input: { amountKobo: number; reason: string; correctsAdjustmentId?: string | null },
) {
  if (actor.role !== "landlord") throw errors.notFound();
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo === 0) throw errors.validation("Adjustment must be a non-zero amount in kobo");
  return withTransaction(async (session) => {
    const charge = await RentCharge.findOne({ _id: chargeId, landlordId: actor.userId }).session(session).lean();
    if (!charge) throw errors.notFound("Charge not found");
    if (charge.status === "cancelled") throw errors.conflict("This charge was cancelled");
    if (input.correctsAdjustmentId && !charge.adjustments.some((a) => a._id.toString() === input.correctsAdjustmentId)) {
      throw errors.validation("The adjustment being corrected does not belong to this charge");
    }
    const newAmount = charge.amountKobo + input.amountKobo;
    if (newAmount < 0) throw errors.validation("An adjustment can't reduce a charge below zero");

    // Release over-allocation (newest allocations first) back to the paying payments as credit.
    let excess = charge.allocatedKobo - newAmount;
    if (excess > 0) {
      const allocs = await PaymentAllocation.find({ rentChargeId: charge._id, status: "active" }).sort({ createdAt: -1 }).session(session).lean();
      for (const a of allocs) {
        if (excess <= 0) break;
        const take = Math.min(a.amountKobo, excess);
        const left = a.amountKobo - take;
        await PaymentAllocation.updateOne(
          { _id: a._id },
          left === 0
            ? { $set: { amountKobo: a.amountKobo, status: "reversed", reversedAt: new Date(), reversalReason: "Released by charge adjustment" } }
            : { $set: { amountKobo: left } },
          { session: session ?? undefined },
        );
        await Payment.updateOne({ _id: a.paymentId }, { $inc: { unallocatedKobo: take } }, { session: session ?? undefined });
        excess -= take;
      }
    }
    const allocatedAfter = Math.min(charge.allocatedKobo, newAmount);
    const adjustment = {
      _id: new ObjectId(),
      amountKobo: input.amountKobo,
      reason: input.reason,
      actorId: new ObjectId(actor.userId),
      createdAt: new Date(),
      correctsAdjustmentId: input.correctsAdjustmentId ? new ObjectId(input.correctsAdjustmentId) : null,
    };
    const res = await RentCharge.updateOne(
      { _id: charge._id, amountKobo: charge.amountKobo, allocatedKobo: charge.allocatedKobo },
      {
        $push: { adjustments: adjustment },
        $set: { amountKobo: newAmount, allocatedKobo: allocatedAfter, status: deriveChargeStatus(newAmount, allocatedAfter, charge.status) },
      },
      { session: session ?? undefined },
    );
    if (res.modifiedCount !== 1) throw errors.conflict("This charge changed while you were editing. Please reload and try again.");

    const tenancyId = charge.tenancyId.toString();
    await recordTimeline(
      {
        tenancyId,
        landlordId: actor.userId,
        type: input.correctsAdjustmentId ? "correction" : "charge_adjusted",
        source: "landlord_recorded",
        actor,
        summary: `${charge.label} for period starting ${charge.periodStart.toISOString().slice(0, 10)} ${input.amountKobo < 0 ? "reduced" : "increased"} by ${formatKobo(Math.abs(input.amountKobo))}: ${input.reason}`,
        entityType: "RentCharge",
        entityId: charge._id.toString(),
        before: { amountKobo: charge.amountKobo },
        after: { amountKobo: newAmount },
        metadata: { adjustmentId: adjustment._id.toString(), reason: input.reason, correctsAdjustmentId: input.correctsAdjustmentId ?? null },
      },
      session,
    );
    await audit(actor, "charge.adjusted", "RentCharge", charge._id.toString(), { amountKobo: input.amountKobo, before: charge.amountKobo, after: newAmount }, session);
    await applyCredits(tenancyId, session);
    await refreshNextDueDate(tenancyId, session);
    return { amountKobo: newAmount };
  });
}

export interface BalanceSummary {
  /** Charges already due, minus allocations. */
  outstandingKobo: number;
  /** Subset of outstanding that is past due date + grace period. */
  overdueKobo: number;
  /** Generated charges not yet due, minus allocations. */
  upcomingKobo: number;
  /** Confirmed money not yet applied to any charge. */
  creditKobo: number;
  /** Total confirmed rent payments (excludes deposits, pending, rejected, failed). */
  confirmedPaidKobo: number;
  pendingVerificationKobo: number;
  nextDue: { chargeId: string; dueDate: Date; amountDueKobo: number; label: string } | null;
  depositHeldKobo: number;
}

/** Balance computed from ledger rows (charges, allocations, confirmed payments) — never from client state. */
export async function computeBalance(tenancyId: string, today = todayInBusinessTz()): Promise<BalanceSummary> {
  await connectDb();
  const tenancy = await Tenancy.findById(tenancyId).select("gracePeriodDays").lean();
  const grace = tenancy?.gracePeriodDays ?? 0;
  const charges = await RentCharge.find({ tenancyId, status: { $ne: "cancelled" } }).sort({ dueDate: 1, kind: -1 }).lean();
  let outstanding = 0;
  let overdue = 0;
  let upcoming = 0;
  let nextDue: BalanceSummary["nextDue"] = null;
  for (const c of charges) {
    const left = c.amountKobo - c.allocatedKobo;
    if (left <= 0) continue;
    if (c.dueDate <= today) {
      outstanding += left;
      if (isOverdue(c.dueDate, grace, today)) overdue += left;
    } else upcoming += left;
    if (!nextDue) nextDue = { chargeId: c._id.toString(), dueDate: c.dueDate, amountDueKobo: left, label: c.label };
  }
  const tid = new ObjectId(tenancyId);
  const agg = await Payment.aggregate<{ _id: { status: string; purpose: string }; total: number; credit: number }>([
    { $match: { tenancyId: tid, status: { $in: ["confirmed", "pending_verification"] } } },
    { $group: { _id: { status: "$status", purpose: "$purpose" }, total: { $sum: "$amountKobo" }, credit: { $sum: "$unallocatedKobo" } } },
  ]);
  const get = (status: string, purpose: string) => agg.find((a) => a._id.status === status && a._id.purpose === purpose);
  return {
    outstandingKobo: outstanding,
    overdueKobo: overdue,
    upcomingKobo: upcoming,
    creditKobo: get("confirmed", "rent")?.credit ?? 0,
    confirmedPaidKobo: get("confirmed", "rent")?.total ?? 0,
    pendingVerificationKobo: (get("pending_verification", "rent")?.total ?? 0) + (get("pending_verification", "deposit")?.total ?? 0),
    depositHeldKobo: get("confirmed", "deposit")?.total ?? 0,
    nextDue,
  };
}

export async function getBalanceForActor(actor: Actor, tenancyId: string) {
  const t = await getTenancyForActor(actor, tenancyId);
  return computeBalance(t._id.toString());
}

export async function listCharges(actor: Actor, tenancyId: string) {
  const t = await getTenancyForActor(actor, tenancyId);
  return RentCharge.find({ tenancyId: t._id }).sort({ dueDate: 1, kind: -1 }).lean();
}

/**
 * Reconciliation: re-derive every charge's paid amount from allocation rows and compare it with the
 * stored running total. Any mismatch indicates an interrupted write and is surfaced, not hidden.
 */
export async function reconcileTenancy(actor: Actor, tenancyId: string) {
  const t = await getLandlordTenancy(actor, tenancyId);
  const [charges, allocations, payments] = await Promise.all([
    RentCharge.find({ tenancyId: t._id }).sort({ dueDate: 1 }).lean(),
    PaymentAllocation.find({ tenancyId: t._id }).lean(),
    Payment.find({ tenancyId: t._id }).select("amountKobo status purpose unallocatedKobo externalReference providerReference method source paidOn receiptId flags").lean(),
  ]);
  const payById = new Map(payments.map((p) => [p._id.toString(), p]));
  const rows = charges.map((c) => {
    const allocs = allocations.filter((a) => a.rentChargeId.equals(c._id));
    const active = allocs.filter((a) => a.status === "active");
    const derived = sumKobo(active.map((a) => a.amountKobo));
    return {
      chargeId: c._id.toString(),
      label: c.label,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      dueDate: c.dueDate,
      baseAmountKobo: c.baseAmountKobo,
      adjustments: c.adjustments.map((a) => ({ amountKobo: a.amountKobo, reason: a.reason, at: a.createdAt })),
      amountKobo: c.amountKobo,
      storedAllocatedKobo: c.allocatedKobo,
      derivedAllocatedKobo: derived,
      outstandingKobo: c.amountKobo - derived,
      status: c.status,
      consistent: derived === c.allocatedKobo && c.amountKobo === c.baseAmountKobo + sumKobo(c.adjustments.map((a) => a.amountKobo)),
      allocations: allocs.map((a) => {
        const p = payById.get(a.paymentId.toString());
        return {
          paymentId: a.paymentId.toString(),
          amountKobo: a.amountKobo,
          status: a.status,
          paymentStatus: p?.status,
          reference: p?.externalReference ?? p?.providerReference ?? null,
          method: p?.method,
        };
      }),
    };
  });
  const confirmedRent = payments.filter((p) => p.status === "confirmed" && p.purpose === "rent");
  const paymentChecks = confirmedRent.map((p) => {
    const allocated = sumKobo(allocations.filter((a) => a.paymentId.equals(p._id) && a.status === "active").map((a) => a.amountKobo));
    return {
      paymentId: p._id.toString(),
      amountKobo: p.amountKobo,
      allocatedKobo: allocated,
      creditKobo: p.unallocatedKobo,
      consistent: allocated + p.unallocatedKobo === p.amountKobo,
      hasReceipt: Boolean(p.receiptId),
    };
  });
  // Reversed/refunded payments must not keep active allocations.
  const orphaned = allocations.filter((a) => {
    const p = payById.get(a.paymentId.toString());
    return a.status === "active" && (!p || p.status !== "confirmed");
  }).length;
  return {
    charges: rows,
    payments: paymentChecks,
    totals: {
      chargedKobo: sumKobo(rows.filter((r) => r.status !== "cancelled").map((r) => r.amountKobo)),
      allocatedKobo: sumKobo(rows.map((r) => r.derivedAllocatedKobo)),
      confirmedRentKobo: sumKobo(confirmedRent.map((p) => p.amountKobo)),
      creditKobo: sumKobo(confirmedRent.map((p) => p.unallocatedKobo)),
    },
    issues: {
      inconsistentCharges: rows.filter((r) => !r.consistent).length,
      inconsistentPayments: paymentChecks.filter((p) => !p.consistent).length,
      confirmedWithoutReceipt: paymentChecks.filter((p) => !p.hasReceipt).length,
      activeAllocationsOnUnconfirmedPayments: orphaned,
    },
  };
}

export interface StatementLine {
  date: Date;
  kind: "charge" | "adjustment" | "payment" | "reversal";
  description: string;
  debitKobo: number;
  creditKobo: number;
  balanceKobo: number;
  reference?: string | null;
  recordedBy?: string | null;
}

/**
 * Tenant statement for a date range: opening balance, charges (debits), adjustments,
 * confirmed payments (credits), reversals, and running/closing balance.
 * Only confirmed money counts; pending claims are listed separately.
 */
export async function buildStatement(actor: Actor, tenancyId: string, from: Date, to: Date) {
  const t = await getTenancyForActor(actor, tenancyId);
  const [charges, payments] = await Promise.all([
    RentCharge.find({ tenancyId: t._id, status: { $ne: "cancelled" }, dueDate: { $lte: to } }).sort({ dueDate: 1 }).lean(),
    Payment.find({ tenancyId: t._id, purpose: "rent", status: { $in: ["confirmed", "reversed", "refunded", "pending_verification"] } })
      .populate<{ verifiedBy: { name: string } | null }>("verifiedBy", "name")
      .sort({ paidOn: 1 })
      .lean(),
  ]);
  type Entry = Omit<StatementLine, "balanceKobo">;
  const entries: Entry[] = [];
  for (const c of charges) {
    entries.push({ date: c.dueDate, kind: "charge", description: `${c.label} ${c.periodStart.toISOString().slice(0, 10)} to ${c.periodEnd.toISOString().slice(0, 10)}`, debitKobo: c.baseAmountKobo, creditKobo: 0 });
    for (const a of c.adjustments) {
      entries.push({
        date: a.createdAt,
        kind: "adjustment",
        description: `Adjustment: ${a.reason}`,
        debitKobo: a.amountKobo > 0 ? a.amountKobo : 0,
        creditKobo: a.amountKobo < 0 ? -a.amountKobo : 0,
      });
    }
  }
  const pending: { date: Date; amountKobo: number; reference: string | null }[] = [];
  for (const p of payments) {
    const ref = p.externalReference ?? p.providerReference ?? null;
    if (p.status === "pending_verification") {
      pending.push({ date: p.paidOn, amountKobo: p.amountKobo, reference: ref });
      continue;
    }
    // A payment that was later reversed still appears (as received, then reversed) so history is complete.
    const verifier = p.verifiedBy?.name ?? (p.source === "provider" ? "Payment provider" : null);
    entries.push({ date: p.verifiedAt ?? p.paidOn, kind: "payment", description: `Payment (${p.method.replace("_", " ")})`, debitKobo: 0, creditKobo: p.amountKobo, reference: ref, recordedBy: verifier });
    if (p.status === "reversed" || p.status === "refunded") {
      const at = p.statusHistory.find((h) => h.status === p.status)?.at ?? p.updatedAt;
      entries.push({ date: at, kind: "reversal", description: `Payment ${p.status}${p.reversalReason ? `: ${p.reversalReason}` : ""}`, debitKobo: p.amountKobo, creditKobo: 0, reference: ref });
    }
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  let opening = 0;
  let balance = 0;
  const lines: StatementLine[] = [];
  for (const e of entries) {
    balance += e.debitKobo - e.creditKobo;
    if (e.date < from) opening = balance;
    else if (e.date <= addDays(to, 1)) lines.push({ ...e, balanceKobo: balance });
  }
  const closing = lines.length ? lines[lines.length - 1]!.balanceKobo : opening;
  return { tenancy: t, from, to, openingBalanceKobo: opening, closingBalanceKobo: closing, lines, pendingClaims: pending };
}

export type { ITenancy };

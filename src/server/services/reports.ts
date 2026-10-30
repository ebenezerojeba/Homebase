import "server-only";
import mongoose from "mongoose";
import { z } from "zod";
import { koboToDecimal, toCsv } from "@/lib/csv";
import { addDays, parseISODate, toISODate, todayInBusinessTz, formatDateTime } from "@/lib/dates";
import { errors } from "@/lib/errors";
import { label } from "@/lib/nigeria";
import { isoDate, objectId } from "@/lib/validation";
import { connectDb } from "@/server/db";
import {
  Expense,
  MaintenanceRequest,
  Payment,
  Property,
  Receipt,
  RentCharge,
  Tenancy,
  Unit,
} from "@/server/models";
import type { Actor } from "@/server/auth/actor";
import { getTenancyForActor } from "./access";
import { audit } from "./audit";
import { buildStatement, computeBalance } from "./ledger";
import { getTimeline } from "./records";

const { ObjectId } = mongoose.Types;

export const periodQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  propertyId: objectId.optional(),
});

function resolvePeriod(q: z.infer<typeof periodQuery>) {
  const today = todayInBusinessTz();
  const to = q.to ? parseISODate(q.to) : today;
  const from = q.from ? parseISODate(q.from) : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
  if (from > to) throw errors.validation("The start date must be before the end date");
  return { from, to, today };
}

/** Landlord overview. Every figure comes from ledger rows; deposits and pending claims are never counted as rent income. */
export async function landlordDashboard(actor: Actor, q: z.infer<typeof periodQuery>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const { from, to, today } = resolvePeriod(q);
  const landlordId = new ObjectId(actor.userId);
  const scope: Record<string, unknown> = { landlordId };
  if (q.propertyId) scope.propertyId = new ObjectId(q.propertyId);
  const toEnd = addDays(to, 1);

  const [propertyCount, unitAgg, collected, expected, outstanding, pendingClaims, expenses, deposits, openMaintenance, renewals, upcoming, recent, trend] = await Promise.all([
    Property.countDocuments({ landlordId, status: "active", ...(q.propertyId ? { _id: q.propertyId } : {}) }),
    Unit.aggregate<{ _id: string; n: number }>([{ $match: { ...scope, status: "active" } }, { $group: { _id: "$occupancy", n: { $sum: 1 } } }]),
    Payment.aggregate<{ total: number; n: number }>([
      { $match: { ...scope, status: "confirmed", purpose: "rent", paidOn: { $gte: from, $lt: toEnd } } },
      { $group: { _id: null, total: { $sum: "$amountKobo" }, n: { $sum: 1 } } },
    ]),
    RentCharge.aggregate<{ total: number }>([
      { $match: { ...scope, status: { $ne: "cancelled" }, dueDate: { $gte: from, $lt: toEnd } } },
      { $group: { _id: null, total: { $sum: "$amountKobo" } } },
    ]),
    RentCharge.aggregate<{ _id: null; outstanding: number; overdueCharges: number }>([
      { $match: { ...scope, status: { $in: ["open", "partially_paid"] }, dueDate: { $lte: today } } },
      { $group: { _id: null, outstanding: { $sum: { $subtract: ["$amountKobo", "$allocatedKobo"] } }, overdueCharges: { $sum: 1 } } },
    ]),
    Payment.aggregate<{ total: number; n: number }>([{ $match: { ...scope, status: "pending_verification" } }, { $group: { _id: null, total: { $sum: "$amountKobo" }, n: { $sum: 1 } } }]),
    Expense.aggregate<{ total: number }>([
      { $match: { ...scope, status: "recorded", incurredOn: { $gte: from, $lt: toEnd } } },
      { $group: { _id: null, total: { $sum: "$amountKobo" } } },
    ]),
    Payment.aggregate<{ total: number }>([{ $match: { ...scope, status: "confirmed", purpose: "deposit" } }, { $group: { _id: null, total: { $sum: "$amountKobo" } } }]),
    MaintenanceRequest.countDocuments({ ...scope, status: { $nin: ["completed", "cancelled"] } }),
    Tenancy.find({ ...scope, status: "active", renewedToId: null, endDate: { $gte: today, $lte: addDays(today, 90) } }).sort({ endDate: 1 }).limit(10).select("tenantName endDate unitId").populate<{ unitId: { unitNumber: string } }>("unitId", "unitNumber").lean(),
    RentCharge.find({ ...scope, status: { $in: ["open", "partially_paid"] }, dueDate: { $gte: today, $lte: addDays(today, 30) } })
      .sort({ dueDate: 1 })
      .limit(10)
      .populate<{ tenancyId: { _id: mongoose.Types.ObjectId; tenantName: string } }>("tenancyId", "tenantName")
      .lean(),
    Payment.find({ ...scope, status: { $in: ["confirmed", "pending_verification", "rejected", "reversed", "refunded"] } })
      .sort({ updatedAt: -1 })
      .limit(8)
      .populate<{ tenancyId: { _id: mongoose.Types.ObjectId; tenantName: string } }>("tenancyId", "tenantName")
      .lean(),
    Payment.aggregate<{ _id: string; total: number }>([
      { $match: { ...scope, status: "confirmed", purpose: "rent", paidOn: { $gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1)) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidOn" } }, total: { $sum: "$amountKobo" } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const units = { total: 0, occupied: 0, vacant: 0, unavailable: 0 };
  for (const u of unitAgg) {
    units.total += u.n;
    if (u._id === "occupied" || u._id === "vacant" || u._id === "unavailable") units[u._id] += u.n;
  }
  const overdueAgg = await RentCharge.aggregate<{ overdue: number }>([
    { $match: { ...scope, status: { $in: ["open", "partially_paid"] }, dueDate: { $lt: today } } },
    { $lookup: { from: "tenancies", localField: "tenancyId", foreignField: "_id", as: "t", pipeline: [{ $project: { gracePeriodDays: 1 } }] } },
    { $set: { grace: { $ifNull: [{ $first: "$t.gracePeriodDays" }, 0] } } },
    { $match: { $expr: { $lt: [{ $dateAdd: { startDate: "$dueDate", unit: "day", amount: "$grace" } }, today] } } },
    { $group: { _id: null, overdue: { $sum: { $subtract: ["$amountKobo", "$allocatedKobo"] } } } },
  ]);

  // Fill 12 months, including zero months, so trends aren't misleading.
  const months: { month: string; collectedKobo: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ month: key, collectedKobo: trend.find((t) => t._id === key)?.total ?? 0 });
  }

  return {
    period: { from: toISODate(from), to: toISODate(to) },
    propertyCount,
    units,
    collectedKobo: collected[0]?.total ?? 0,
    collectedCount: collected[0]?.n ?? 0,
    expectedKobo: expected[0]?.total ?? 0,
    outstandingKobo: outstanding[0]?.outstanding ?? 0,
    overdueKobo: overdueAgg[0]?.overdue ?? 0,
    pendingClaims: { count: pendingClaims[0]?.n ?? 0, totalKobo: pendingClaims[0]?.total ?? 0 },
    expensesKobo: expenses[0]?.total ?? 0,
    depositsHeldKobo: deposits[0]?.total ?? 0,
    openMaintenance,
    renewals,
    upcoming,
    recent,
    months,
  };
}

/** Per-property summary for the reports page. */
export async function propertySummaries(actor: Actor, q: z.infer<typeof periodQuery>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const { from, to, today } = resolvePeriod(q);
  const landlordId = new ObjectId(actor.userId);
  const toEnd = addDays(to, 1);
  const [props, collected, expected, outstanding, expenses, units] = await Promise.all([
    Property.find({ landlordId, status: "active" }).select("name").lean(),
    Payment.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([{ $match: { landlordId, status: "confirmed", purpose: "rent", paidOn: { $gte: from, $lt: toEnd } } }, { $group: { _id: "$propertyId", total: { $sum: "$amountKobo" } } }]),
    RentCharge.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([{ $match: { landlordId, status: { $ne: "cancelled" }, dueDate: { $gte: from, $lt: toEnd } } }, { $group: { _id: "$propertyId", total: { $sum: "$amountKobo" } } }]),
    RentCharge.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([{ $match: { landlordId, status: { $in: ["open", "partially_paid"] }, dueDate: { $lte: today } } }, { $group: { _id: "$propertyId", total: { $sum: { $subtract: ["$amountKobo", "$allocatedKobo"] } } } }]),
    Expense.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([{ $match: { landlordId, status: "recorded", incurredOn: { $gte: from, $lt: toEnd } } }, { $group: { _id: "$propertyId", total: { $sum: "$amountKobo" } } }]),
    Unit.aggregate<{ _id: mongoose.Types.ObjectId; total: number; occupied: number }>([{ $match: { landlordId, status: "active" } }, { $group: { _id: "$propertyId", total: { $sum: 1 }, occupied: { $sum: { $cond: [{ $eq: ["$occupancy", "occupied"] }, 1, 0] } } } }]),
  ]);
  const pick = (arr: { _id: mongoose.Types.ObjectId; total: number }[], id: mongoose.Types.ObjectId) => arr.find((a) => a._id.equals(id))?.total ?? 0;
  return props.map((p) => {
    const u = units.find((x) => x._id.equals(p._id));
    const collectedKobo = pick(collected, p._id);
    const expensesKobo = pick(expenses, p._id);
    return {
      propertyId: p._id.toString(),
      name: p.name,
      units: u?.total ?? 0,
      occupied: u?.occupied ?? 0,
      expectedKobo: pick(expected, p._id),
      collectedKobo,
      outstandingKobo: pick(outstanding, p._id),
      expensesKobo,
      netKobo: collectedKobo - expensesKobo,
    };
  });
}

export async function tenantDashboard(actor: Actor) {
  if (actor.role !== "tenant") throw errors.forbidden();
  await connectDb();
  const tenancies = await Tenancy.find({ tenantId: actor.userId }).sort({ status: 1, startDate: -1 })
    .populate<{ propertyId: { _id: mongoose.Types.ObjectId; name: string; address: { line1: string; city: string; state: string } } }>("propertyId", "name address")
    .populate<{ unitId: { _id: mongoose.Types.ObjectId; unitNumber: string } }>("unitId", "unitNumber")
    .populate<{ landlordId: { _id: mongoose.Types.ObjectId; name: string; phone: string | null } }>("landlordId", "name phone")
    .lean();
  const current = tenancies.find((t) => t.status === "active") ?? tenancies[0] ?? null;
  if (!current) return { current: null, tenancies: [], balance: null, recentPayments: [], pendingClaims: [], openMaintenance: 0, charges: [] };
  const [balance, recentPayments, openMaintenance, charges] = await Promise.all([
    computeBalance(current._id.toString()),
    Payment.find({ tenancyId: current._id, status: { $nin: ["initiated"] } }).sort({ createdAt: -1 }).limit(6).populate<{ receiptId: { _id: mongoose.Types.ObjectId; receiptNumber: string } | null }>("receiptId", "receiptNumber").lean(),
    MaintenanceRequest.countDocuments({ tenancyId: current._id, status: { $nin: ["completed", "cancelled"] } }),
    RentCharge.find({ tenancyId: current._id, status: { $in: ["open", "partially_paid"] } }).sort({ dueDate: 1 }).limit(12).lean(),
  ]);
  return {
    current,
    tenancies,
    balance,
    recentPayments,
    pendingClaims: recentPayments.filter((p) => p.status === "pending_verification"),
    openMaintenance,
    charges,
  };
}

/* ---------------- Exports ---------------- */

export const exportQuery = z.object({
  kind: z.enum(["payments", "charges", "expenses", "statement", "timeline", "receipts"]),
  tenancyId: objectId.optional(),
  propertyId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.string().max(40).optional(),
});

export async function buildExport(actor: Actor, q: z.infer<typeof exportQuery>): Promise<{ filename: string; csv: string }> {
  await connectDb();
  const stamp = toISODate(todayInBusinessTz());
  const { from, to } = resolvePeriod({ from: q.from, to: q.to });
  const toEnd = addDays(to, 1);

  // Scope is always derived from the session; a tenant can only ever export their own tenancy.
  let scope: Record<string, unknown>;
  if (actor.role === "landlord") {
    scope = { landlordId: new ObjectId(actor.userId) };
    if (q.propertyId) scope.propertyId = new ObjectId(q.propertyId);
    if (q.tenancyId) scope.tenancyId = (await getTenancyForActor(actor, q.tenancyId))._id;
  } else if (actor.role === "tenant") {
    if (q.kind === "expenses") throw errors.forbidden();
    if (!q.tenancyId) throw errors.validation("Choose a tenancy to export");
    scope = { tenancyId: (await getTenancyForActor(actor, q.tenancyId))._id };
  } else throw errors.forbidden();

  await audit(actor, "export.generated", "Export", null, { kind: q.kind, from: toISODate(from), to: toISODate(to), tenancyId: q.tenancyId ?? null });

  switch (q.kind) {
    case "payments": {
      const pf: Record<string, unknown> = { ...scope, paidOn: { $gte: from, $lt: toEnd } };
      if (q.status) pf.status = q.status;
      const rows = await Payment.find(pf)
        .sort({ paidOn: 1 })
        .populate<{ tenancyId: { tenantName: string } }>("tenancyId", "tenantName")
        .populate<{ verifiedBy: { name: string } | null }>("verifiedBy", "name")
        .populate<{ receiptId: { receiptNumber: string } | null }>("receiptId", "receiptNumber")
        .lean();
      return {
        filename: `payments-${stamp}.csv`,
        csv: toCsv(rows, [
          { header: "Paid on", value: (r) => toISODate(r.paidOn) },
          { header: "Tenant", value: (r) => r.tenancyId?.tenantName },
          { header: "Purpose", value: (r) => r.purpose },
          { header: "Method", value: (r) => label(r.method) },
          { header: "Amount (NGN)", type: "number", value: (r) => Number(koboToDecimal(r.amountKobo)) },
          { header: "Amount (kobo)", type: "number", value: (r) => r.amountKobo },
          { header: "Status", value: (r) => r.status },
          { header: "Recorded by", value: (r) => (r.source === "provider" ? "Payment provider" : r.source === "tenant_claim" ? "Tenant (claim)" : "Landlord") },
          { header: "Verified by", value: (r) => r.verifiedBy?.name ?? (r.source === "provider" && r.status === "confirmed" ? "Payment provider" : "") },
          { header: "Verified at", value: (r) => (r.verifiedAt ? r.verifiedAt.toISOString() : "") },
          { header: "Reference", value: (r) => r.externalReference ?? r.providerReference ?? "" },
          { header: "Receipt", value: (r) => r.receiptId?.receiptNumber ?? "" },
          { header: "Credit held (kobo)", type: "number", value: (r) => r.unallocatedKobo },
          { header: "Rejection / reversal reason", value: (r) => r.rejectionReason ?? r.reversalReason ?? "" },
        ]),
      };
    }
    case "charges": {
      const rows = await RentCharge.find({ ...scope, dueDate: { $gte: from, $lt: toEnd } }).sort({ dueDate: 1 }).populate<{ tenancyId: { tenantName: string } }>("tenancyId", "tenantName").lean();
      return {
        filename: `charges-${stamp}.csv`,
        csv: toCsv(rows, [
          { header: "Due date", value: (r) => toISODate(r.dueDate) },
          { header: "Tenant", value: (r) => r.tenancyId?.tenantName },
          { header: "Item", value: (r) => r.label },
          { header: "Period start", value: (r) => toISODate(r.periodStart) },
          { header: "Period end", value: (r) => toISODate(r.periodEnd) },
          { header: "Original (kobo)", type: "number", value: (r) => r.baseAmountKobo },
          { header: "Adjustments (kobo)", type: "number", value: (r) => r.amountKobo - r.baseAmountKobo },
          { header: "Amount (kobo)", type: "number", value: (r) => r.amountKobo },
          { header: "Paid (kobo)", type: "number", value: (r) => r.allocatedKobo },
          { header: "Outstanding (kobo)", type: "number", value: (r) => (r.status === "cancelled" ? 0 : r.amountKobo - r.allocatedKobo) },
          { header: "Status", value: (r) => r.status },
        ]),
      };
    }
    case "expenses": {
      const rows = await Expense.find({ ...scope, incurredOn: { $gte: from, $lt: toEnd } }).sort({ incurredOn: 1 }).populate<{ propertyId: { name: string } }>("propertyId", "name").lean();
      return {
        filename: `expenses-${stamp}.csv`,
        csv: toCsv(rows, [
          { header: "Date", value: (r) => toISODate(r.incurredOn) },
          { header: "Property", value: (r) => r.propertyId?.name },
          { header: "Category", value: (r) => label(r.category) },
          { header: "Description", value: (r) => r.description },
          { header: "Vendor", value: (r) => r.vendor ?? "" },
          { header: "Amount (NGN)", type: "number", value: (r) => Number(koboToDecimal(r.amountKobo)) },
          { header: "Amount (kobo)", type: "number", value: (r) => r.amountKobo },
          { header: "Status", value: (r) => r.status },
          { header: "Void reason", value: (r) => r.voidReason ?? "" },
        ]),
      };
    }
    case "receipts": {
      const rows = await Receipt.find({ ...scope, issuedAt: { $gte: from, $lt: toEnd } }).sort({ issuedAt: 1 }).lean();
      return {
        filename: `receipts-${stamp}.csv`,
        csv: toCsv(rows, [
          { header: "Receipt", value: (r) => r.receiptNumber },
          { header: "Issued", value: (r) => r.issuedAt.toISOString() },
          { header: "Paid on", value: (r) => toISODate(r.paidOn) },
          { header: "Amount (kobo)", type: "number", value: (r) => r.amountKobo },
          { header: "Method", value: (r) => label(r.method) },
          { header: "Confirmed by", value: (r) => r.confirmedBy },
          { header: "Status", value: (r) => r.status },
        ]),
      };
    }
    case "statement": {
      if (!q.tenancyId) throw errors.validation("Choose a tenancy for the statement");
      const s = await buildStatement(actor, q.tenancyId, from, to);
      const rows = [
        { date: from, kind: "opening", description: "Opening balance", debitKobo: 0, creditKobo: 0, balanceKobo: s.openingBalanceKobo, reference: "", recordedBy: "" },
        ...s.lines.map((l) => ({ ...l, reference: l.reference ?? "", recordedBy: l.recordedBy ?? "" })),
        { date: to, kind: "closing", description: "Closing balance", debitKobo: 0, creditKobo: 0, balanceKobo: s.closingBalanceKobo, reference: "", recordedBy: "" },
      ];
      return {
        filename: `statement-${stamp}.csv`,
        csv: toCsv(rows, [
          { header: "Date", value: (r) => toISODate(r.date) },
          { header: "Type", value: (r) => r.kind },
          { header: "Description", value: (r) => r.description },
          { header: "Charges (kobo)", type: "number", value: (r) => r.debitKobo },
          { header: "Payments/credits (kobo)", type: "number", value: (r) => r.creditKobo },
          { header: "Balance (kobo)", type: "number", value: (r) => r.balanceKobo },
          { header: "Reference", value: (r) => r.reference },
          { header: "Confirmed by", value: (r) => r.recordedBy },
        ]),
      };
    }
    case "timeline": {
      if (!q.tenancyId) throw errors.validation("Choose a tenancy");
      const { events } = await getTimeline(actor, q.tenancyId, { category: "all", limit: 200 });
      return {
        filename: `tenancy-record-${stamp}.csv`,
        csv: toCsv(events.slice().reverse(), [
          { header: "Timestamp (WAT)", value: (e) => formatDateTime(e.occurredAt) },
          { header: "Timestamp (UTC ISO)", value: (e) => e.occurredAt.toISOString() },
          { header: "Event", value: (e) => label(e.type) },
          { header: "Source", value: (e) => label(e.source) },
          { header: "By", value: (e) => e.actorId?.name ?? (e.actorRole === "system" || !e.actorRole ? "System" : "") },
          { header: "Summary", value: (e) => e.summary },
        ]),
      };
    }
  }
}

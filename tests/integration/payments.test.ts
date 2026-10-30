import { describe, expect, it } from "vitest";
import { addDays, todayInBusinessTz } from "@/lib/dates";
import { AuditLog, Payment, PaymentAllocation, Receipt, RentCharge, TimelineEvent } from "@/server/models";
import { adjustCharge, buildStatement, computeBalance, generateCharges, reconcileTenancy } from "@/server/services/ledger";
import {
  approvePaymentClaim,
  claimSchema,
  recordLandlordPayment,
  recordPaymentSchema,
  rejectPaymentClaim,
  reversePayment,
  submitPaymentClaim,
} from "@/server/services/payments";
import { iso, makeJoinedTenancy, makeUser } from "../support/factories";

const RENT = 100_000_00;

async function setup(opts: Parameters<typeof makeJoinedTenancy>[1] = {}) {
  const landlord = await makeUser("landlord");
  const j = await makeJoinedTenancy(landlord, { startDate: iso(-40), endDate: iso(325), rentAmountKobo: RENT, ...opts });
  const charges = await RentCharge.find({ tenancyId: j.tenancy._id }).sort({ dueDate: 1 }).lean();
  return { landlord, ...j, charges };
}

const claim = (tenancyId: string, amountKobo: number, reference: string, extra: Record<string, unknown> = {}) =>
  claimSchema.parse({ tenancyId, amountKobo, paidOn: iso(-1), method: "bank_transfer", reference, ...extra });

describe("external payment claims", () => {
  it("a claim is pending and never counted as income until the landlord confirms", async () => {
    const { landlord, tenant, tenancyId } = await setup();
    const p = await submitPaymentClaim(tenant, claim(tenancyId, RENT, "FT123"));
    expect(p.status).toBe("pending_verification");
    let bal = await computeBalance(tenancyId);
    expect(bal.confirmedPaidKobo).toBe(0);
    expect(bal.pendingVerificationKobo).toBe(RENT);
    expect(await RentCharge.countDocuments({ tenancyId, allocatedKobo: { $gt: 0 } })).toBe(0);

    await approvePaymentClaim(landlord, p._id.toString());
    bal = await computeBalance(tenancyId);
    expect(bal.confirmedPaidKobo).toBe(RENT);
    expect(bal.pendingVerificationKobo).toBe(0);
    const receipt = await Receipt.findOne({ paymentId: p._id }).lean();
    expect(receipt?.amountKobo).toBe(RENT);
    expect(receipt?.confirmedBy).toBe("landlord");
    const types = (await TimelineEvent.find({ tenancyId }).lean()).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["payment_submitted", "payment_confirmed", "receipt_issued"]));
    expect(await AuditLog.countDocuments({ action: "payment.claim_approved" })).toBe(1);
  });

  it("full payment settles the oldest charge first", async () => {
    const { landlord, tenant, tenancyId, charges } = await setup();
    const p = await submitPaymentClaim(tenant, claim(tenancyId, RENT, "FULL1"));
    await approvePaymentClaim(landlord, p._id.toString());
    const first = await RentCharge.findById(charges[0]!._id).lean();
    expect(first?.status).toBe("paid");
    expect(first?.allocatedKobo).toBe(RENT);
  });

  it("partial payment leaves the correct outstanding balance", async () => {
    const { landlord, tenant, tenancyId, charges } = await setup();
    const due = charges.filter((c) => c.dueDate <= todayInBusinessTz()).length * RENT;
    const p = await submitPaymentClaim(tenant, claim(tenancyId, 40_000_00, "PART1"));
    await approvePaymentClaim(landlord, p._id.toString());
    const bal = await computeBalance(tenancyId);
    expect(bal.outstandingKobo).toBe(due - 40_000_00);
    expect((await RentCharge.findById(charges[0]!._id).lean())?.status).toBe("partially_paid");
  });

  it("one payment can cover several charges, and overpayment becomes credit applied to later charges", async () => {
    const { landlord, tenant, tenancyId } = await setup();
    const open = await RentCharge.find({ tenancyId }).sort({ dueDate: 1 }).lean();
    const total = open.length * RENT;
    const p = await submitPaymentClaim(tenant, claim(tenancyId, total + 30_000_00, "MULTI1"));
    await approvePaymentClaim(landlord, p._id.toString());
    const allocs = await PaymentAllocation.find({ paymentId: p._id }).lean();
    expect(allocs).toHaveLength(open.length);
    let bal = await computeBalance(tenancyId);
    expect(bal.outstandingKobo).toBe(0);
    expect(bal.creditKobo).toBe(30_000_00);
    // Next period gets generated -> credit is applied automatically.
    await generateCharges(tenancyId, addDays(todayInBusinessTz(), 80));
    bal = await computeBalance(tenancyId);
    expect(bal.creditKobo).toBe(0);
    const next = await RentCharge.find({ tenancyId }).sort({ dueDate: -1 }).limit(1).lean();
    expect(next[0]?.allocatedKobo).toBe(30_000_00);
    const rec = await reconcileTenancy(landlord, tenancyId);
    expect(rec.issues).toEqual({ inconsistentCharges: 0, inconsistentPayments: 0, confirmedWithoutReceipt: 0, activeAllocationsOnUnconfirmedPayments: 0 });
  });

  it("concurrent approvals produce exactly one confirmation, allocation set and receipt", async () => {
    const { landlord, tenant, tenancyId } = await setup();
    const p = await submitPaymentClaim(tenant, claim(tenancyId, RENT, "RACE1"));
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => approvePaymentClaim(landlord, p._id.toString())));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await Receipt.countDocuments({ paymentId: p._id })).toBe(1);
    const allocated = (await PaymentAllocation.find({ paymentId: p._id }).lean()).reduce((s, a) => s + a.amountKobo, 0);
    expect(allocated).toBe(RENT);
    expect((await computeBalance(tenancyId)).confirmedPaidKobo).toBe(RENT);
  });

  it("rejects duplicate transfer references", async () => {
    const { landlord, tenant, tenancyId } = await setup();
    const p = await submitPaymentClaim(tenant, claim(tenancyId, RENT, "DUP-001"));
    await expect(submitPaymentClaim(tenant, claim(tenancyId, RENT, "dup 001"))).rejects.toThrow(/already submitted/);
    await approvePaymentClaim(landlord, p._id.toString());
    await expect(submitPaymentClaim(tenant, claim(tenancyId, RENT, "DUP001"))).rejects.toThrow(/already been confirmed/);
    // A landlord-recorded payment with the same reference can't be confirmed either (DB constraint).
    await expect(
      recordLandlordPayment(landlord, recordPaymentSchema.parse({ tenancyId, amountKobo: RENT, paidOn: iso(0), method: "bank_transfer", reference: "dup-001" })),
    ).rejects.toThrow(/already uses this transfer reference/);
  });

  it("rejection keeps the record with a reason and does not affect the balance", async () => {
    const { landlord, tenant, tenancyId } = await setup();
    const before = await computeBalance(tenancyId);
    const p = await submitPaymentClaim(tenant, claim(tenancyId, RENT, "REJ1"));
    await rejectPaymentClaim(landlord, p._id.toString(), "No matching credit in bank statement");
    const after = await computeBalance(tenancyId);
    expect(after.outstandingKobo).toBe(before.outstandingKobo);
    const stored = await Payment.findById(p._id).lean();
    expect(stored?.status).toBe("rejected");
    expect(stored?.rejectionReason).toMatch(/No matching credit/);
    await expect(approvePaymentClaim(landlord, p._id.toString())).rejects.toThrow(/can't be confirmed/);
    expect(await TimelineEvent.countDocuments({ tenancyId, type: "payment_rejected" })).toBe(1);
  });

  it("rejects future-dated claims and claims on charges from other tenancies", async () => {
    const a = await setup();
    const b = await setup();
    await expect(submitPaymentClaim(a.tenant, claim(a.tenancyId, RENT, "FUT1", { paidOn: iso(5) }))).rejects.toThrow(/future/);
    await expect(submitPaymentClaim(a.tenant, claim(a.tenancyId, RENT, "XYZ1", { chargeIds: [b.charges[0]!._id.toString()] }))).rejects.toThrow(/don't belong/);
  });
});

describe("landlord-recorded payments, deposits and reversals", () => {
  it("cash recorded by the landlord is confirmed with a receipt and attributed to the landlord", async () => {
    const { landlord, tenancyId } = await setup();
    const p = await recordLandlordPayment(landlord, recordPaymentSchema.parse({ tenancyId, amountKobo: RENT, paidOn: iso(0), method: "cash" }));
    expect(p.status).toBe("confirmed");
    expect(p.source).toBe("landlord_record");
    expect(p.verifiedBy?.toString()).toBe(landlord.userId);
    expect(await Receipt.countDocuments({ paymentId: p._id })).toBe(1);
  });

  it("deposits are tracked separately and never counted as rent", async () => {
    const { landlord, tenancyId } = await setup({ depositAmountKobo: 50_000_00 });
    const before = await computeBalance(tenancyId);
    await recordLandlordPayment(landlord, recordPaymentSchema.parse({ tenancyId, purpose: "deposit", amountKobo: 50_000_00, paidOn: iso(0), method: "bank_transfer" }));
    const after = await computeBalance(tenancyId);
    expect(after.depositHeldKobo).toBe(50_000_00);
    expect(after.confirmedPaidKobo).toBe(0);
    expect(after.outstandingKobo).toBe(before.outstandingKobo);
  });

  it("reversal keeps history: payment marked reversed, allocations reversed, receipt voided, balance restored", async () => {
    const { landlord, tenancyId } = await setup();
    const before = await computeBalance(tenancyId);
    const p = await recordLandlordPayment(landlord, recordPaymentSchema.parse({ tenancyId, amountKobo: RENT, paidOn: iso(0), method: "bank_transfer", reference: "BOUNCE1" }));
    await reversePayment(landlord, p._id.toString(), "Transfer was reversed by the bank");
    const after = await computeBalance(tenancyId);
    expect(after.outstandingKobo).toBe(before.outstandingKobo);
    expect(after.confirmedPaidKobo).toBe(0);
    expect((await Payment.findById(p._id).lean())?.status).toBe("reversed");
    expect(await PaymentAllocation.countDocuments({ paymentId: p._id, status: "reversed" })).toBeGreaterThan(0);
    expect(await PaymentAllocation.countDocuments({ paymentId: p._id, status: "active" })).toBe(0);
    expect((await Receipt.findOne({ paymentId: p._id }).lean())?.status).toBe("voided");
    const confirmed = await TimelineEvent.findOne({ entityId: p._id, type: "payment_confirmed" }).lean();
    const reversal = await TimelineEvent.findOne({ entityId: p._id, type: "payment_reversed" }).lean();
    expect(reversal?.correctsEventId?.toString()).toBe(confirmed?._id.toString());
    // Reversing again is a no-op, not a second reversal.
    await reversePayment(landlord, p._id.toString(), "again");
    expect(await TimelineEvent.countDocuments({ entityId: p._id, type: "payment_reversed" })).toBe(1);
  });

  it("a reversed reference can be re-used for a genuine later payment", async () => {
    const { landlord, tenancyId } = await setup();
    const p = await recordLandlordPayment(landlord, recordPaymentSchema.parse({ tenancyId, amountKobo: RENT, paidOn: iso(0), method: "bank_transfer", reference: "REUSE1" }));
    await reversePayment(landlord, p._id.toString(), "Entered in error");
    await expect(recordLandlordPayment(landlord, recordPaymentSchema.parse({ tenancyId, amountKobo: RENT, paidOn: iso(0), method: "bank_transfer", reference: "REUSE1" }))).resolves.toBeTruthy();
  });
});

describe("adjustments and statements", () => {
  it("adjustments are appended (never overwrite) and release over-allocation as credit", async () => {
    const { landlord, tenancyId, charges } = await setup();
    const c0 = charges[0]!;
    await recordLandlordPayment(landlord, recordPaymentSchema.parse({ tenancyId, amountKobo: RENT, paidOn: iso(0), method: "cash", chargeIds: [c0._id.toString()] }));
    await adjustCharge(landlord, c0._id.toString(), { amountKobo: -20_000_00, reason: "Agreed discount for repairs done by tenant" });
    const c = await RentCharge.findById(c0._id).lean();
    expect(c?.baseAmountKobo).toBe(RENT);
    expect(c?.amountKobo).toBe(80_000_00);
    expect(c?.adjustments).toHaveLength(1);
    // The released 20k is either credit or applied to the next open charge.
    const rec = await reconcileTenancy(landlord, tenancyId);
    expect(rec.issues.inconsistentCharges).toBe(0);
    expect(rec.issues.inconsistentPayments).toBe(0);
    expect(rec.totals.allocatedKobo + rec.totals.creditKobo).toBe(RENT);
    // Correction links to the original adjustment.
    await adjustCharge(landlord, c0._id.toString(), { amountKobo: 5_000_00, reason: "Correction: discount was 15k", correctsAdjustmentId: c!.adjustments[0]!._id.toString() });
    expect(await TimelineEvent.countDocuments({ tenancyId, type: "correction" })).toBe(1);
    await expect(adjustCharge(landlord, c0._id.toString(), { amountKobo: -1_000_000_00, reason: "too much" })).rejects.toThrow(/below zero/);
  });

  it("statement balances reconcile with the ledger", async () => {
    const { landlord, tenant, tenancyId } = await setup();
    const p = await submitPaymentClaim(tenant, claim(tenancyId, 150_000_00, "STMT1"));
    await approvePaymentClaim(landlord, p._id.toString());
    await submitPaymentClaim(tenant, claim(tenancyId, 10_000_00, "STMT2"));
    const s = await buildStatement(tenant, tenancyId, addDays(todayInBusinessTz(), -365), addDays(todayInBusinessTz(), 60));
    const bal = await computeBalance(tenancyId);
    expect(s.closingBalanceKobo).toBe(bal.outstandingKobo + bal.upcomingKobo - bal.creditKobo);
    expect(s.pendingClaims).toHaveLength(1);
    expect(s.lines.filter((l) => l.kind === "payment")).toHaveLength(1);
  });
});

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Payment, PaymentAllocation, Receipt, RentCharge, WebhookEvent } from "@/server/models";
import { PaystackProvider, setPaymentProviderForTests } from "@/server/providers/payments";
import { computeBalance } from "@/server/services/ledger";
import { initiateOnlinePayment, processWebhook, reconcilePendingOnlinePayments, verifyAndApplyProviderPayment } from "@/server/services/payments";
import { iso, makeJoinedTenancy, makeUser } from "../support/factories";

const SECRET = "sk_test_dummy_secret_for_tests";

/** Fake Paystack API: records initialize calls and serves verify responses from a table. Never touches the network. */
function fakePaystack() {
  const txs = new Map<string, { status: string; amount: number; currency: string }>();
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/transaction/initialize")) {
      const body = JSON.parse(String(init?.body));
      txs.set(body.reference, { status: "ongoing", amount: body.amount, currency: body.currency });
      return new Response(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.test/${body.reference}` } }), { status: 200 });
    }
    const m = u.match(/\/transaction\/verify\/(.+)$/);
    if (m) {
      const ref = decodeURIComponent(m[1]!);
      const tx = txs.get(ref);
      if (!tx) return new Response(JSON.stringify({ status: false, message: "Transaction reference not found" }), { status: 404 });
      return new Response(JSON.stringify({ status: true, data: { reference: ref, status: tx.status, amount: tx.amount, currency: tx.currency, paid_at: new Date().toISOString(), channel: "card", gateway_response: "Approved" } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const provider = new PaystackProvider(SECRET, "https://api.paystack.test", fetchImpl);
  return { provider, txs };
}

function signed(body: object) {
  const raw = JSON.stringify(body);
  return { raw, sig: createHmac("sha512", SECRET).update(raw).digest("hex") };
}

let ctx: Awaited<ReturnType<typeof setupTenancy>>;
async function setupTenancy() {
  const landlord = await makeUser("landlord");
  const j = await makeJoinedTenancy(landlord, { startDate: iso(-5), endDate: iso(360), rentAmountKobo: 250_000_00 });
  const charge = await RentCharge.findOne({ tenancyId: j.tenancy._id }).sort({ dueDate: 1 }).lean();
  const fake = fakePaystack();
  setPaymentProviderForTests(fake.provider);
  return { landlord, ...j, charge: charge!, ...fake };
}

beforeEach(async () => {
  ctx = await setupTenancy();
});

async function start(amountKobo?: number) {
  return initiateOnlinePayment(ctx.tenant, { tenancyId: ctx.tenancyId, chargeIds: [ctx.charge._id.toString()], amountKobo });
}

describe("online payment initiation", () => {
  it("creates a server-side payment bound to tenant, tenancy and amount", async () => {
    const r = await start();
    expect(r.authorizationUrl).toContain("checkout.paystack.test");
    const p = await Payment.findById(r.paymentId).lean();
    expect(p?.status).toBe("initiated");
    expect(p?.amountKobo).toBe(250_000_00);
    expect(p?.tenantId?.toString()).toBe(ctx.tenant.userId);
    expect(p?.providerReference).toBe(r.reference);
  });

  it("refuses amounts above what's owed and charges from other tenancies", async () => {
    await expect(start(250_000_01)).rejects.toThrow(/Amount must be/);
    const other = await makeJoinedTenancy(ctx.landlord, { startDate: iso(-5), endDate: iso(360) });
    const otherCharge = await RentCharge.findOne({ tenancyId: other.tenancy._id }).lean();
    await expect(initiateOnlinePayment(ctx.tenant, { tenancyId: ctx.tenancyId, chargeIds: [otherCharge!._id.toString()] })).rejects.toThrow();
    await expect(initiateOnlinePayment(ctx.tenant, { tenancyId: other.tenancyId, chargeIds: [otherCharge!._id.toString()] })).rejects.toThrow(/not found/i);
  });
});

describe("webhooks", () => {
  it("rejects invalid signatures without touching the ledger", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "success";
    const { raw } = signed({ event: "charge.success", data: { reference: r.reference, id: 1 } });
    const res = await processWebhook(ctx.provider, raw, "f".repeat(128));
    expect(res.httpStatus).toBe(401);
    expect(await processWebhook(ctx.provider, raw, null)).toMatchObject({ httpStatus: 401 });
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("initiated");
    expect(await WebhookEvent.countDocuments()).toBe(0);
  });

  it("a valid success event confirms exactly once, even when delivered repeatedly or concurrently", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "success";
    const { raw, sig } = signed({ event: "charge.success", data: { reference: r.reference, id: 77 } });
    const results = await Promise.all([processWebhook(ctx.provider, raw, sig), processWebhook(ctx.provider, raw, sig), processWebhook(ctx.provider, raw, sig)]);
    expect(results.every((x) => x.httpStatus === 200)).toBe(true);
    await processWebhook(ctx.provider, raw, sig);
    const p = await Payment.findById(r.paymentId).lean();
    expect(p?.status).toBe("confirmed");
    expect(await Receipt.countDocuments({ paymentId: r.paymentId })).toBe(1);
    expect(await PaymentAllocation.countDocuments({ paymentId: r.paymentId })).toBe(1);
    expect((await computeBalance(ctx.tenancyId)).confirmedPaidKobo).toBe(250_000_00);
    expect((await Receipt.findOne({ paymentId: r.paymentId }).lean())?.confirmedBy).toBe("provider");
  });

  it("does not trust the webhook body: it re-verifies with the provider", async () => {
    const r = await start();
    // Webhook claims success but the provider API says still pending.
    const { raw, sig } = signed({ event: "charge.success", data: { reference: r.reference, id: 2, amount: 250_000_00 } });
    await processWebhook(ctx.provider, raw, sig);
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("pending");
  });

  it("does not credit the ledger when the verified amount is wrong", async () => {
    const r = await start();
    Object.assign(ctx.txs.get(r.reference)!, { status: "success", amount: 1_000_00 });
    const { raw, sig } = signed({ event: "charge.success", data: { reference: r.reference, id: 3 } });
    await processWebhook(ctx.provider, raw, sig);
    const p = await Payment.findById(r.paymentId).lean();
    expect(p?.status).not.toBe("confirmed");
    expect(p?.flags).toContain("amount_mismatch");
    expect((await computeBalance(ctx.tenancyId)).confirmedPaidKobo).toBe(0);
    expect(await Receipt.countDocuments()).toBe(0);
  });

  it("does not credit the ledger when the currency is wrong", async () => {
    const r = await start();
    Object.assign(ctx.txs.get(r.reference)!, { status: "success", currency: "USD" });
    await verifyAndApplyProviderPayment(r.reference, ctx.provider);
    expect((await Payment.findById(r.paymentId).lean())?.flags).toContain("currency_mismatch");
    expect(await Receipt.countDocuments()).toBe(0);
  });

  it("failed transactions are recorded as failed; a later success (out of order) still confirms", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "failed";
    let w = signed({ event: "charge.failed", data: { reference: r.reference, id: 4 } });
    await processWebhook(ctx.provider, w.raw, w.sig);
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("failed");
    ctx.txs.get(r.reference)!.status = "success";
    w = signed({ event: "charge.success", data: { reference: r.reference, id: 5 } });
    await processWebhook(ctx.provider, w.raw, w.sig);
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("confirmed");
  });

  it("a stale failure event arriving after confirmation doesn't undo it", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "success";
    await verifyAndApplyProviderPayment(r.reference, ctx.provider);
    const w = signed({ event: "charge.failed", data: { reference: r.reference, id: 6 } });
    await processWebhook(ctx.provider, w.raw, w.sig);
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("confirmed");
  });

  it("refunds reverse allocations, void the receipt and restore the balance", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "success";
    await verifyAndApplyProviderPayment(r.reference, ctx.provider);
    const w = signed({ event: "refund.processed", data: { transaction_reference: r.reference, id: 9 } });
    await processWebhook(ctx.provider, w.raw, w.sig);
    const p = await Payment.findById(r.paymentId).lean();
    expect(p?.status).toBe("refunded");
    expect(await PaymentAllocation.countDocuments({ paymentId: r.paymentId, status: "active" })).toBe(0);
    expect((await Receipt.findOne({ paymentId: r.paymentId }).lean())?.status).toBe("voided");
    expect((await computeBalance(ctx.tenancyId)).confirmedPaidKobo).toBe(0);
  });

  it("provider-reported reversals are applied", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "success";
    await verifyAndApplyProviderPayment(r.reference, ctx.provider);
    ctx.txs.get(r.reference)!.status = "reversed";
    await verifyAndApplyProviderPayment(r.reference, ctx.provider);
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("reversed");
  });

  it("unknown references and unrelated events are acknowledged and ignored", async () => {
    const w = signed({ event: "charge.success", data: { reference: "HB_unknown", id: 10 } });
    const res = await processWebhook(ctx.provider, w.raw, w.sig);
    expect(res.httpStatus).toBe(200);
    const w2 = signed({ event: "transfer.success", data: { id: 11 } });
    expect((await processWebhook(ctx.provider, w2.raw, w2.sig)).result).toBe("ignored");
  });

  it("a failed processing attempt is retried safely on re-delivery", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "success";
    const w = signed({ event: "charge.success", data: { reference: r.reference, id: 12 } });
    const broken = new PaystackProvider(SECRET, "https://api.paystack.test", (async () => {
      throw new Error("network down");
    }) as typeof fetch);
    const first = await processWebhook(broken, w.raw, w.sig);
    expect(first.httpStatus).toBe(500);
    expect((await WebhookEvent.findOne().lean())?.status).toBe("failed");
    const second = await processWebhook(ctx.provider, w.raw, w.sig);
    expect(second.httpStatus).toBe(200);
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("confirmed");
  });
});

describe("reconciliation of unclear transactions", () => {
  it("re-verifies stale pending payments with the provider", async () => {
    const r = await start();
    ctx.txs.get(r.reference)!.status = "success";
    await Payment.collection.updateOne({ _id: new (await import("mongoose")).default.Types.ObjectId(r.paymentId) }, { $set: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    const out = await reconcilePendingOnlinePayments();
    expect(out.checked).toBe(1);
    expect((await Payment.findById(r.paymentId).lean())?.status).toBe("confirmed");
  });
});

import { describe, expect, it } from "vitest";
import { AuditLog, Conversation, TimelineEvent } from "@/server/models";
import { getTenancyForActor } from "@/server/services/access";
import { getAssetForActor, uploadAsset } from "@/server/services/assets";
import { audit } from "@/server/services/audit";
import { buildStatement, computeBalance, getBalanceForActor, reconcileTenancy } from "@/server/services/ledger";
import { addMaintenanceComment, createMaintenanceRequest, getMaintenanceDetail, listMaintenance, updateMaintenanceRequest } from "@/server/services/maintenance";
import { listConversations, listMessages, sendMessage } from "@/server/services/messaging";
import { approvePaymentClaim, claimSchema, listPayments, submitPaymentClaim } from "@/server/services/payments";
import { buildExport } from "@/server/services/reports";
import { getTimeline } from "@/server/services/records";
import { addDays, todayInBusinessTz } from "@/lib/dates";
import { iso, makeJoinedTenancy, makeUser } from "../support/factories";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF");

async function twoTenancies() {
  const landlordA = await makeUser("landlord");
  const landlordB = await makeUser("landlord");
  const a = await makeJoinedTenancy(landlordA, { startDate: iso(-5), endDate: iso(360) });
  const b = await makeJoinedTenancy(landlordB, { startDate: iso(-5), endDate: iso(360) });
  return { landlordA, landlordB, a, b };
}

describe("tenant isolation (IDOR)", () => {
  it("a tenant cannot read another tenant's tenancy, balance, statement or timeline", async () => {
    const { a, b } = await twoTenancies();
    await expect(getTenancyForActor(a.tenant, b.tenancyId)).rejects.toThrow(/not found/i);
    await expect(getBalanceForActor(a.tenant, b.tenancyId)).rejects.toThrow(/not found/i);
    await expect(buildStatement(a.tenant, b.tenancyId, new Date(0), new Date())).rejects.toThrow(/not found/i);
    await expect(getTimeline(a.tenant, b.tenancyId, { category: "all", limit: 10 })).rejects.toThrow(/not found/i);
  });

  it("a tenant cannot submit payments against another tenancy", async () => {
    const { a, b } = await twoTenancies();
    await expect(submitPaymentClaim(a.tenant, claimSchema.parse({ tenancyId: b.tenancyId, amountKobo: 100, paidOn: iso(0), method: "bank_transfer", reference: "XX1" }))).rejects.toThrow(/not found/i);
  });

  it("payment lists are scoped to the actor even if another tenancyId is requested", async () => {
    const { a, b } = await twoTenancies();
    await submitPaymentClaim(b.tenant, claimSchema.parse({ tenancyId: b.tenancyId, amountKobo: 100, paidOn: iso(0), method: "bank_transfer", reference: "BBB1" }));
    const res = await listPayments(a.tenant, { tenancyId: b.tenancyId, page: 1, pageSize: 25 });
    expect(res.total).toBe(0);
  });

  it("a landlord cannot act on another landlord's tenancy or payments", async () => {
    const { landlordA, b } = await twoTenancies();
    await expect(getTenancyForActor(landlordA, b.tenancyId)).rejects.toThrow(/not found/i);
    await expect(reconcileTenancy(landlordA, b.tenancyId)).rejects.toThrow(/not found/i);
    const p = await submitPaymentClaim(b.tenant, claimSchema.parse({ tenancyId: b.tenancyId, amountKobo: 100, paidOn: iso(0), method: "bank_transfer", reference: "BBB2" }));
    await expect(approvePaymentClaim(landlordA, p._id.toString())).rejects.toThrow(/not found/i);
  });

  it("malformed ids are treated as not found (no cast errors leaking)", async () => {
    const { a } = await twoTenancies();
    await expect(getTenancyForActor(a.tenant, "not-an-id")).rejects.toThrow(/not found/i);
    await expect(getTenancyForActor(a.tenant, '{"$ne":null}')).rejects.toThrow(/not found/i);
  });

  it("admins have no access to tenancy financial records", async () => {
    const { a } = await twoTenancies();
    const admin = await makeUser("admin");
    await expect(getTenancyForActor(admin, a.tenancyId)).rejects.toThrow(/not found/i);
  });
});

describe("messaging permissions", () => {
  it("only participants can read or post", async () => {
    const { a, b } = await twoTenancies();
    const convA = await Conversation.findOne({ tenancyId: a.tenancyId }).lean();
    await sendMessage(a.tenant, convA!._id.toString(), { body: "Hello landlord", attachmentAssetIds: [] });
    await expect(listMessages(b.tenant, convA!._id.toString(), { limit: 30 })).rejects.toThrow(/not found/i);
    await expect(sendMessage(b.tenant, convA!._id.toString(), { body: "intrusion", attachmentAssetIds: [] })).rejects.toThrow(/not found/i);
    const list = await listConversations(b.tenant);
    expect(list.map((c) => c._id)).not.toContain(convA!._id.toString());
  });

  it("tracks unread counts and supports idempotent retries", async () => {
    const { landlordA, a } = await twoTenancies();
    const conv = await Conversation.findOne({ tenancyId: a.tenancyId }).lean();
    await sendMessage(a.tenant, conv!._id.toString(), { body: "Hi", attachmentAssetIds: [], clientId: "client-msg-0001" });
    await sendMessage(a.tenant, conv!._id.toString(), { body: "Hi", attachmentAssetIds: [], clientId: "client-msg-0001" });
    const forLandlord = await listConversations(landlordA);
    expect(forLandlord[0]?.unread).toBe(1);
    const msgs = await listMessages(landlordA, conv!._id.toString(), { limit: 30 });
    expect(msgs.messages).toHaveLength(1);
  });

  it("cannot attach someone else's file", async () => {
    const { landlordA, a } = await twoTenancies();
    const conv = await Conversation.findOne({ tenancyId: a.tenancyId }).lean();
    const landlordFile = await uploadAsset(landlordA, { kind: "message_attachment", tenancyId: a.tenancyId, fileName: "x.png", body: PNG });
    await expect(sendMessage(a.tenant, conv!._id.toString(), { body: "", attachmentAssetIds: [landlordFile._id.toString()] })).rejects.toThrow(/invalid/);
  });
});

describe("documents and uploads", () => {
  it("private documents are inaccessible to other tenants and landlords", async () => {
    const { landlordA, landlordB, a, b } = await twoTenancies();
    const agreement = await uploadAsset(landlordA, { kind: "agreement", tenancyId: a.tenancyId, fileName: "agreement.pdf", body: PDF });
    await expect(getAssetForActor(a.tenant, agreement._id.toString())).resolves.toBeTruthy();
    await expect(getAssetForActor(b.tenant, agreement._id.toString())).rejects.toThrow(/not found/i);
    await expect(getAssetForActor(landlordB, agreement._id.toString())).rejects.toThrow(/not found/i);
    expect(await TimelineEvent.countDocuments({ tenancyId: a.tenancyId, type: "agreement_uploaded" })).toBe(1);
  });

  it("landlord-only files are hidden from the tenant", async () => {
    const { landlordA, a } = await twoTenancies();
    const t = await getTenancyForActor(landlordA, a.tenancyId);
    const receipt = await uploadAsset(landlordA, { kind: "expense_receipt", propertyId: t.propertyId.toString(), fileName: "invoice.pdf", body: PDF });
    await expect(getAssetForActor(a.tenant, receipt._id.toString())).rejects.toThrow(/not found/i);
  });

  it("rejects malicious, mislabeled and oversized uploads", async () => {
    const { a } = await twoTenancies();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    await expect(uploadAsset(a.tenant, { kind: "payment_proof", tenancyId: a.tenancyId, fileName: "proof.png", body: svg })).rejects.toThrow(/Upload a/);
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]);
    await expect(uploadAsset(a.tenant, { kind: "payment_proof", tenancyId: a.tenancyId, fileName: "proof.pdf", body: exe })).rejects.toThrow(/Upload a/);
    const jsPdf = Buffer.from("%PDF-1.4 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>");
    await expect(uploadAsset(a.tenant, { kind: "payment_proof", tenancyId: a.tenancyId, fileName: "p.pdf", body: jsPdf })).rejects.toThrow(/active content/);
    const big = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
    await expect(uploadAsset(a.tenant, { kind: "maintenance_photo", tenancyId: a.tenancyId, fileName: "big.png", body: big })).rejects.toThrow(/MB or smaller/);
    await expect(uploadAsset(a.tenant, { kind: "maintenance_photo", tenancyId: a.tenancyId, fileName: "doc.pdf", body: PDF })).rejects.toThrow(/image/);
  });

  it("tenants cannot upload landlord-only kinds or into other tenancies", async () => {
    const { a, b } = await twoTenancies();
    await expect(uploadAsset(a.tenant, { kind: "agreement", tenancyId: a.tenancyId, fileName: "a.pdf", body: PDF })).rejects.toThrow(/can't upload/);
    await expect(uploadAsset(a.tenant, { kind: "payment_proof", tenancyId: b.tenancyId, fileName: "a.pdf", body: PDF })).rejects.toThrow(/not found/i);
  });

  it("stores files under generated keys, never the user's filename", async () => {
    const { a } = await twoTenancies();
    const asset = await uploadAsset(a.tenant, { kind: "payment_proof", tenancyId: a.tenancyId, fileName: "../../../evil.php.png", body: PNG });
    expect(asset.storageKey).not.toContain("evil");
    expect(asset.storageKey).toMatch(/^payment_proof\/[a-f0-9]{24}\/[a-f0-9]{24}\.png$/);
    expect(asset.displayName).toBe("evil.php.png");
  });
});

describe("maintenance visibility", () => {
  it("internal notes are never returned to tenants, and tenants can't create them", async () => {
    const { landlordA, a } = await twoTenancies();
    const req = await createMaintenanceRequest(a.tenant, { tenancyId: a.tenancyId, title: "Leaking sink", description: "Kitchen sink leaks", category: "plumbing", priority: "high", assetIds: [] });
    await addMaintenanceComment(landlordA, req._id.toString(), { body: "Plumber quoted 40k — tenant may have caused this", internal: true, assetIds: [] });
    await addMaintenanceComment(landlordA, req._id.toString(), { body: "Plumber coming Tuesday", internal: false, assetIds: [] });
    const tenantView = await getMaintenanceDetail(a.tenant, req._id.toString());
    expect(tenantView.history.some((h) => h.visibility === "internal")).toBe(false);
    expect(tenantView.history.some((h) => h.body?.includes("quoted"))).toBe(false);
    const landlordView = await getMaintenanceDetail(landlordA, req._id.toString());
    expect(landlordView.history.some((h) => h.visibility === "internal")).toBe(true);
    await expect(addMaintenanceComment(a.tenant, req._id.toString(), { body: "sneaky", internal: true, assetIds: [] })).rejects.toThrow(/Only landlords/);
  });

  it("enforces the status workflow and tenant confirmation", async () => {
    const { landlordA, a } = await twoTenancies();
    const { tenantConfirmCompletion } = await import("@/server/services/maintenance");
    const req = await createMaintenanceRequest(a.tenant, { tenancyId: a.tenancyId, title: "No water", description: "Pump broken", category: "water_supply", priority: "urgent", assetIds: [] });
    const id = req._id.toString();
    await expect(updateMaintenanceRequest(a.tenant, id, { status: "completed", recordExpense: false })).rejects.toThrow();
    await updateMaintenanceRequest(landlordA, id, { status: "acknowledged", recordExpense: false });
    await updateMaintenanceRequest(landlordA, id, { status: "scheduled", expectedDate: iso(2), assignedTo: "Musa (plumber)", recordExpense: false });
    await updateMaintenanceRequest(landlordA, id, { status: "in_progress", recordExpense: false });
    const done = await updateMaintenanceRequest(landlordA, id, { status: "completed", costKobo: 35_000_00, recordExpense: true, completionNotes: "Pump replaced" });
    expect(done.expenseId).toBeTruthy();
    await tenantConfirmCompletion(a.tenant, id, { resolved: false, comment: "Still no water upstairs" });
    const after = await getMaintenanceDetail(a.tenant, id);
    expect(after.request.status).toBe("acknowledged");
    expect(after.request.tenantConfirmation).toBe("reported_unresolved");
    expect(await TimelineEvent.countDocuments({ tenancyId: a.tenancyId, type: "maintenance_status_changed" })).toBe(4);
    const { b } = await twoTenancies();
    await expect(getMaintenanceDetail(b.tenant, id)).rejects.toThrow(/not found/i);
    expect((await listMaintenance(b.tenant, { page: 1, pageSize: 25 })).total).toBe(0);
  });
});

describe("exports", () => {
  it("tenants can only export their own records; expenses are landlord-only", async () => {
    const { a, b } = await twoTenancies();
    await expect(buildExport(a.tenant, { kind: "payments", tenancyId: b.tenancyId })).rejects.toThrow(/not found/i);
    await expect(buildExport(a.tenant, { kind: "payments" })).rejects.toThrow(/Choose a tenancy/);
    await expect(buildExport(a.tenant, { kind: "expenses", tenancyId: a.tenancyId })).rejects.toThrow();
    const ok = await buildExport(a.tenant, { kind: "statement", tenancyId: a.tenancyId, from: iso(-30), to: iso(30) });
    expect(ok.csv).toContain("Opening balance");
  });

  it("exports reconcile with the ledger and neutralise formula injection", async () => {
    const { landlordA, a } = await twoTenancies();
    const p = await submitPaymentClaim(a.tenant, claimSchema.parse({ tenancyId: a.tenancyId, amountKobo: 100_000_00, paidOn: iso(0), method: "bank_transfer", reference: "=HYPERLINK(1)" }));
    await approvePaymentClaim(landlordA, p._id.toString());
    const exp = await buildExport(landlordA, { kind: "payments", from: iso(-30), to: iso(1) });
    expect(exp.csv).toContain("'=HYPERLINK(1)");
    expect(exp.csv).not.toMatch(/,=HYPERLINK/);
    const bal = await computeBalance(a.tenancyId);
    expect(exp.csv).toContain(`,${bal.confirmedPaidKobo},`);
    const timeline = await buildExport(a.tenant, { kind: "timeline", tenancyId: a.tenancyId });
    expect(timeline.csv).toContain("Payment confirmed");
    void addDays;
    void todayInBusinessTz;
  });
});

describe("audit integrity", () => {
  it("audit and timeline records are append-only through the application", async () => {
    const { landlordA, a } = await twoTenancies();
    await audit(landlordA, "test.action", "Test", null);
    await expect(AuditLog.updateMany({}, { $set: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(TimelineEvent.deleteOne({ tenancyId: a.tenancyId })).rejects.toThrow(/append-only/);
    await expect(TimelineEvent.findOneAndUpdate({ tenancyId: a.tenancyId }, { $set: { summary: "x" } })).rejects.toThrow(/append-only/);
    const ev = await TimelineEvent.findOne({ tenancyId: a.tenancyId });
    ev!.summary = "edited";
    await expect(ev!.save()).rejects.toThrow(/append-only/);
  });

  it("audit metadata never contains secrets", async () => {
    const l = await makeUser("landlord");
    await audit(l, "test.secret", "Test", null, { password: "hunter2", token: "abc", amountKobo: 5 });
    const row = await AuditLog.findOne({ action: "test.secret" }).lean();
    expect(row?.metadata).toEqual({ password: "[redacted]", token: "[redacted]", amountKobo: 5 });
  });

  it("tenants never see landlord-only timeline entries", async () => {
    const { landlordA, a } = await twoTenancies();
    const { recordTimeline } = await import("@/server/services/audit");
    await recordTimeline({ tenancyId: a.tenancyId, landlordId: landlordA.userId, type: "notice_sent", source: "landlord_recorded", actor: landlordA, summary: "private note", visibility: "landlord_only" });
    const forTenant = await getTimeline(a.tenant, a.tenancyId, { category: "all", limit: 200 });
    expect(forTenant.events.some((e) => e.summary === "private note")).toBe(false);
    const forLandlord = await getTimeline(landlordA, a.tenancyId, { category: "all", limit: 200 });
    expect(forLandlord.events.some((e) => e.summary === "private note")).toBe(true);
  });
});

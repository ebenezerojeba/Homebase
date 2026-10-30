import { describe, expect, it } from "vitest";
import { addDays, todayInBusinessTz, toISODate } from "@/lib/dates";
import { Conversation, Invitation, RentCharge, Tenancy, TimelineEvent, Unit } from "@/server/models";
import { createUnit, updateProperty } from "@/server/services/properties";
import { generateCharges } from "@/server/services/ledger";
import {
  acceptInvitation,
  changeRent,
  createInvitation,
  createTenancy,
  endTenancy,
  getInvitationPreview,
  renewTenancy,
} from "@/server/services/tenancy";
import { iso, latestInviteToken, makeProperty, makeTenancy, makeUnit, makeUser } from "../support/factories";

describe("properties and units", () => {
  it("a landlord cannot modify another landlord's property", async () => {
    const a = await makeUser("landlord");
    const b = await makeUser("landlord");
    const p = await makeProperty(a);
    await expect(
      updateProperty(b, p._id.toString(), { name: "Hijacked", propertyType: "duplex", address: { line1: "x", city: "x", lga: "x", state: "Lagos" } }),
    ).rejects.toThrow(/not found/i);
    await expect(createUnit(b, p._id.toString(), { unitNumber: "X", unitType: "room", features: [] })).rejects.toThrow(/not found/i);
  });

  it("unit names are unique per property (case-insensitive)", async () => {
    const a = await makeUser("landlord");
    const p = await makeProperty(a);
    await makeUnit(a, p._id.toString(), "Flat 1");
    await expect(makeUnit(a, p._id.toString(), "flat 1")).rejects.toThrow(/already exists/);
  });

  it("tenants cannot create properties", async () => {
    const t = await makeUser("tenant");
    await expect(makeProperty(t)).rejects.toThrow();
  });
});

describe("tenancy creation", () => {
  it("creates the tenancy, claims the unit, generates charges and records the timeline", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { startDate: iso(-40), endDate: iso(325), frequency: "monthly" });
    const unit = await Unit.findById(t.unitId).lean();
    expect(unit?.occupancy).toBe("occupied");
    expect(unit?.currentTenancyId?.toString()).toBe(t._id.toString());
    const charges = await RentCharge.find({ tenancyId: t._id }).sort({ dueDate: 1 }).lean();
    // -40 days start: periods due at -40, ~-10, ~+20 (within 45-day lookahead), ~+50 excluded.
    expect(charges.length).toBeGreaterThanOrEqual(2);
    expect(charges.every((c) => c.amountKobo === 100_000_00)).toBe(true);
    expect(await TimelineEvent.countDocuments({ tenancyId: t._id, type: "tenancy_created" })).toBe(1);
  });

  it("rejects overlapping tenancies on the same unit", async () => {
    const l = await makeUser("landlord");
    const p = await makeProperty(l);
    const u = await makeUnit(l, p._id.toString());
    await makeTenancy(l, { unitId: u._id.toString() });
    await expect(makeTenancy(l, { unitId: u._id.toString() })).rejects.toThrow(/overlap|already has an active tenancy/);
  });

  it("validates dates and amounts", async () => {
    const l = await makeUser("landlord");
    const { createTenancySchema } = await import("@/server/services/tenancy");
    const base = { unitId: "a".repeat(24), tenantName: "Ada", tenantEmail: "a@b.co", frequency: "monthly", sendInvite: false };
    expect(() => createTenancySchema.parse({ ...base, startDate: "2025-02-01", endDate: "2025-01-01", rentAmountKobo: 100 })).toThrow(/after the start/);
    expect(() => createTenancySchema.parse({ ...base, startDate: "2025-02-30", endDate: "2026-01-01", rentAmountKobo: 100 })).toThrow();
    expect(() => createTenancySchema.parse({ ...base, startDate: "2025-01-01", endDate: "2026-01-01", rentAmountKobo: 100.5 })).toThrow();
    expect(() => createTenancySchema.parse({ ...base, startDate: "2025-01-01", endDate: "2026-01-01", rentAmountKobo: -1 })).toThrow();
    void l;
  });

  it("requires a verified landlord email", async () => {
    const l = await makeUser("landlord", { verified: false });
    await expect(makeTenancy(l)).rejects.toThrow(/verify/);
  });

  it("charge generation is idempotent", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { startDate: iso(-100), endDate: iso(265) });
    const before = await RentCharge.countDocuments({ tenancyId: t._id });
    const through = addDays(todayInBusinessTz(), 45);
    // Simulate a reset high-water mark (e.g. a crashed run) and concurrent generation.
    await Tenancy.updateOne({ _id: t._id }, { $set: { generatedThroughIndex: -1 } });
    await Promise.all([generateCharges(t._id.toString(), through), generateCharges(t._id.toString(), through)]);
    expect(await RentCharge.countDocuments({ tenancyId: t._id })).toBe(before);
  });
});

describe("invitations", () => {
  it("tenant accepts with a new account and sees only their tenancy", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { tenantEmail: "newtenant@example.test" });
    await createInvitation(l, t._id.toString());
    const token = latestInviteToken();
    const preview = await getInvitationPreview(token);
    expect(preview?.terms.rentAmountKobo).toBe(100_000_00);
    expect(preview?.emailMasked).not.toContain("newtenant@");
    const res = await acceptInvitation(null, { token, acknowledgeTerms: true, registration: { name: "New Tenant", password: "tenant-pass-123", acceptPrivacy: true } });
    expect(res.session?.token).toBeTruthy();
    const updated = await Tenancy.findById(t._id).lean();
    expect(updated?.tenantId).toBeTruthy();
    expect(updated?.termsAcknowledgedAt).toBeTruthy();
    expect(await Conversation.countDocuments({ tenancyId: t._id })).toBe(1);
  });

  it("invitations are single-use", async () => {
    const l = await makeUser("landlord");
    const tenant = await makeUser("tenant");
    const t = await makeTenancy(l, { tenantEmail: tenant.email });
    await createInvitation(l, t._id.toString());
    const token = latestInviteToken();
    await acceptInvitation(tenant, { token, acknowledgeTerms: true });
    await expect(acceptInvitation(tenant, { token, acknowledgeTerms: true })).rejects.toThrow(/invalid, expired or already used/);
  });

  it("expired invitations are rejected", async () => {
    const l = await makeUser("landlord");
    const tenant = await makeUser("tenant");
    const t = await makeTenancy(l, { tenantEmail: tenant.email });
    await createInvitation(l, t._id.toString());
    const token = latestInviteToken();
    await Invitation.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getInvitationPreview(token)).toBeNull();
    await expect(acceptInvitation(tenant, { token, acknowledgeTerms: true })).rejects.toThrow();
  });

  it("a different signed-in tenant cannot accept someone else's invitation", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { tenantEmail: "intended@example.test" });
    const intruder = await makeUser("tenant");
    await createInvitation(l, t._id.toString());
    await expect(acceptInvitation(intruder, { token: latestInviteToken(), acknowledgeTerms: true })).rejects.toThrow(/different email/);
  });

  it("landlords cannot accept tenant invitations", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { tenantEmail: l.email });
    await createInvitation(l, t._id.toString());
    await expect(acceptInvitation(l, { token: latestInviteToken(), acknowledgeTerms: true })).rejects.toThrow(/tenant account/);
  });

  it("re-sending revokes the previous link", async () => {
    const l = await makeUser("landlord");
    const tenant = await makeUser("tenant");
    const t = await makeTenancy(l, { tenantEmail: tenant.email });
    await createInvitation(l, t._id.toString());
    const first = latestInviteToken();
    await createInvitation(l, t._id.toString());
    await expect(acceptInvitation(tenant, { token: first, acknowledgeTerms: true })).rejects.toThrow();
    await expect(acceptInvitation(tenant, { token: latestInviteToken(), acknowledgeTerms: true })).resolves.toBeTruthy();
  });

  it("garbage tokens are rejected", async () => {
    expect(await getInvitationPreview("not-a-real-token-123")).toBeNull();
  });
});

describe("term changes, ending and renewal", () => {
  it("rent changes never alter already-billed charges", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { startDate: iso(-10), endDate: iso(355) });
    const billed = await RentCharge.find({ tenancyId: t._id }).lean();
    await expect(changeRent(l, t._id.toString(), { amountKobo: 150_000_00, effectiveFrom: iso(-10) })).rejects.toThrow(/already been billed/);
    await changeRent(l, t._id.toString(), { amountKobo: 150_000_00, effectiveFrom: iso(100) });
    const after = await RentCharge.find({ _id: { $in: billed.map((c) => c._id) } }).lean();
    expect(after.map((c) => c.amountKobo)).toEqual(billed.map((c) => c.amountKobo));
    const tt = await Tenancy.findById(t._id).lean();
    expect(tt?.rentSchedule).toHaveLength(2);
    expect(await TimelineEvent.countDocuments({ tenancyId: t._id, type: "tenancy_terms_changed" })).toBe(1);
  });

  it("ending a tenancy cancels unpaid future charges only, and frees the unit", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { startDate: iso(-5), endDate: iso(360) });
    await generateCharges(t._id.toString(), addDays(todayInBusinessTz(), 45));
    await endTenancy(l, t._id.toString(), { endDate: iso(10), kind: "terminated", reason: "Mutual agreement" });
    const charges = await RentCharge.find({ tenancyId: t._id }).lean();
    expect(charges.filter((c) => c.periodStart > addDays(todayInBusinessTz(), 10)).every((c) => c.status === "cancelled")).toBe(true);
    expect(charges.some((c) => c.status === "open")).toBe(true); // current period remains owed
    const unit = await Unit.findById(t.unitId).lean();
    expect(unit?.currentTenancyId).toBeNull();
    expect(unit?.occupancy).toBe("vacant");
  });

  it("renewal creates a linked tenancy and keeps the unit occupied", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l, { startDate: iso(-300), endDate: iso(64), frequency: "annual", rentAmountKobo: 1_200_000_00 });
    const r = await renewTenancy(l, t._id.toString(), { endDate: iso(64 + 365), rentAmountKobo: 1_400_000_00, frequency: "annual", gracePeriodDays: 7, agreedCharges: [] });
    const renewal = await Tenancy.findById(r.tenancyId).lean();
    expect(toISODate(renewal!.startDate)).toBe(iso(65));
    expect(renewal?.renewedFromId?.toString()).toBe(t._id.toString());
    expect((await Unit.findById(t.unitId).lean())?.currentTenancyId?.toString()).toBe(r.tenancyId);
    await expect(renewTenancy(l, t._id.toString(), { endDate: iso(800), rentAmountKobo: 1, frequency: "annual", gracePeriodDays: 0, agreedCharges: [] })).rejects.toThrow(/already been renewed/);
  });

  it("units can host a new tenancy after the previous one ended (no overlap)", async () => {
    const l = await makeUser("landlord");
    const p = await makeProperty(l);
    const u = await makeUnit(l, p._id.toString());
    const t1 = await makeTenancy(l, { unitId: u._id.toString(), startDate: iso(-100), endDate: iso(100) });
    await endTenancy(l, t1._id.toString(), { endDate: iso(-1), kind: "terminated", reason: "Left early" });
    await expect(
      createTenancy(l, { unitId: u._id.toString(), tenantName: "B", tenantEmail: "b@example.test", startDate: iso(-5), endDate: iso(300), frequency: "monthly", rentAmountKobo: 5000, gracePeriodDays: 0, depositAmountKobo: 0, agreedCharges: [], prorateFinalPeriod: false, sendInvite: false }),
    ).rejects.toThrow(/overlap/);
    await expect(
      createTenancy(l, { unitId: u._id.toString(), tenantName: "B", tenantEmail: "b@example.test", startDate: iso(0), endDate: iso(300), frequency: "monthly", rentAmountKobo: 5000, gracePeriodDays: 0, depositAmountKobo: 0, agreedCharges: [], prorateFinalPeriod: false, sendInvite: false }),
    ).resolves.toBeTruthy();
  });
});

import { addDays, toISODate, todayInBusinessTz } from "@/lib/dates";
import type { Actor } from "@/server/auth/actor";
import { hashPassword } from "@/server/auth/crypto";
import { User } from "@/server/models";
import { createProperty, createUnit } from "@/server/services/properties";
import { acceptInvitation, createTenancy } from "@/server/services/tenancy";
import { hashToken } from "@/server/auth/crypto";
import { Invitation } from "@/server/models";
import { devOutbox } from "@/server/providers/email";

let n = 0;
export const PASSWORD = "correct-horse-42";

export async function makeUser(role: "landlord" | "tenant" | "admin", overrides: Partial<{ email: string; name: string; verified: boolean }> = {}): Promise<Actor> {
  n++;
  const email = overrides.email ?? `${role}${n}@example.test`;
  const u = await User.create({
    name: overrides.name ?? `${role} ${n}`,
    email,
    passwordHash: await hashPassword(PASSWORD),
    role,
    emailVerifiedAt: overrides.verified === false ? null : new Date(),
  });
  return { userId: u._id.toString(), role, name: u.name, email, emailVerified: overrides.verified !== false };
}

export async function makeProperty(landlord: Actor, name = "Palm Court") {
  return createProperty(landlord, {
    name,
    propertyType: "apartment_block",
    address: { line1: "12 Admiralty Way", city: "Lekki", lga: "Eti-Osa", state: "Lagos" },
  });
}

export async function makeUnit(landlord: Actor, propertyId: string, unitNumber = "Flat 1") {
  return createUnit(landlord, propertyId, { unitNumber, unitType: "two_bedroom", features: [] });
}

export function iso(daysFromToday: number) {
  return toISODate(addDays(todayInBusinessTz(), daysFromToday));
}

export async function makeTenancy(
  landlord: Actor,
  opts: Partial<{ unitId: string; startDate: string; endDate: string; rentAmountKobo: number; frequency: "monthly" | "quarterly" | "half_yearly" | "annual"; tenantEmail: string; gracePeriodDays: number; depositAmountKobo: number }> = {},
) {
  let unitId = opts.unitId;
  if (!unitId) {
    const p = await makeProperty(landlord);
    unitId = (await makeUnit(landlord, p._id.toString()))._id.toString();
  }
  return createTenancy(landlord, {
    unitId,
    tenantName: "Ada Obi",
    tenantEmail: opts.tenantEmail ?? `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
    startDate: opts.startDate ?? iso(-10),
    endDate: opts.endDate ?? iso(355),
    frequency: opts.frequency ?? "monthly",
    rentAmountKobo: opts.rentAmountKobo ?? 100_000_00,
    gracePeriodDays: opts.gracePeriodDays ?? 0,
    depositAmountKobo: opts.depositAmountKobo ?? 0,
    agreedCharges: [],
    prorateFinalPeriod: false,
    sendInvite: false,
  });
}

/** Create a tenancy and have a tenant join it through the real invitation flow. */
export async function makeJoinedTenancy(landlord: Actor, opts: Parameters<typeof makeTenancy>[1] = {}) {
  const tenant = await makeUser("tenant");
  const tenancy = await makeTenancy(landlord, { ...opts, tenantEmail: tenant.email });
  const { createInvitation } = await import("@/server/services/tenancy");
  await createInvitation(landlord, tenancy._id.toString());
  const token = latestInviteToken();
  await acceptInvitation(tenant, { token, acknowledgeTerms: true });
  return { tenant, tenancy, tenancyId: tenancy._id.toString() };
}

export function latestInviteToken(): string {
  for (let i = devOutbox.length - 1; i >= 0; i--) {
    const m = devOutbox[i]!.text.match(/\/invite\/([A-Za-z0-9_-]+)/);
    if (m) return decodeURIComponent(m[1]!);
  }
  throw new Error("No invite email found");
}

export function latestTokenFromEmail(path: string): string {
  for (let i = devOutbox.length - 1; i >= 0; i--) {
    const m = devOutbox[i]!.text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  throw new Error(`No ${path} email found`);
}

export async function inviteExists(token: string) {
  return Invitation.exists({ tokenHash: hashToken(token) });
}

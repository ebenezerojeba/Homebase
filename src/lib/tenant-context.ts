import "server-only";
import { connectDb } from "@/server/db";
import { Tenancy } from "@/server/models";
import type { Actor } from "@/server/auth/actor";

/** The tenant's tenancy to show: ?t=<id> if it's theirs, else the active one, else the latest. */
export async function resolveTenantTenancy(actor: Actor, requested?: string) {
  await connectDb();
  const all = await Tenancy.find({ tenantId: actor.userId })
    .sort({ status: 1, startDate: -1 })
    .populate<{ propertyId: { _id: unknown; name: string; address: { line1: string; city: string; lga: string; state: string } } }>("propertyId", "name address")
    .populate<{ unitId: { _id: unknown; unitNumber: string; unitType: string } }>("unitId", "unitNumber unitType")
    .populate<{ landlordId: { _id: unknown; name: string; email: string; phone: string | null } }>("landlordId", "name email phone")
    .lean();
  const chosen = (requested && all.find((t) => t._id.toString() === requested)) || all.find((t) => t.status === "active") || all[0] || null;
  return { tenancy: chosen, all };
}

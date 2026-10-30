import "server-only";
import mongoose from "mongoose";
import { errors } from "@/lib/errors";
import { connectDb } from "@/server/db";
import { Property, Tenancy, Unit, type ITenancy } from "@/server/models";
import type { Actor } from "@/server/auth/actor";

export function assertId(id: string): string {
  if (!mongoose.isValidObjectId(id) || !/^[a-f0-9]{24}$/i.test(id)) throw errors.notFound();
  return id;
}

/**
 * Ownership checks. They all return NOT_FOUND (not FORBIDDEN) for records the actor can't see,
 * so guessed ids reveal nothing about other users' data.
 */
export async function getOwnedProperty(actor: Actor, propertyId: string) {
  await connectDb();
  if (actor.role !== "landlord") throw errors.notFound();
  const property = await Property.findOne({ _id: assertId(propertyId), landlordId: actor.userId }).lean();
  if (!property) throw errors.notFound("Property not found");
  return property;
}

export async function getOwnedUnit(actor: Actor, unitId: string) {
  await connectDb();
  if (actor.role !== "landlord") throw errors.notFound();
  const unit = await Unit.findOne({ _id: assertId(unitId), landlordId: actor.userId }).lean();
  if (!unit) throw errors.notFound("Unit not found");
  return unit;
}

/** A tenancy is visible to its landlord and its linked tenant only. */
export async function getTenancyForActor(actor: Actor, tenancyId: string): Promise<ITenancy> {
  await connectDb();
  assertId(tenancyId);
  const filter =
    actor.role === "landlord"
      ? { _id: tenancyId, landlordId: actor.userId }
      : actor.role === "tenant"
        ? { _id: tenancyId, tenantId: actor.userId }
        : null;
  if (!filter) throw errors.notFound();
  const tenancy = await Tenancy.findOne(filter).lean();
  if (!tenancy) throw errors.notFound("Tenancy not found");
  return tenancy;
}

export async function getLandlordTenancy(actor: Actor, tenancyId: string): Promise<ITenancy> {
  if (actor.role !== "landlord") throw errors.notFound();
  return getTenancyForActor(actor, tenancyId);
}

/** Filter fragment restricting tenancy-scoped collections to what the actor may see. */
export async function tenancyScope(actor: Actor): Promise<Record<string, unknown>> {
  await connectDb();
  if (actor.role === "landlord") return { landlordId: new mongoose.Types.ObjectId(actor.userId) };
  if (actor.role === "tenant") {
    const ids = await Tenancy.find({ tenantId: actor.userId }).distinct("_id");
    return { tenancyId: { $in: ids } };
  }
  return { _id: null }; // matches nothing
}

import "server-only";
import { z } from "zod";
import { errors, isDuplicateKeyError } from "@/lib/errors";
import { NIGERIAN_STATES, PROPERTY_TYPES, UNIT_TYPES } from "@/lib/nigeria";
import { objectId, requiredText, shortText } from "@/lib/validation";
import { connectDb } from "@/server/db";
import { Asset, Property, Tenancy, Unit } from "@/server/models";
import type { Actor } from "@/server/auth/actor";
import { getOwnedProperty, getOwnedUnit } from "./access";
import { audit } from "./audit";

export const propertySchema = z.object({
  name: requiredText(120, "Give the property a name"),
  propertyType: z.enum(PROPERTY_TYPES),
  address: z.object({
    line1: requiredText(200, "Enter the street address"),
    line2: shortText(200).optional(),
    city: requiredText(100, "Enter the city or town"),
    lga: requiredText(100, "Enter the LGA"),
    state: z.enum(NIGERIAN_STATES, { error: "Choose a state" }),
  }),
  description: shortText(2000).optional(),
});

export async function createProperty(actor: Actor, input: z.infer<typeof propertySchema>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const p = await Property.create({ ...input, landlordId: actor.userId, description: input.description ?? null });
  await audit(actor, "property.created", "Property", p._id.toString());
  return p.toObject();
}

export async function updateProperty(actor: Actor, propertyId: string, input: z.infer<typeof propertySchema>) {
  const p = await getOwnedProperty(actor, propertyId);
  await Property.updateOne({ _id: p._id, landlordId: actor.userId }, { $set: { ...input, description: input.description ?? null } });
  await audit(actor, "property.updated", "Property", p._id.toString());
}

export async function setPropertyArchived(actor: Actor, propertyId: string, archived: boolean) {
  const p = await getOwnedProperty(actor, propertyId);
  if (archived && (await Tenancy.exists({ propertyId: p._id, status: "active" }))) {
    throw errors.conflict("End or renew the active tenancies on this property before archiving it");
  }
  await Property.updateOne({ _id: p._id }, { $set: { status: archived ? "archived" : "active", archivedAt: archived ? new Date() : null } });
  await audit(actor, archived ? "property.archived" : "property.restored", "Property", p._id.toString());
}

export async function listProperties(actor: Actor, opts: { includeArchived?: boolean } = {}) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const filter: Record<string, unknown> = { landlordId: actor.userId };
  if (!opts.includeArchived) filter.status = "active";
  const properties = await Property.find(filter).sort({ createdAt: -1 }).lean();
  const ids = properties.map((p) => p._id);
  const counts = await Unit.aggregate<{ _id: unknown; total: number; occupied: number }>([
    { $match: { propertyId: { $in: ids }, status: "active" } },
    { $group: { _id: "$propertyId", total: { $sum: 1 }, occupied: { $sum: { $cond: [{ $eq: ["$occupancy", "occupied"] }, 1, 0] } } } },
  ]);
  const coverIds = properties.map((p) => p.imageAssetIds[0]).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const covers = await Asset.find({ _id: { $in: coverIds }, status: "active" }).select("_id").lean();
  const coverSet = new Set(covers.map((c) => c._id.toString()));
  return properties.map((p) => {
    const c = counts.find((x) => String(x._id) === p._id.toString());
    const cover = p.imageAssetIds[0]?.toString();
    return { ...p, unitCount: c?.total ?? 0, occupiedCount: c?.occupied ?? 0, coverAssetId: cover && coverSet.has(cover) ? cover : null };
  });
}

export async function getPropertyDetail(actor: Actor, propertyId: string) {
  const property = await getOwnedProperty(actor, propertyId);
  const [units, tenancies, images] = await Promise.all([
    Unit.find({ propertyId: property._id }).sort({ status: 1, unitNumber: 1 }).collation({ locale: "en", numericOrdering: true }).lean(),
    Tenancy.find({ propertyId: property._id }).sort({ startDate: -1 }).select("unitId tenantName status startDate endDate tenantId nextDueDate").lean(),
    Asset.find({ _id: { $in: property.imageAssetIds }, status: "active" }).select("_id displayName").lean(),
  ]);
  return { property, units, tenancies, images };
}

export const unitSchema = z.object({
  unitNumber: requiredText(40, "Enter a unit name or number"),
  unitType: z.enum(UNIT_TYPES),
  bedrooms: z.number().int().min(0).max(50).nullable().optional(),
  bathrooms: z.number().int().min(0).max(50).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  occupancy: z.enum(["vacant", "unavailable"]).optional(),
});

export async function createUnit(actor: Actor, propertyId: string, input: z.infer<typeof unitSchema>) {
  const p = await getOwnedProperty(actor, propertyId);
  if (p.status !== "active") throw errors.conflict("This property is archived");
  try {
    const u = await Unit.create({
      propertyId: p._id,
      landlordId: actor.userId,
      unitNumber: input.unitNumber,
      unitType: input.unitType,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      features: input.features,
      occupancy: input.occupancy ?? "vacant",
    });
    await audit(actor, "unit.created", "Unit", u._id.toString(), { propertyId });
    return u.toObject();
  } catch (e) {
    if (isDuplicateKeyError(e)) throw errors.conflict(`A unit called "${input.unitNumber}" already exists on this property`);
    throw e;
  }
}

export async function updateUnit(actor: Actor, unitId: string, input: z.infer<typeof unitSchema>) {
  const u = await getOwnedUnit(actor, unitId);
  const set: Record<string, unknown> = {
    unitNumber: input.unitNumber,
    unitType: input.unitType,
    bedrooms: input.bedrooms ?? null,
    bathrooms: input.bathrooms ?? null,
    features: input.features,
  };
  // Occupancy is driven by tenancies; landlords can only toggle vacant <-> unavailable on empty units.
  if (input.occupancy && !u.currentTenancyId) set.occupancy = input.occupancy;
  try {
    await Unit.updateOne({ _id: u._id, landlordId: actor.userId }, { $set: set });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw errors.conflict(`A unit called "${input.unitNumber}" already exists on this property`);
    throw e;
  }
  await audit(actor, "unit.updated", "Unit", u._id.toString());
}

export async function setUnitArchived(actor: Actor, unitId: string, archived: boolean) {
  const u = await getOwnedUnit(actor, unitId);
  if (archived && u.currentTenancyId) throw errors.conflict("This unit has an active tenancy");
  try {
    await Unit.updateOne({ _id: u._id, currentTenancyId: null }, { $set: { status: archived ? "archived" : "active" } });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw errors.conflict("Another active unit already uses this name");
    throw e;
  }
  await audit(actor, archived ? "unit.archived" : "unit.restored", "Unit", u._id.toString());
}

export const listUnitsQuery = z.object({ propertyId: objectId.optional(), occupancy: z.enum(["vacant", "occupied", "unavailable"]).optional() });

export async function listUnits(actor: Actor, q: z.infer<typeof listUnitsQuery>) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const filter: Record<string, unknown> = { landlordId: actor.userId, status: "active" };
  if (q.propertyId) filter.propertyId = q.propertyId;
  if (q.occupancy) filter.occupancy = q.occupancy;
  return Unit.find(filter)
    .sort({ propertyId: 1, unitNumber: 1 })
    .collation({ locale: "en", numericOrdering: true })
    .populate<{ propertyId: { _id: unknown; name: string } }>("propertyId", "name")
    .populate<{ currentTenancyId: { _id: unknown; tenantName: string; nextDueDate: Date | null } | null }>("currentTenancyId", "tenantName nextDueDate")
    .lean();
}

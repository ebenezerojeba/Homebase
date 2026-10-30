import "server-only";
import mongoose from "mongoose";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { detectFileType, MB, pdfLooksUnsafe, sanitizeDisplayName } from "@/lib/files";
import { connectDb } from "@/server/db";
import { Asset, Property, Tenancy, type AssetKind, type IAsset } from "@/server/models";
import { storageProvider } from "@/server/providers/storage";
import type { Actor } from "@/server/auth/actor";
import { sha256Hex } from "@/server/auth/crypto";
import { assertId, getOwnedProperty, getTenancyForActor } from "./access";
import { audit, recordTimeline } from "./audit";

const { ObjectId } = mongoose.Types;

interface KindRule {
  mimes: string[];
  maxBytes: number;
  access: "public" | "private";
  uploaders: ("landlord" | "tenant")[];
  scope: "tenancy" | "property";
  sharedWithTenant: boolean;
}

const IMAGES = ["image/jpeg", "image/png", "image/webp"];
const DOCS = [...IMAGES, "application/pdf"];

export const KIND_RULES: Record<AssetKind, KindRule> = {
  property_image: { mimes: IMAGES, maxBytes: 8 * MB, access: "public", uploaders: ["landlord"], scope: "property", sharedWithTenant: true },
  property_document: { mimes: DOCS, maxBytes: 10 * MB, access: "private", uploaders: ["landlord"], scope: "property", sharedWithTenant: false },
  expense_receipt: { mimes: DOCS, maxBytes: 10 * MB, access: "private", uploaders: ["landlord"], scope: "property", sharedWithTenant: false },
  agreement: { mimes: DOCS, maxBytes: 10 * MB, access: "private", uploaders: ["landlord"], scope: "tenancy", sharedWithTenant: true },
  tenancy_document: { mimes: DOCS, maxBytes: 10 * MB, access: "private", uploaders: ["landlord", "tenant"], scope: "tenancy", sharedWithTenant: true },
  payment_proof: { mimes: DOCS, maxBytes: 8 * MB, access: "private", uploaders: ["tenant"], scope: "tenancy", sharedWithTenant: true },
  maintenance_photo: { mimes: IMAGES, maxBytes: 8 * MB, access: "private", uploaders: ["landlord", "tenant"], scope: "tenancy", sharedWithTenant: true },
  inspection_photo: { mimes: IMAGES, maxBytes: 8 * MB, access: "private", uploaders: ["landlord", "tenant"], scope: "tenancy", sharedWithTenant: true },
  message_attachment: { mimes: DOCS, maxBytes: 8 * MB, access: "private", uploaders: ["landlord", "tenant"], scope: "tenancy", sharedWithTenant: true },
};

export const MAX_UPLOAD_BYTES = 10 * MB;

export interface UploadInput {
  kind: AssetKind;
  tenancyId?: string | null;
  propertyId?: string | null;
  fileName: string;
  body: Buffer;
  /** For agreements: upload a new version of an existing document group. */
  replacesAssetId?: string | null;
}

export async function uploadAsset(actor: Actor, input: UploadInput): Promise<IAsset> {
  await connectDb();
  const rule = KIND_RULES[input.kind];
  if (!rule) throw errors.validation("Unknown file category");
  if (actor.role === "admin" || !rule.uploaders.includes(actor.role)) throw errors.forbidden("You can't upload this type of file");
  if (input.body.length === 0) throw errors.validation("The file is empty");
  if (input.body.length > rule.maxBytes) throw errors.tooLarge(`Files of this type must be ${rule.maxBytes / MB} MB or smaller`);
  const detected = detectFileType(input.body);
  if (!detected || !rule.mimes.includes(detected.mime)) {
    throw errors.unsupported(rule.mimes.includes("application/pdf") ? "Upload a JPG, PNG, WebP image or a PDF" : "Upload a JPG, PNG or WebP image");
  }
  if (detected.mime === "application/pdf" && pdfLooksUnsafe(input.body)) throw errors.unsupported("This PDF contains active content and can't be accepted");

  let landlordId: string;
  let tenancyId: string | null = null;
  let propertyId: string | null = null;
  if (rule.scope === "tenancy") {
    if (!input.tenancyId) throw errors.validation("A tenancy is required for this upload");
    const t = await getTenancyForActor(actor, input.tenancyId);
    landlordId = t.landlordId.toString();
    tenancyId = t._id.toString();
    propertyId = t.propertyId.toString();
  } else {
    if (!input.propertyId) throw errors.validation("A property is required for this upload");
    const p = await getOwnedProperty(actor, input.propertyId);
    landlordId = p.landlordId.toString();
    propertyId = p._id.toString();
  }

  let documentGroupId: mongoose.Types.ObjectId | null = null;
  let version = 1;
  if (input.replacesAssetId) {
    const prev = await Asset.findOne({ _id: assertId(input.replacesAssetId), landlordId, tenancyId, kind: input.kind, status: "active" }).lean();
    if (!prev) throw errors.notFound("Document to replace not found");
    documentGroupId = prev.documentGroupId ?? prev._id;
    const latest = await Asset.findOne({ documentGroupId }).sort({ version: -1 }).select("version").lean();
    version = Math.max(prev.version, latest?.version ?? 1) + 1;
  }

  const id = new ObjectId();
  const key = `${input.kind}/${landlordId}/${id.toString()}.${detected.ext}`;
  const storage = storageProvider();
  try {
    await storage.put({ key, body: input.body, mimeType: detected.mime, access: rule.access });
  } catch (e) {
    // Provider-side problems (credentials, permissions, quota) shouldn't surface as a generic 500.
    logger.error("storage_upload_failed", { provider: storage.name, kind: input.kind, error: e });
    throw errors.provider("File storage isn't accepting uploads right now. Please try again later.");
  }
  const asset = await Asset.create({
    _id: id,
    ownerId: actor.userId,
    landlordId,
    tenancyId,
    propertyId,
    kind: input.kind,
    access: rule.access,
    storageProvider: storage.name,
    storageKey: key,
    mimeType: detected.mime,
    extension: detected.ext,
    sizeBytes: input.body.length,
    sha256: sha256Hex(input.body),
    displayName: sanitizeDisplayName(input.fileName, `${input.kind}.${detected.ext}`),
    documentGroupId: documentGroupId ?? (input.kind === "agreement" ? id : null),
    version,
    sharedWithTenant: rule.sharedWithTenant,
    status: "active",
  });
  await audit(actor, "asset.uploaded", "Asset", id.toString(), { kind: input.kind, sizeBytes: input.body.length, mimeType: detected.mime });

  if (tenancyId && (input.kind === "agreement" || input.kind === "tenancy_document")) {
    await recordTimeline({
      tenancyId,
      landlordId,
      type: input.kind === "agreement" ? "agreement_uploaded" : "document_uploaded",
      source: actor.role === "tenant" ? "tenant_submitted" : "landlord_recorded",
      actor,
      summary: `${input.kind === "agreement" ? `Tenancy agreement${version > 1 ? ` (version ${version})` : ""}` : "Document"} uploaded: ${asset.displayName}`,
      entityType: "Asset",
      entityId: id.toString(),
      metadata: { version, sha256: asset.sha256 },
    });
    if (input.kind === "agreement") {
      await Tenancy.updateOne({ _id: tenancyId }, { $addToSet: { agreementAssetIds: id } });
    }
  }
  if (input.kind === "property_image" && propertyId) {
    await Property.updateOne({ _id: propertyId, landlordId }, { $push: { imageAssetIds: { $each: [id], $slice: -12 } } });
  }
  return asset.toObject();
}

/** Server-side authorization for every file read. */
export async function canAccessAsset(actor: Actor, asset: IAsset): Promise<boolean> {
  if (asset.status !== "active") return false;
  if (actor.role === "landlord") return asset.landlordId.toString() === actor.userId;
  if (actor.role !== "tenant") return false;
  if (asset.ownerId.toString() === actor.userId) return true;
  if (!asset.sharedWithTenant) return false;
  if (asset.tenancyId) {
    return Boolean(await Tenancy.exists({ _id: asset.tenancyId, tenantId: actor.userId }));
  }
  if (asset.kind === "property_image" && asset.propertyId) {
    return Boolean(await Tenancy.exists({ propertyId: asset.propertyId, tenantId: actor.userId }));
  }
  return false;
}

export async function getAssetForActor(actor: Actor, assetId: string) {
  await connectDb();
  const asset = await Asset.findById(assertId(assetId)).lean();
  if (!asset || !(await canAccessAsset(actor, asset))) throw errors.notFound("File not found");
  return asset;
}

export async function listTenancyDocuments(actor: Actor, tenancyId: string) {
  const t = await getTenancyForActor(actor, tenancyId);
  const filter: Record<string, unknown> = { tenancyId: t._id, status: "active", kind: { $in: ["agreement", "tenancy_document", "payment_proof"] } };
  if (actor.role === "tenant") filter.$or = [{ sharedWithTenant: true }, { ownerId: actor.userId }];
  return Asset.find(filter).sort({ kind: 1, documentGroupId: 1, version: -1, createdAt: -1 }).select("-storageKey -sha256").lean();
}

export async function listLandlordDocuments(actor: Actor, opts: { kind?: AssetKind; page: number; pageSize: number }) {
  if (actor.role !== "landlord") throw errors.forbidden();
  await connectDb();
  const filter: Record<string, unknown> = { landlordId: actor.userId, status: "active" };
  if (opts.kind) filter.kind = opts.kind;
  const [items, total] = await Promise.all([
    Asset.find(filter).sort({ createdAt: -1 }).skip((opts.page - 1) * opts.pageSize).limit(opts.pageSize).select("-storageKey -sha256").populate<{ tenancyId: { _id: mongoose.Types.ObjectId; tenantName: string } | null }>("tenancyId", "tenantName").populate<{ propertyId: { name: string } | null }>("propertyId", "name").lean(),
    Asset.countDocuments(filter),
  ]);
  return { items, total };
}

/**
 * Soft-delete. Agreements, payment evidence and inspection photos are part of the tenancy record and
 * can't be deleted by users (retention policy); upload a new version instead.
 */
export async function deleteAsset(actor: Actor, assetId: string) {
  const asset = await getAssetForActor(actor, assetId);
  const retained: AssetKind[] = ["agreement", "payment_proof", "inspection_photo", "expense_receipt"];
  if (retained.includes(asset.kind)) throw errors.conflict("This file is part of the tenancy record and is retained. Upload a newer version instead.");
  if (asset.ownerId.toString() !== actor.userId && !(actor.role === "landlord" && asset.landlordId.toString() === actor.userId)) throw errors.forbidden();
  await Asset.updateOne({ _id: asset._id }, { $set: { status: "deleted", deletedAt: new Date() } });
  if (asset.kind === "property_image" && asset.propertyId) {
    await Property.updateOne({ _id: asset.propertyId }, { $pull: { imageAssetIds: asset._id } });
  }
  await storageProvider().remove(asset.storageKey, asset.access, asset.mimeType).catch(() => {});
  await audit(actor, "asset.deleted", "Asset", asset._id.toString(), { kind: asset.kind });
}

/** Validate that ids supplied by a client are files this actor uploaded for this tenancy. */
export async function assertOwnAssets(actor: Actor, ids: string[], tenancyId: string, kinds: AssetKind[]) {
  if (ids.length === 0) return [];
  const count = await Asset.countDocuments({ _id: { $in: ids }, ownerId: actor.userId, tenancyId, kind: { $in: kinds }, status: "active" });
  if (count !== new Set(ids).size) throw errors.validation("Some attachments are invalid. Please upload them again.");
  return ids.map((id) => new ObjectId(id));
}

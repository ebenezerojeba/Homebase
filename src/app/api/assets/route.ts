import { z } from "zod";
import { errors } from "@/lib/errors";
import { objectId } from "@/lib/validation";
import { ASSET_KINDS } from "@/server/models";
import { RULES } from "@/server/auth/rate-limit";
import { authed } from "@/server/http";
import { MAX_UPLOAD_BYTES, uploadAsset } from "@/server/services/assets";

const meta = z.object({
  kind: z.enum(ASSET_KINDS),
  tenancyId: objectId.optional(),
  propertyId: objectId.optional(),
  replacesAssetId: objectId.optional(),
});

/** Multipart upload. Type, size and content are validated server-side; the stored key is generated. */
export const POST = authed({ roles: ["landlord", "tenant"], rateLimit: RULES.upload }, async ({ req, actor }) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw errors.tooLarge("Files must be 10 MB or smaller");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw errors.badRequest("Expected a file upload");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw errors.validation("Choose a file to upload");
  if (file.size > MAX_UPLOAD_BYTES) throw errors.tooLarge("Files must be 10 MB or smaller");
  const m = meta.parse({
    kind: form.get("kind") ?? undefined,
    tenancyId: form.get("tenancyId") || undefined,
    propertyId: form.get("propertyId") || undefined,
    replacesAssetId: form.get("replacesAssetId") || undefined,
  });
  const asset = await uploadAsset(actor, { ...m, fileName: file.name, body: Buffer.from(await file.arrayBuffer()) });
  return { asset: { _id: asset._id.toString(), displayName: asset.displayName, mimeType: asset.mimeType, kind: asset.kind, version: asset.version } };
});

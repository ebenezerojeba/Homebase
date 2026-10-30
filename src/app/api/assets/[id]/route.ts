import { NextResponse } from "next/server";
import { authed } from "@/server/http";
import { storageProvider } from "@/server/providers/storage";
import { deleteAsset, getAssetForActor } from "@/server/services/assets";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Authenticated file delivery. Access is checked on every request; private files get a
 * 5-minute signed URL (Cloudinary) or are streamed by the app (local dev storage).
 */
export const GET = authed<{ id: string }>({}, async ({ req, actor, params }) => {
  const asset = await getAssetForActor(actor, params.id);
  const download = req.nextUrl.searchParams.get("download") === "1";
  const storage = storageProvider();
  const url = await storage.deliveryUrl(asset.storageKey, asset.access, asset.mimeType, SIGNED_URL_TTL_SECONDS);
  if (url) {
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "private, no-store" } });
  }
  const body = await storage.read(asset.storageKey);
  const safeName = asset.displayName.replace(/[^\w.\- ()]/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": asset.mimeType,
      "content-length": String(body.length),
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, no-store",
    },
  });
});

export const DELETE = authed<{ id: string }>({ roles: ["landlord", "tenant"] }, async ({ actor, params }) => {
  await deleteAsset(actor, params.id);
  return { ok: true };
});

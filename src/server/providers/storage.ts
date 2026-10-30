import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { env } from "@/lib/env";

export interface PutInput {
  key: string;
  body: Buffer;
  mimeType: string;
  access: "public" | "private";
}

export interface StorageProvider {
  readonly name: "cloudinary" | "local";
  put(input: PutInput): Promise<void>;
  /** A URL the browser can fetch. Private assets get a short-lived signed URL (cloudinary) or null (local: stream via app). */
  deliveryUrl(key: string, access: "public" | "private", mimeType: string, ttlSeconds: number): Promise<string | null>;
  read(key: string): Promise<Buffer>;
  remove(key: string, access: "public" | "private", mimeType: string): Promise<void>;
}

/** Local disk. Development and tests only — env validation refuses it in production. */
class LocalStorage implements StorageProvider {
  readonly name = "local" as const;
  constructor(private readonly root: string) {}
  private full(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put({ key, body }: PutInput) {
    const p = this.full(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body, { flag: "wx" });
  }
  async deliveryUrl() {
    return null;
  }
  async read(key: string) {
    return readFile(this.full(key));
  }
  async remove(key: string) {
    await unlink(this.full(key)).catch(() => {});
  }
}

/** Accepts CLOUDINARY_URL (cloudinary://key:secret@cloud) or the three separate variables. */
export function cloudinaryCredentials(e: { CLOUDINARY_URL?: string; CLOUDINARY_CLOUD_NAME?: string; CLOUDINARY_API_KEY?: string; CLOUDINARY_API_SECRET?: string }) {
  if (e.CLOUDINARY_URL) {
    const u = new URL(e.CLOUDINARY_URL);
    return { cloud_name: u.hostname, api_key: decodeURIComponent(u.username), api_secret: decodeURIComponent(u.password) };
  }
  return { cloud_name: e.CLOUDINARY_CLOUD_NAME, api_key: e.CLOUDINARY_API_KEY, api_secret: e.CLOUDINARY_API_SECRET };
}

function resourceType(mimeType: string): "image" | "raw" {
  return mimeType.startsWith("image/") ? "image" : "raw";
}

/**
 * Cloudinary. Public assets (property photos) use the normal "upload" delivery type.
 * Private assets use the "authenticated" type: they cannot be fetched without a signature, and we only
 * hand out time-limited download URLs after the app has checked the user's access.
 */
class CloudinaryStorage implements StorageProvider {
  readonly name = "cloudinary" as const;
  constructor() {
    const e = env();
    cloudinary.config({ ...cloudinaryCredentials(e), secure: true });
  }
  private publicId(key: string) {
    return `${env().CLOUDINARY_FOLDER}/${key.replace(/\.[a-z0-9]+$/, "")}`;
  }
  async put({ key, body, mimeType, access }: PutInput) {
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: this.publicId(key),
          resource_type: resourceType(mimeType),
          type: access === "public" ? "upload" : "authenticated",
          overwrite: false,
          unique_filename: false,
          use_filename: false,
        },
        (err) => (err ? reject(err) : resolve()),
      );
      stream.end(body);
    });
  }
  async deliveryUrl(key: string, access: "public" | "private", mimeType: string, ttlSeconds: number) {
    const rt = resourceType(mimeType);
    const format = key.split(".").pop() ?? "";
    if (access === "public") {
      return cloudinary.url(this.publicId(key), { resource_type: rt, type: "upload", secure: true, format: rt === "image" ? format : undefined, transformation: rt === "image" ? [{ quality: "auto", fetch_format: "auto" }] : undefined });
    }
    return cloudinary.utils.private_download_url(this.publicId(key), format, {
      resource_type: rt,
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
      attachment: false,
    });
  }
  async read(): Promise<Buffer> {
    throw new Error("Direct reads are not supported for Cloudinary; use deliveryUrl");
  }
  async remove(key: string, access: "public" | "private", mimeType: string) {
    await cloudinary.uploader.destroy(this.publicId(key), { resource_type: resourceType(mimeType), type: access === "public" ? "upload" : "authenticated", invalidate: true });
  }
}

let storage: StorageProvider | null = null;
export function storageProvider(): StorageProvider {
  if (storage) return storage;
  const e = env();
  storage = e.STORAGE_DRIVER === "cloudinary" ? new CloudinaryStorage() : new LocalStorage(e.LOCAL_STORAGE_DIR ? path.resolve(e.LOCAL_STORAGE_DIR) : path.join(os.tmpdir(), "homebase-dev-uploads"));
  return storage;
}

export function setStorageProviderForTests(p: StorageProvider | null) {
  storage = p;
}

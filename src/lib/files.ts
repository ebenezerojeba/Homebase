/**
 * File type detection from content ("magic bytes"). The browser-supplied MIME type and filename
 * are never trusted. SVG, HTML and executables are rejected because they can carry scripts.
 */
export type DetectedType = { mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; ext: "jpg" | "png" | "webp" | "pdf" };

export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

/** Reject PDFs with embedded JavaScript or auto-launch actions. */
export function pdfLooksUnsafe(buf: Buffer): boolean {
  const s = buf.toString("latin1");
  return /\/JavaScript|\/JS\s*[(<]|\/Launch|\/EmbeddedFile|\/OpenAction\s*<<[^>]*\/JS/i.test(s);
}

export const MB = 1024 * 1024;

/** Display-only name: strip paths and unsafe characters. Storage keys are always generated. */
export function sanitizeDisplayName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").slice(0, 100).trim();
  return clean || fallback;
}

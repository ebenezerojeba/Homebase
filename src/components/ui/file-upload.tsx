"use client";

import { FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
}

interface Props {
  kind: string;
  tenancyId?: string;
  propertyId?: string;
  replacesAssetId?: string;
  accept?: string;
  multiple?: boolean;
  max?: number;
  label?: string;
  hint?: string;
  onChange: (files: UploadedFile[]) => void;
}

/** Uploads with progress via XHR. The server re-validates type, size and content; `accept` is only a hint. */
export function FileUpload({ kind, tenancyId, propertyId, replacesAssetId, accept = "image/jpeg,image/png,image/webp,application/pdf", multiple, max = 4, label = "Attach files", hint, onChange }: Props) {
  const inputId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function upload(file: File): Promise<UploadedFile> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      if (tenancyId) fd.append("tenancyId", tenancyId);
      if (propertyId) fd.append("propertyId", propertyId);
      if (replacesAssetId) fd.append("replacesAssetId", replacesAssetId);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/assets");
      xhr.upload.onprogress = (e) => e.lengthComputable && setProgress({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) });
      xhr.onload = () => {
        let body: { asset?: { _id: string; displayName: string; mimeType: string }; error?: { message: string } } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300 && body.asset) resolve({ id: body.asset._id, name: body.asset.displayName, mimeType: body.asset.mimeType });
        else reject(new Error(body.error?.message ?? "Upload failed"));
      };
      xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
      xhr.send(fd);
    });
  }

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const picked = Array.from(list).slice(0, Math.max(0, max - files.length));
    let next = files;
    for (const f of picked) {
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} is larger than 10 MB`);
        continue;
      }
      try {
        const up = await upload(f);
        next = [...next, up];
        setFiles(next);
        onChange(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    }
    setProgress(null);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-700 hover:border-emerald-600 hover:bg-emerald-50/40",
          files.length >= max && "pointer-events-none opacity-50",
        )}
      >
        <Paperclip className="size-4 text-emerald-700" aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="text-xs text-ink-500">{hint ?? "JPG, PNG, WebP or PDF · up to 10 MB"}</span>
      </label>
      <input id={inputId} ref={ref} type="file" className="sr-only" accept={accept} multiple={multiple} onChange={(e) => onPick(e.target.files)} disabled={files.length >= max} />
      {progress ? (
        <div className="space-y-1" aria-live="polite">
          <p className="text-xs text-ink-600">Uploading {progress.name}… {progress.pct}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-cream-200" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs font-medium text-rose-700" role="alert">{error}</p> : null}
      {files.length ? (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-cream-300">
              {f.mimeType.startsWith("image/") ? <ImageIcon className="size-4 text-sage-500" aria-hidden /> : <FileText className="size-4 text-sage-500" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button
                type="button"
                className="text-ink-400 hover:text-rose-700"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  const next = files.filter((x) => x.id !== f.id);
                  setFiles(next);
                  onChange(next);
                }}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

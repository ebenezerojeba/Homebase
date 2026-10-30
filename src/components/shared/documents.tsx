import { FileText, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { label } from "@/lib/nigeria";

export interface DocRow {
  _id: { toString(): string };
  displayName: string;
  mimeType: string;
  kind: string;
  version: number;
  sizeBytes: number;
  createdAt: Date;
  documentGroupId?: { toString(): string } | null;
}

export function DocumentList({ docs, extra }: { docs: DocRow[]; extra?: (d: DocRow) => React.ReactNode }) {
  if (!docs.length) return <p className="text-sm text-ink-500">No documents yet.</p>;
  // Mark the newest version of each agreement.
  const latest = new Map<string, number>();
  for (const d of docs) {
    const g = d.documentGroupId?.toString();
    if (g) latest.set(g, Math.max(latest.get(g) ?? 0, d.version));
  }
  return (
    <ul className="divide-y divide-cream-200">
      {docs.map((d) => {
        const g = d.documentGroupId?.toString();
        const isLatest = g ? latest.get(g) === d.version : true;
        return (
          <li key={d._id.toString()} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            {d.mimeType.startsWith("image/") ? <ImageIcon className="size-5 text-sage-500" aria-hidden /> : <FileText className="size-5 text-sage-500" aria-hidden />}
            <div className="min-w-0 flex-1">
              <a href={`/api/assets/${d._id}`} target="_blank" rel="noopener" className="font-medium text-ink-900 hover:text-emerald-700 hover:underline">{d.displayName}</a>
              <p className="text-xs text-ink-500">
                {label(d.kind)}
                {g ? ` · version ${d.version}` : ""} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB · uploaded {formatDateTime(d.createdAt)}
              </p>
            </div>
            {g && isLatest && d.kind === "agreement" ? <Badge tone="green">Latest</Badge> : g && d.kind === "agreement" ? <Badge>Superseded</Badge> : null}
            <a href={`/api/assets/${d._id}?download=1`} className="text-xs font-medium text-emerald-700 hover:underline">Download</a>
            {extra?.(d)}
          </li>
        );
      })}
    </ul>
  );
}

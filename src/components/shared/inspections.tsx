import type { IInspection } from "@/server/models";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/dates";
import { label } from "@/lib/nigeria";

export function InspectionView({ ins }: { ins: IInspection }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{label(ins.type)} inspection · {formatDate(ins.inspectedOn)}</span>
        <StatusBadge status={ins.status} />
        <span className="text-ink-500">Tenant response:</span>
        <StatusBadge status={ins.tenantResponse.status === "pending" ? "awaiting_tenant" : ins.tenantResponse.status} />
      </div>
      {ins.summary ? <p className="text-sm text-ink-700">{ins.summary}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {ins.items.map((it) => (
          <li key={it._id.toString()} className="rounded-xl border border-cream-300 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{it.area}</span>
              <span className={`text-xs font-semibold capitalize ${it.condition === "good" ? "text-emerald-700" : it.condition === "fair" ? "text-amber-700" : "text-rose-700"}`}>{it.condition}</span>
            </div>
            {it.notes ? <p className="mt-1 text-ink-600">{it.notes}</p> : null}
            {it.assetIds.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {it.assetIds.map((id) => (
                  <a key={id.toString()} href={`/api/assets/${id}`} target="_blank" rel="noopener" className="block size-16 overflow-hidden rounded-lg bg-cream-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/assets/${id}`} alt={`${it.area} photo`} className="size-full object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {ins.tenantResponse.at ? (
        <p className="text-sm text-ink-600">
          Tenant {ins.tenantResponse.status} on {formatDateTime(ins.tenantResponse.at)}
          {ins.tenantResponse.comment ? `: "${ins.tenantResponse.comment}"` : ""}
        </p>
      ) : null}
    </div>
  );
}

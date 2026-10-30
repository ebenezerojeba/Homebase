import { Wrench } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money, Pagination, Tabs } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { label } from "@/lib/nigeria";
import type { Actor } from "@/server/auth/actor";
import { allowedNextStatuses, getMaintenanceDetail, listMaintenance, maintenanceFilter } from "@/server/services/maintenance";
import { CommentForm, LandlordUpdateForm, TenantConfirm } from "./maintenance-forms";

const PRIORITY_TONE = { low: "neutral", normal: "sage", high: "amber", urgent: "red" } as const;

export async function MaintenanceListPage({ actor, sp }: { actor: Actor; sp: Record<string, string> }) {
  const role = actor.role as "landlord" | "tenant";
  const base = `/${role}/maintenance`;
  const tab = sp.status ?? (sp.open === "false" ? "all" : "open");
  const f = maintenanceFilter.parse({
    status: ["submitted", "acknowledged", "scheduled", "in_progress", "awaiting_tenant", "completed", "cancelled"].includes(sp.status ?? "") ? sp.status : undefined,
    open: tab === "open" ? "true" : undefined,
    page: sp.page || 1,
  });
  const { items, total } = await listMaintenance(actor, f);
  return (
    <>
      <PageHeader title="Maintenance" description={role === "landlord" ? "Repair requests across your properties" : "Report problems and follow progress"} actions={role === "tenant" ? <ButtonLink href={`${base}/new`}>Report a problem</ButtonLink> : null} />
      <Tabs active={tab} items={[{ key: "open", label: "Open", href: `${base}?open=true` }, { key: "submitted", label: "New", href: `${base}?status=submitted` }, { key: "completed", label: "Completed", href: `${base}?status=completed` }, { key: "all", label: "All", href: `${base}?open=false` }]} />
      {items.length === 0 ? (
        <EmptyState icon={<Wrench className="size-6" />} title="No requests here" description={role === "tenant" ? "If something needs fixing, report it with photos so your landlord can act." : "Requests from your tenants will appear here."} action={role === "tenant" ? <ButtonLink href={`${base}/new`}>Report a problem</ButtonLink> : undefined} />
      ) : (
        <Card>
          <ul className="divide-y divide-cream-200">
            {items.map((r) => (
              <li key={r._id.toString()}>
                <Link href={`${base}/${r._id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-cream-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-900">{r.title}</p>
                    <p className="text-xs text-ink-500">{r.propertyId?.name} · {r.unitId?.unitNumber} · {label(r.category)} · updated {formatDateTime(r.lastActivityAt)}</p>
                  </div>
                  <Badge tone={PRIORITY_TONE[r.priority]}>{label(r.priority)}</Badge>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
          <CardBody>
            <Pagination page={f.page} pageSize={f.pageSize} total={total} hrefFor={(p) => `${base}?${new URLSearchParams({ ...sp, page: String(p) })}`} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

export async function MaintenanceDetailPage({ actor, id }: { actor: Actor; id: string }) {
  const role = actor.role as "landlord" | "tenant";
  const d = await getMaintenanceDetail(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const r = d.request;
  const closed = r.status === "cancelled";
  return (
    <>
      <PageHeader
        back={<Link href={`/${role}/maintenance`} className="text-sm text-emerald-700 hover:underline">← Maintenance</Link>}
        title={r.title}
        description={`${label(r.category)} · reported ${formatDateTime(r.createdAt)}${role === "landlord" ? ` by ${d.tenancy.tenantName}` : ""}`}
        actions={<><Badge tone={PRIORITY_TONE[r.priority]}>{label(r.priority)} priority</Badge><StatusBadge status={r.status} /></>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="space-y-4">
              <p className="whitespace-pre-wrap text-sm text-ink-800">{r.description}</p>
              {r.assetIds.length ? (
                <div className="flex flex-wrap gap-2">
                  {r.assetIds.map((a) => (
                    <a key={a.toString()} href={`/api/assets/${a}`} target="_blank" rel="noopener" className="block size-24 overflow-hidden rounded-xl bg-cream-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/assets/${a}`} alt="Reported problem" className="size-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>
          {role === "tenant" && r.status === "completed" && r.tenantConfirmation === "pending" ? <TenantConfirm requestId={id} /> : null}
          <Card>
            <CardHeader title="History" description={role === "landlord" ? "Internal notes are highlighted and never shown to the tenant" : undefined} />
            <CardBody>
              <ol className="space-y-4">
                {d.history.map((h) => (
                  <li key={h._id.toString()} className={cn("rounded-xl p-3 text-sm", h.visibility === "internal" ? "bg-amber-50 ring-1 ring-amber-700/15" : "bg-cream-50")}>
                    <p className="text-xs text-ink-500">
                      {h.authorId?.name ?? "System"} · {formatDateTime(h.createdAt)}
                      {h.visibility === "internal" ? <span className="ml-2 font-semibold text-amber-700">Internal note</span> : null}
                    </p>
                    {h.kind === "status_change" && h.toStatus ? (
                      <p className="mt-1 font-medium text-ink-900">{h.fromStatus ? `${label(h.fromStatus)} → ` : ""}{label(h.toStatus)}</p>
                    ) : null}
                    {h.body ? <p className="mt-1 whitespace-pre-wrap text-ink-800">{h.body}</p> : null}
                    {h.assetIds.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {h.assetIds.map((a) => (
                          <a key={a.toString()} href={`/api/assets/${a}`} target="_blank" rel="noopener" className="block size-16 overflow-hidden rounded-lg bg-cream-200">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/assets/${a}`} alt="Attachment" className="size-full object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
              {!closed ? (
                <div className="mt-6 border-t border-cream-200 pt-5">
                  <CommentForm requestId={id} tenancyId={r.tenancyId.toString()} allowInternal={role === "landlord"} />
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  { label: "Assigned to", value: r.assignedTo ?? "Not assigned yet" },
                  { label: "Expected", value: r.expectedDate ? formatDate(r.expectedDate, "long") : "—" },
                  { label: "Completed", value: r.completedAt ? formatDateTime(r.completedAt) : "—" },
                  ...(r.completionNotes ? [{ label: "Completion notes", value: r.completionNotes }] : []),
                  { label: "Tenant confirmation", value: label(r.tenantConfirmation) },
                  ...(role === "landlord" ? [{ label: "Cost (private)", value: r.costKobo ? <Money kobo={r.costKobo} /> : "—" }, { label: "Expense recorded", value: d.expense ? <Money kobo={d.expense.amountKobo} /> : "No" }] : []),
                ]}
              />
            </CardBody>
          </Card>
          {role === "landlord" ? (
            <Card>
              <CardHeader title="Update" />
              <CardBody>
                <LandlordUpdateForm requestId={id} current={{ status: r.status, allowed: allowedNextStatuses(r.status), priority: r.priority, assignedTo: r.assignedTo ?? null, expectedDate: r.expectedDate ? toISODate(r.expectedDate) : null, costKobo: r.costKobo ?? null, hasExpense: Boolean(d.expense) }} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

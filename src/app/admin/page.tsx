import { Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { requirePageActor } from "@/server/auth/current";
import { adminOverview } from "@/server/services/admin";

export const metadata = { title: "Operations" };

export default async function AdminHome() {
  const actor = await requirePageActor("admin");
  const o = await adminOverview(actor);
  const n = (r: string) => o.users.find((u) => u._id === r)?.n ?? 0;
  return (
    <>
      <PageHeader title="Operations" description="Platform health. Admins can't view tenancy financial records." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Landlords" value={n("landlord")} />
        <Stat label="Tenants" value={n("tenant")} />
        <Stat label="Open data requests" value={o.openRequests} tone={o.openRequests ? "warning" : "default"} hint="Respond within 30 days" />
        <Stat label="Failed emails" value={o.failedEmails} tone={o.failedEmails ? "warning" : "default"} hint="After all retries" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dead jobs" description="Scheduled tasks that exhausted retries" />
          <CardBody>
            {o.deadJobs.length ? (
              <ul className="space-y-2 text-sm">{o.deadJobs.map((j) => <li key={j._id.toString()}><span className="font-mono text-xs">{j.type}</span> · {j.attempts} attempts · {formatDateTime(j.updatedAt)}<span className="block text-xs text-rose-700">{j.lastError}</span></li>)}</ul>
            ) : <p className="text-sm text-ink-500">None.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Failed webhooks" description="Provider will retry; investigate repeated failures" />
          <CardBody>
            {o.failedWebhooks.length ? (
              <ul className="space-y-2 text-sm">{o.failedWebhooks.map((w) => <li key={w._id.toString()}>{w.provider} · {w.eventType} · {w.reference ?? "—"} · {formatDateTime(w.receivedAt)}<span className="block text-xs text-rose-700">{w.lastError}</span></li>)}</ul>
            ) : <p className="text-sm text-ink-500">None.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

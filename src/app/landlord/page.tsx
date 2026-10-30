import { AlertCircle, Building2, ClipboardCheck, Wallet, Wrench } from "lucide-react";
import Link from "next/link";
import { CollectionTrend } from "@/components/charts/collection-trend";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { requirePageActor } from "@/server/auth/current";
import { landlordDashboard } from "@/server/services/reports";

export const metadata = { title: "Overview" };

export default async function LandlordOverview() {
  const actor = await requirePageActor("landlord");
  const d = await landlordDashboard(actor, {});
  const first = actor.name.split(" ")[0];

  if (d.propertyCount === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${first}`} description="Let's set up your first property. It takes about two minutes." />
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="Add your first property"
          description="Add a property and its units, then record a tenancy and invite your tenant. Works just as well for a single flat."
          action={<ButtonLink href="/landlord/properties/new">Add a property</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Good day, ${first}`}
        description={`Year to date · ${formatDate(d.period.from)} – ${formatDate(d.period.to)}`}
        actions={
          <>
            <ButtonLink href="/landlord/payments?record=1" variant="outline">Record a payment</ButtonLink>
            <ButtonLink href="/landlord/tenancies/new">New tenancy</ButtonLink>
          </>
        }
      />

      {d.pendingClaims.count > 0 ? (
        <Link href="/landlord/reconciliation" className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm text-amber-700 transition-colors hover:bg-amber-100">
          <ClipboardCheck className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">
            <strong className="font-semibold">{d.pendingClaims.count} payment{d.pendingClaims.count === 1 ? "" : "s"} awaiting your review</strong> ({formatKobo(d.pendingClaims.totalKobo)}). Check your bank records, then confirm or reject.
          </span>
          <span className="font-semibold">Review →</span>
        </Link>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmed rent collected" value={formatKobo(d.collectedKobo)} hint={`${d.collectedCount} confirmed payment${d.collectedCount === 1 ? "" : "s"} this year`} tone="positive" icon={<Wallet className="size-4" />} />
        <Stat label="Rent expected (billed)" value={formatKobo(d.expectedKobo)} hint="Charges due this year" />
        <Stat label="Outstanding now" value={formatKobo(d.outstandingKobo)} hint={d.overdueKobo ? `${formatKobo(d.overdueKobo)} past grace period` : "Nothing past grace period"} tone={d.overdueKobo ? "danger" : d.outstandingKobo ? "warning" : "default"} icon={<AlertCircle className="size-4" />} />
        <Stat label="Units" value={`${d.units.occupied} / ${d.units.total}`} hint={`${d.units.vacant} vacant${d.units.unavailable ? `, ${d.units.unavailable} unavailable` : ""}`} icon={<Building2 className="size-4" />} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Expenses recorded" value={formatKobo(d.expensesKobo)} hint="Year to date" />
        <Stat label="Deposits held" value={formatKobo(d.depositsHeldKobo)} hint="Not counted as rent income" />
        <Stat label="Open repairs" value={d.openMaintenance} hint={<Link href="/landlord/maintenance?open=true" className="text-emerald-700 hover:underline">View requests</Link>} icon={<Wrench className="size-4" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Rent collected" description="Confirmed payments by month (excludes deposits and pending claims)" />
          <CardBody>
            <CollectionTrend months={d.months} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Due in the next 30 days" action={<Link href="/landlord/payments" className="text-sm font-medium text-emerald-700 hover:underline">All</Link>} />
          <CardBody className="p-0">
            {d.upcoming.length ? (
              <ul className="divide-y divide-cream-200">
                {d.upcoming.map((c) => (
                  <li key={c._id.toString()} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/landlord/tenancies/${c.tenancyId?._id}`} className="block truncate font-medium text-ink-900 hover:underline">{c.tenancyId?.tenantName}</Link>
                      <p className="text-xs text-ink-500">{c.label} · due {formatDate(c.dueDate)}</p>
                    </div>
                    <Money kobo={c.amountKobo - c.allocatedKobo} className="font-semibold" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-ink-500">Nothing due in the next 30 days.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent payment activity" action={<Link href="/landlord/payments" className="text-sm font-medium text-emerald-700 hover:underline">All payments</Link>} />
          <CardBody className="p-0">
            {d.recent.length ? (
              <ul className="divide-y divide-cream-200">
                {d.recent.map((p) => (
                  <li key={p._id.toString()} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{p.tenancyId?.tenantName}</p>
                      <p className="text-xs text-ink-500">{formatDate(p.paidOn)} · {p.method.replace("_", " ")}{p.purpose === "deposit" ? " · deposit" : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Money kobo={p.amountKobo} className="font-semibold" />
                      <StatusBadge status={p.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-ink-500">No payments yet.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tenancies ending soon" description="Next 90 days, not yet renewed" />
          <CardBody className="p-0">
            {d.renewals.length ? (
              <ul className="divide-y divide-cream-200">
                {d.renewals.map((t) => (
                  <li key={t._id.toString()} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <Link href={`/landlord/tenancies/${t._id}`} className="font-medium text-ink-900 hover:underline">{t.tenantName}</Link>
                      <p className="text-xs text-ink-500">{t.unitId?.unitNumber}</p>
                    </div>
                    <span className="text-ink-600">Ends {formatDate(t.endDate)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-ink-500">No tenancies end in the next 90 days.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

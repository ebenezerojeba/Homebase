import { CalendarClock, Home, MessageSquare, Wrench } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/misc";
import { PayOnline, ReportPaymentDialog } from "@/components/tenant/payment-forms";
import { diffDays, formatDate, todayInBusinessTz } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { requirePageActor } from "@/server/auth/current";
import { onlinePaymentsEnabled } from "@/server/providers/payments";
import { conversationForTenancy } from "@/server/services/messaging";
import { tenantDashboard } from "@/server/services/reports";

export const metadata = { title: "Home" };

export default async function TenantHome() {
  const actor = await requirePageActor("tenant");
  const d = await tenantDashboard(actor);
  if (!d.current || !d.balance) {
    return (
      <>
        <PageHeader title={`Welcome, ${actor.name.split(" ")[0]}`} />
        <EmptyState icon={<Home className="size-6" />} title="No tenancy linked yet" description="Ask your landlord to invite you from their account. Open the link in the invitation email to connect your tenancy." />
      </>
    );
  }
  const t = d.current;
  const b = d.balance;
  const today = todayInBusinessTz();
  const convId = await conversationForTenancy(actor, t._id.toString());
  const charges = d.charges.map((c) => ({ id: c._id.toString(), label: `${c.label} due ${formatDate(c.dueDate)}`, dueKobo: c.amountKobo - c.allocatedKobo }));
  const rent = [...t.rentSchedule].sort((a, z) => +z.effectiveFrom - +a.effectiveFrom)[0]!;
  const daysToDue = b.nextDue ? diffDays(b.nextDue.dueDate, today) : null;
  const active = t.status === "active";
  return (
    <>
      <PageHeader title={`Hello, ${actor.name.split(" ")[0]}`} description={`${t.propertyId?.name} · ${t.unitId?.unitNumber}`} />

      {!active ? <Alert tone="info" className="mb-6">This tenancy {t.status === "ended" ? "has ended" : "was ended early"}. Your records remain available.</Alert> : null}

      <Card className="overflow-hidden">
        <div className="grid gap-6 bg-ink-900 p-6 text-white sm:grid-cols-2 sm:p-8">
          <div>
            <p className="text-sm text-ink-300">{b.outstandingKobo > 0 ? "Amount due now" : "Next payment"}</p>
            <p className="tabular mt-1 text-4xl font-extrabold tracking-tight">{formatKobo(b.outstandingKobo > 0 ? b.outstandingKobo : (b.nextDue?.amountDueKobo ?? 0))}</p>
            <p className="mt-2 text-sm text-ink-300">
              {b.overdueKobo > 0
                ? `${formatKobo(b.overdueKobo)} is past the grace period`
                : b.nextDue
                  ? daysToDue !== null && daysToDue > 0
                    ? `${b.nextDue.label} due ${formatDate(b.nextDue.dueDate, "long")} (in ${daysToDue} day${daysToDue === 1 ? "" : "s"})`
                    : `${b.nextDue.label} due ${formatDate(b.nextDue.dueDate, "long")}`
                  : "You're all paid up"}
            </p>
            {b.creditKobo ? <p className="mt-1 text-sm text-ink-300">You have {formatKobo(b.creditKobo)} credit, applied automatically to upcoming charges.</p> : null}
            {b.pendingVerificationKobo ? <p className="mt-1 text-sm text-amber-100">{formatKobo(b.pendingVerificationKobo)} reported and awaiting your landlord&apos;s confirmation.</p> : null}
          </div>
          {active ? (
            <div className="flex flex-col justify-end gap-2 sm:items-end">
              <div className="flex flex-wrap gap-2 [&_button]:bg-emerald-500 [&_button]:text-ink-900 [&_button:hover]:bg-emerald-600">
                <PayOnline tenancyId={t._id.toString()} charges={charges} enabled={onlinePaymentsEnabled()} />
                <ReportPaymentDialog tenancyId={t._id.toString()} charges={charges} />
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Link href="/tenant/tenancy" className="rounded-card border border-cream-300 bg-white p-5 shadow-card hover:shadow-pop">
          <CalendarClock className="size-5 text-emerald-700" aria-hidden />
          <p className="mt-3 text-sm text-ink-500">Rent</p>
          <p className="tabular font-semibold">{formatKobo(rent.amountKobo)} <span className="font-normal text-ink-500">{label(t.frequency).toLowerCase()}</span></p>
          <p className="text-xs text-ink-500">Ends {formatDate(t.endDate)}</p>
        </Link>
        <Link href="/tenant/maintenance" className="rounded-card border border-cream-300 bg-white p-5 shadow-card hover:shadow-pop">
          <Wrench className="size-5 text-emerald-700" aria-hidden />
          <p className="mt-3 text-sm text-ink-500">Repairs</p>
          <p className="font-semibold">{d.openMaintenance} open</p>
          <p className="text-xs text-ink-500">Report a problem</p>
        </Link>
        <Link href={convId ? `/tenant/messages/${convId}` : "/tenant/messages"} className="rounded-card border border-cream-300 bg-white p-5 shadow-card hover:shadow-pop">
          <MessageSquare className="size-5 text-emerald-700" aria-hidden />
          <p className="mt-3 text-sm text-ink-500">Landlord</p>
          <p className="font-semibold">{t.landlordId?.name}</p>
          <p className="text-xs text-ink-500">Send a message</p>
        </Link>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent payments" action={<Link href="/tenant/payments" className="text-sm font-medium text-emerald-700 hover:underline">All payments</Link>} />
        <CardBody className="p-0">
          {d.recentPayments.length ? (
            <ul className="divide-y divide-cream-200">
              {d.recentPayments.map((p) => (
                <li key={p._id.toString()} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <Money kobo={p.amountKobo} className="font-semibold" />
                    <p className="text-xs text-ink-500">{formatDate(p.paidOn)} · {p.method.replace("_", " ")}{p.purpose === "deposit" ? " · deposit" : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={p.status} />
                    {p.receiptId ? <Link href={`/tenant/receipts/${p.receiptId._id}`} className="text-xs font-medium text-emerald-700 hover:underline">Receipt</Link> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-ink-500">No payments yet.</p>
          )}
        </CardBody>
      </Card>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/print/statement/${t._id}`} target="_blank" className={buttonClass("outline", "sm")}>Download statement</Link>
        <ButtonLink href="/tenant/record" variant="ghost" size="sm">View shared tenancy record</ButtonLink>
      </div>
    </>
  );
}

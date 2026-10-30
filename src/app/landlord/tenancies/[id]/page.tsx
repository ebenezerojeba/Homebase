import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Money, Tabs, Table, Td, Th } from "@/components/ui/misc";
import { BalanceCards, ChargesTable, PaymentsTable } from "@/components/shared/ledger";
import { DocumentList } from "@/components/shared/documents";
import { InspectionView } from "@/components/shared/inspections";
import { TimelineView } from "@/components/shared/timeline";
import { InspectionDialog } from "@/components/landlord/inspection-form";
import {
  AdjustChargeDialog,
  ChangeRentDialog,
  EndTenancyDialog,
  GraceDialog,
  InviteButton,
  RecordPaymentDialog,
  RenewDialog,
  ReversePaymentButton,
  UploadAgreement,
} from "@/components/landlord/tenancy-forms";
import { addDays, formatDate, formatDateTime, toISODate, todayInBusinessTz } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { requirePageActor } from "@/server/auth/current";
import { listTenancyDocuments } from "@/server/services/assets";
import { computeBalance, listCharges, reconcileTenancy } from "@/server/services/ledger";
import { conversationForTenancy } from "@/server/services/messaging";
import { listPayments } from "@/server/services/payments";
import { getTimeline, listInspections, timelineQuery } from "@/server/services/records";
import { periodAt } from "@/server/services/schedule";
import { getTenancyDetail } from "@/server/services/tenancy";

const TABS = ["overview", "ledger", "payments", "record", "documents", "inspections", "reconcile"] as const;

export default async function LandlordTenancyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const actor = await requirePageActor("landlord");
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "overview";
  const detail = await getTenancyDetail(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { tenancy: t, property, unit, tenant, invitation } = detail;
  const today = todayInBusinessTz();
  const [balance, charges, convId] = await Promise.all([computeBalance(id), listCharges(actor, id), conversationForTenancy(actor, id)]);
  const openCharges = charges.filter((c) => c.status === "open" || c.status === "partially_paid");
  const currentRent = [...t.rentSchedule].sort((a, b) => +b.effectiveFrom - +a.effectiveFrom)[0]!;
  const lastBilled = periodAt(t, t.generatedThroughIndex);
  const earliestRentChange = toISODate(addDays(lastBilled?.periodStart ?? t.startDate, 1));
  const base = `/landlord/tenancies/${id}`;
  const active = t.status === "active";

  return (
    <>
      <PageHeader
        back={<Link href="/landlord/tenancies" className="text-sm text-emerald-700 hover:underline">← Tenancies</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{t.tenantName} <StatusBadge status={t.status} /></span>}
        description={`${property?.name} · ${unit?.unitNumber} · ${formatDate(t.startDate)} – ${formatDate(t.endDate)}`}
        actions={
          <>
            {convId ? <Link href={`/landlord/messages/${convId}`} className={buttonClass("outline")}>Message</Link> : null}
            <RecordPaymentDialog tenancies={[{ id, label: `${t.tenantName} · ${unit?.unitNumber}` }]} defaultTenancyId={id} openCharges={openCharges.map((c) => ({ id: c._id.toString(), label: `${c.label} due ${formatDate(c.dueDate)} (${formatKobo(c.amountKobo - c.allocatedKobo)} left)` }))} trigger={<button className={buttonClass("primary")}>Record payment</button>} />
          </>
        }
      />

      {!t.tenantId && active ? (
        <Alert tone="info" title="Tenant hasn't joined yet" className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {invitation?.status === "pending" && invitation.expiresAt > new Date()
                ? `Invitation sent to ${t.tenantEmail} on ${formatDateTime(invitation.lastSentAt)}; expires ${formatDateTime(invitation.expiresAt)}.`
                : `No active invitation for ${t.tenantEmail}.`}{" "}
              You can still record payments; they&apos;ll appear for the tenant once they join.
            </span>
            <InviteButton tenancyId={id} resend={invitation?.status === "pending"} tenantName={t.tenantName} />
          </div>
        </Alert>
      ) : null}

      <BalanceCards b={balance} role="landlord" />

      <div className="mt-6">
        <Tabs
          active={tab}
          items={[
            { key: "overview", label: "Terms", href: `${base}?tab=overview` },
            { key: "ledger", label: "Charges", href: `${base}?tab=ledger` },
            { key: "payments", label: "Payments", href: `${base}?tab=payments` },
            { key: "record", label: "Shared record", href: `${base}?tab=record` },
            { key: "documents", label: "Documents", href: `${base}?tab=documents` },
            { key: "inspections", label: "Inspections", href: `${base}?tab=inspections` },
            { key: "reconcile", label: "Reconciliation", href: `${base}?tab=reconcile` },
          ]}
        />
      </div>

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Agreed terms" description={t.termsAcknowledgedAt ? `Tenant confirmed reviewing these terms on ${formatDateTime(t.termsAcknowledgedAt)}` : "Not yet reviewed by the tenant"} />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Current rent", value: <><Money kobo={currentRent.amountKobo} className="font-semibold" /> {label(t.frequency).toLowerCase()}</> },
                  { label: "Next due", value: formatDate(t.nextDueDate) },
                  { label: "Start date", value: formatDate(t.startDate, "long") },
                  { label: "End date", value: formatDate(t.endDate, "long") },
                  { label: "Grace period", value: <span className="flex items-center gap-2">{t.gracePeriodDays} days {active ? <GraceDialog tenancyId={id} grace={t.gracePeriodDays} /> : null}</span> },
                  { label: "Deposit agreed", value: t.depositAmountKobo ? <><Money kobo={t.depositAmountKobo} /> · held <Money kobo={balance.depositHeldKobo} /></> : "None" },
                  { label: "Final short period", value: t.prorateFinalPeriod ? "Prorated by days" : "Charged in full" },
                  { label: "Other charges", value: t.agreedCharges.length ? t.agreedCharges.map((c) => `${c.label}: ${formatKobo(c.amountKobo)} (${c.recurrence === "recurring" ? "each period" : "once"})`).join("; ") : "None" },
                ]}
              />
              {t.notes ? <p className="mt-4 rounded-xl bg-cream-100 p-3 text-sm text-ink-700">{t.notes}</p> : null}
              <h3 className="mt-6 text-sm font-semibold text-ink-900">Rent history</h3>
              <ul className="mt-2 space-y-1 text-sm text-ink-700">
                {t.rentSchedule.map((r) => (
                  <li key={r._id.toString()} className="tabular">
                    From {formatDate(r.effectiveFrom)}: {formatKobo(r.amountKobo)} {r.note ? <span className="text-ink-500">— {r.note}</span> : null} <span className="text-xs text-ink-400">(recorded {formatDateTime(r.recordedAt)})</span>
                  </li>
                ))}
              </ul>
              {t.endReason ? <p className="mt-4 text-sm text-ink-600">Ended: {t.endReason}</p> : null}
              {t.renewedFromId ? <p className="mt-2 text-sm"><Link className="text-emerald-700 hover:underline" href={`/landlord/tenancies/${t.renewedFromId}`}>← Previous tenancy</Link></p> : null}
              {t.renewedToId ? <p className="mt-2 text-sm"><Link className="text-emerald-700 hover:underline" href={`/landlord/tenancies/${t.renewedToId}`}>Renewal →</Link></p> : null}
            </CardBody>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Tenant" />
              <CardBody className="space-y-1 text-sm">
                <p className="font-medium">{tenant?.name ?? t.tenantName}</p>
                <p className="text-ink-600">{tenant?.email ?? t.tenantEmail}</p>
                {tenant?.phone ? <p className="text-ink-600">{tenant.phone}</p> : null}
                <p className="pt-2 text-xs text-ink-500">{tenant ? "Joined and can see this tenancy" : "Not joined yet"}</p>
              </CardBody>
            </Card>
            {active ? (
              <Card>
                <CardHeader title="Change the tenancy" description="Every change is added to the shared record" />
                <CardBody className="flex flex-col items-start gap-2">
                  <ChangeRentDialog tenancyId={id} earliest={earliestRentChange} />
                  {!t.renewedToId ? <RenewDialog tenancyId={id} startDate={toISODate(addDays(t.endDate, 1))} defaults={{ rentAmountKobo: currentRent.amountKobo, frequency: t.frequency, gracePeriodDays: t.gracePeriodDays }} /> : null}
                  <EndTenancyDialog tenancyId={id} defaultEnd={toISODate(today)} />
                  <p className="pt-1 text-xs text-ink-500">To move a tenant to another unit, end this tenancy and create a new one on the other unit.</p>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "ledger" ? (
        <Card>
          <CardHeader
            title="Charges"
            description="Each billing period is a separate charge. Payments are applied to the oldest unpaid charge first."
            action={<a className={buttonClass("outline", "sm")} href={`/api/exports?kind=charges&tenancyId=${id}&from=${toISODate(t.startDate)}&to=${toISODate(addDays(today, 400))}`}>Export CSV</a>}
          />
          <CardBody>
            {charges.length ? (
              <ChargesTable
                charges={charges}
                grace={t.gracePeriodDays}
                today={today}
                actions={(c) =>
                  c.status !== "cancelled" ? (
                    <AdjustChargeDialog chargeId={c._id.toString()} label={`${c.label} due ${formatDate(c.dueDate)}`} adjustments={c.adjustments.map((a) => ({ id: a._id.toString(), amountKobo: a.amountKobo, reason: a.reason }))} />
                  ) : null
                }
              />
            ) : (
              <p className="text-sm text-ink-500">No charges yet. Charges are created up to 45 days before they fall due.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === "payments" ? await paymentsTab(id) : null}

      {tab === "record" ? await recordTab(id, `${base}?tab=record`) : null}

      {tab === "documents" ? (
        <Card>
          <CardHeader title="Tenancy documents" description="Private to you and the tenant. Agreements are versioned; earlier versions are kept." action={<Link href={`/print/statement/${id}`} target="_blank" className={buttonClass("outline", "sm")}>Statement</Link>} />
          <CardBody className="space-y-4">
            {await docsTab(id)}
          </CardBody>
        </Card>
      ) : null}

      {tab === "inspections" ? await inspectionsTab(id) : null}

      {tab === "reconcile" ? await reconcileTab(id) : null}
    </>
  );

  async function paymentsTab(tenancyId: string) {
    const { items } = await listPayments(actor, { tenancyId, page: 1, pageSize: 100 });
    return (
      <Card>
        <CardHeader title="Payments" description="Only confirmed payments count towards the balance." action={<a className={buttonClass("outline", "sm")} href={`/api/exports?kind=payments&tenancyId=${tenancyId}&from=${toISODate(t.startDate)}`}>Export CSV</a>} />
        <CardBody>
          {items.length ? (
            <PaymentsTable payments={items} role="landlord" actions={(p) => (p.status === "confirmed" && p.source !== "provider" ? <ReversePaymentButton paymentId={p._id.toString()} /> : p.status === "pending_verification" ? <Link className="text-sm text-emerald-700 hover:underline" href={`/landlord/reconciliation?focus=${p._id}`}>Review</Link> : null)} />
          ) : (
            <p className="text-sm text-ink-500">No payments recorded yet.</p>
          )}
        </CardBody>
      </Card>
    );
  }

  async function recordTab(tenancyId: string, base: string) {
    const q = timelineQuery.parse({ category: ["all", "payments", "terms", "maintenance", "documents"].includes(sp.category ?? "") ? sp.category : "all", before: sp.before || undefined });
    const r = await getTimeline(actor, tenancyId, q);
    return (
      <Card>
        <CardHeader title="Shared tenancy record" description="A timestamped history both you and your tenant can see." />
        <CardBody>
          <TimelineView events={r.events} basePath={base} category={q.category} hasMore={r.hasMore} nextBefore={r.nextBefore} tenancyId={tenancyId} />
        </CardBody>
      </Card>
    );
  }

  async function docsTab(tenancyId: string) {
    const docs = await listTenancyDocuments(actor, tenancyId);
    const latestAgreement = docs.find((d) => d.kind === "agreement");
    return (
      <>
        <DocumentList docs={docs} />
        <UploadAgreement tenancyId={tenancyId} replacesAssetId={latestAgreement?._id.toString()} />
        <p className="text-xs text-ink-500">Have any tenancy agreement template reviewed by a qualified lawyer. Uploading a document records it; it doesn&apos;t verify its legal validity.</p>
      </>
    );
  }

  async function inspectionsTab(tenancyId: string) {
    const list = await listInspections(actor, tenancyId);
    return (
      <Card>
        <CardHeader title="Inspections" description="Move-in and move-out condition records with dated photos" action={<InspectionDialog tenancyId={tenancyId} />} />
        <CardBody className="space-y-8">
          {list.length ? list.map((ins) => <InspectionView key={ins._id.toString()} ins={ins} />) : <p className="text-sm text-ink-500">No inspections recorded yet.</p>}
        </CardBody>
      </Card>
    );
  }

  async function reconcileTab(tenancyId: string) {
    const r = await reconcileTenancy(actor, tenancyId);
    const issues = Object.values(r.issues).reduce((s, n) => s + n, 0);
    return (
      <Card>
        <CardHeader title="How the balance is calculated" description="Every charge's paid amount re-derived from individual payment allocations." />
        <CardBody className="space-y-4">
          {issues ? (
            <Alert tone="warning" title="Some figures need attention">
              {r.issues.inconsistentCharges} charge(s) and {r.issues.inconsistentPayments} payment(s) don&apos;t match their allocations; {r.issues.confirmedWithoutReceipt} confirmed payment(s) have no receipt. This usually means a write was interrupted — contact support.
            </Alert>
          ) : (
            <Alert tone="success">All charges, allocations and receipts reconcile.</Alert>
          )}
          <DescriptionList items={[
            { label: "Total charged", value: <Money kobo={r.totals.chargedKobo} /> },
            { label: "Applied from payments", value: <Money kobo={r.totals.allocatedKobo} /> },
            { label: "Confirmed rent received", value: <Money kobo={r.totals.confirmedRentKobo} /> },
            { label: "Unapplied credit", value: <Money kobo={r.totals.creditKobo} /> },
          ]} />
          <Table>
            <thead><tr><Th>Charge</Th><Th className="text-right">Original</Th><Th className="text-right">Adjusted</Th><Th>Applied payments</Th><Th className="text-right">Outstanding</Th><Th>Check</Th></tr></thead>
            <tbody>
              {r.charges.map((c) => (
                <tr key={c.chargeId}>
                  <Td>{c.label}<span className="block text-xs text-ink-500">due {formatDate(c.dueDate)}</span></Td>
                  <Td className="text-right"><Money kobo={c.baseAmountKobo} /></Td>
                  <Td className="text-right"><Money kobo={c.amountKobo} /></Td>
                  <Td className="text-xs">
                    {c.allocations.length ? c.allocations.map((a, i) => (
                      <span key={i} className={`block ${a.status === "reversed" ? "text-ink-400 line-through" : ""}`}>{formatKobo(a.amountKobo)} · {a.method?.replace("_", " ")}{a.reference ? ` · ${a.reference}` : ""}</span>
                    )) : "—"}
                  </Td>
                  <Td className="text-right font-medium"><Money kobo={c.status === "cancelled" ? 0 : c.outstandingKobo} /></Td>
                  <Td>{c.consistent ? <span className="text-xs text-emerald-700">✓ matches</span> : <span className="text-xs font-semibold text-rose-700">Mismatch</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    );
  }
}

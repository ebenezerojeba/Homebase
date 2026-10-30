import { CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";
import { SourceBadge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Money, Table, Td, Th } from "@/components/ui/misc";
import { CheckProviderButton, ReviewActions } from "@/components/landlord/review-actions";
import { ReversePaymentButton } from "@/components/landlord/tenancy-forms";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, todayInBusinessTz } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { requirePageActor } from "@/server/auth/current";
import { reconciliationWorkspace } from "@/server/services/payments";

export const metadata = { title: "Payment review" };

const FLAG_TEXT: Record<string, string> = {
  amount_mismatch: "The provider reported a different amount than expected — not credited",
  currency_mismatch: "The provider reported a different currency — not credited",
};

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const actor = await requirePageActor("landlord");
  const { focus } = await searchParams;
  const w = await reconciliationWorkspace(actor);
  const today = todayInBusinessTz();
  return (
    <>
      <PageHeader title="Payment review" description="Confirm what has really arrived. Nothing counts as income until it's confirmed by you or the payment provider." />

      <Card>
        <CardHeader title="Reported by tenants — awaiting your review" description="Compare each one with your bank statement before confirming. A screenshot alone doesn't prove the money arrived." />
        <CardBody>
          {w.claims.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="size-6" />} title="You're all caught up" description="No tenant-reported payments are waiting for review." className="border-0" />
          ) : (
            <ul className="space-y-4">
              {w.claims.map((c) => (
                <li key={c._id.toString()} id={c._id.toString()} className={cn("rounded-2xl border p-4", focus === c._id.toString() ? "border-emerald-600 ring-2 ring-emerald-600/15" : "border-cream-300")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink-900">
                        <Money kobo={c.amountKobo} /> from <Link href={`/landlord/tenancies/${c.tenancyId._id}`} className="text-emerald-700 hover:underline">{c.tenancyId.tenantName}</Link>
                        {c.purpose === "deposit" ? <span className="ml-2 text-sm font-normal text-ink-500">(deposit)</span> : null}
                      </p>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-ink-700 sm:grid-cols-2">
                        <div><dt className="inline text-ink-500">Paid on: </dt><dd className="inline">{formatDate(c.paidOn)}</dd></div>
                        <div><dt className="inline text-ink-500">Method: </dt><dd className="inline capitalize">{c.method.replace("_", " ")}{c.bankName ? ` · ${c.bankName}` : ""}</dd></div>
                        <div><dt className="inline text-ink-500">Reference: </dt><dd className="inline font-mono text-xs">{c.externalReference}</dd></div>
                        <div><dt className="inline text-ink-500">Submitted: </dt><dd className="inline">{formatDateTime(c.submittedAt)}</dd></div>
                      </dl>
                      {c.note ? <p className="mt-2 text-sm text-ink-600">&ldquo;{c.note}&rdquo;</p> : null}
                      {c.proofAssetId ? (
                        <a href={`/api/assets/${c.proofAssetId._id}`} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline">
                          <FileText className="size-4" aria-hidden /> View supporting document
                        </a>
                      ) : null}
                    </div>
                    <ReviewActions paymentId={c._id.toString()} amountLabel={formatKobo(c.amountKobo)} />
                  </div>
                  {c.hints.length ? (
                    <ul className="mt-3 space-y-1">
                      {c.hints.map((h) => (
                        <li key={h} className="flex gap-2 text-xs text-amber-700"><span aria-hidden>•</span>{h}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {w.duplicateReferenceCount ? (
        <Alert tone="warning" className="mt-6" title={`${w.duplicateReferenceCount} reference(s) appear on more than one submission`}>
          This can be a genuine mistake (e.g. resubmitting after a rejection). Check carefully before confirming — the system won&apos;t let the same reference be confirmed twice.
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Online payments awaiting provider confirmation" description="Started checkouts the provider hasn't confirmed yet" />
          <CardBody className="p-0">
            {w.awaitingProvider.length ? (
              <ul className="divide-y divide-cream-200">
                {w.awaitingProvider.map((p) => (
                  <li key={p._id.toString()} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium">{p.tenancyId?.tenantName} · <Money kobo={p.amountKobo} /></p>
                      <p className="text-xs text-ink-500">Started {formatDateTime(p.createdAt)} · <StatusBadge status={p.status} /></p>
                    </div>
                    <CheckProviderButton paymentId={p._id.toString()} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">None.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Needs attention" description="Failed, reversed or flagged payments (last 60 days)" />
          <CardBody className="p-0">
            {w.problem.length ? (
              <ul className="divide-y divide-cream-200">
                {w.problem.map((p) => (
                  <li key={p._id.toString()} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{p.tenancyId?.tenantName} · <Money kobo={p.amountKobo} /></span>
                      <StatusBadge status={p.status} />
                    </div>
                    {p.flags.map((f) => <p key={f} className="mt-1 text-xs text-rose-700">{FLAG_TEXT[f] ?? f}</p>)}
                    {p.reversalReason ? <p className="mt-1 text-xs text-ink-500">{p.reversalReason}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">Nothing needs attention.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recently confirmed" />
        <CardBody>
          {w.recentConfirmed.length ? (
            <Table>
              <thead><tr><Th>Confirmed</Th><Th>Tenant</Th><Th className="text-right">Amount</Th><Th>Via</Th><Th>Receipt</Th><Th /></tr></thead>
              <tbody>
                {w.recentConfirmed.map((p) => (
                  <tr key={p._id.toString()}>
                    <Td>{formatDateTime(p.verifiedAt)}</Td>
                    <Td>{p.tenancyId?.tenantName}</Td>
                    <Td className="text-right"><Money kobo={p.amountKobo} /></Td>
                    <Td><SourceBadge source={p.source} /></Td>
                    <Td>{p.receiptId?.receiptNumber ?? "—"}</Td>
                    <Td className="text-right">{p.source !== "provider" ? <ReversePaymentButton paymentId={p._id.toString()} /> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-ink-500">No confirmed payments yet.</p>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Charges still outstanding" description="Due charges with an unpaid balance after all confirmed payments" />
        <CardBody>
          {w.outstandingCharges.length ? (
            <Table>
              <thead><tr><Th>Due</Th><Th>Tenant</Th><Th>Item</Th><Th className="text-right">Outstanding</Th><Th /></tr></thead>
              <tbody>
                {w.outstandingCharges.map((c) => (
                  <tr key={c._id.toString()}>
                    <Td className={c.dueDate < today ? "text-rose-700" : undefined}>{formatDate(c.dueDate)}</Td>
                    <Td>{c.tenancyId?.tenantName}</Td>
                    <Td>{c.label}</Td>
                    <Td className="text-right font-medium"><Money kobo={c.amountKobo - c.allocatedKobo} /></Td>
                    <Td className="text-right"><Link className="text-sm text-emerald-700 hover:underline" href={`/landlord/tenancies/${c.tenancyId}?tab=ledger`}>Ledger</Link></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-ink-500">No outstanding charges.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}

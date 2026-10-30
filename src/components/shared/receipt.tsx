import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/brand/logo";
import { APP_NAME } from "@/lib/brand";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import type { getReceiptForActor } from "@/server/services/payments";

type Data = Awaited<ReturnType<typeof getReceiptForActor>>;

export function ReceiptDocument({ data }: { data: Data }) {
  const { receipt: r, tenancy, landlord, payment } = data;
  return (
    <article className="print-card mx-auto max-w-2xl rounded-3xl border border-cream-300 bg-white p-6 shadow-card sm:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-cream-200 pb-6">
        <div>
          <Logo size="sm" />
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payment receipt</h1>
          <p className="mt-1 font-mono text-sm text-ink-600">{r.receiptNumber}</p>
        </div>
        {r.status === "voided" ? <Badge tone="red">VOIDED</Badge> : <Badge tone="green">Confirmed payment</Badge>}
      </header>
      {r.status === "voided" ? (
        <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">This receipt was voided on {formatDateTime(r.voidedAt)}: {r.voidReason}. The payment no longer counts towards the balance.</p>
      ) : null}
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs uppercase tracking-wide text-ink-500">Received from</dt><dd className="mt-1 font-medium">{tenancy?.tenantName}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-ink-500">Paid to</dt><dd className="mt-1 font-medium">{landlord?.name}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-ink-500">Property</dt><dd className="mt-1">{tenancy?.propertyId?.name}, {tenancy?.unitId?.unitNumber}<span className="block text-ink-500">{tenancy?.propertyId?.address.line1}, {tenancy?.propertyId?.address.city}, {tenancy?.propertyId?.address.state}</span></dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-ink-500">Payment</dt><dd className="mt-1">{label(r.method)} on {formatDate(r.paidOn, "long")}{payment?.externalReference || payment?.providerReference ? <span className="block font-mono text-xs text-ink-500">Ref {payment.externalReference ?? payment.providerReference}</span> : null}</dd></div>
      </dl>
      <table className="mt-8 w-full text-sm">
        <thead><tr className="border-b border-cream-200 text-left text-xs uppercase tracking-wide text-ink-500"><th className="py-2 font-medium">Applied to</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
        <tbody>
          {r.purpose === "deposit" ? (
            <tr className="border-b border-cream-100"><td className="py-2">Security deposit</td><td className="tabular py-2 text-right">{formatKobo(r.amountKobo)}</td></tr>
          ) : (
            r.lines.map((l, i) => (
              <tr key={i} className="border-b border-cream-100">
                <td className="py-2">{l.label} · {formatDate(l.periodStart)} – {formatDate(l.periodEnd)}</td>
                <td className="tabular py-2 text-right">{formatKobo(l.amountKobo)}</td>
              </tr>
            ))
          )}
          {r.creditKobo > 0 ? <tr className="border-b border-cream-100"><td className="py-2">Held as credit towards future charges</td><td className="tabular py-2 text-right">{formatKobo(r.creditKobo)}</td></tr> : null}
        </tbody>
        <tfoot><tr><td className="pt-4 font-semibold">Total received</td><td className="tabular pt-4 text-right text-xl font-semibold">{formatKobo(r.amountKobo)}</td></tr></tfoot>
      </table>
      <footer className="mt-8 border-t border-cream-200 pt-4 text-xs text-ink-500">
        <p>
          Issued {formatDateTime(r.issuedAt)} WAT. Payment confirmed by {r.confirmedBy === "provider" ? "the online payment provider" : `the landlord${payment?.verifiedBy?.name ? ` (${payment.verifiedBy.name})` : ""}`}.
        </p>
        <p className="mt-1">Amounts in Nigerian naira (NGN). This receipt is generated from the {APP_NAME} ledger and can be verified by the receipt number.</p>
      </footer>
    </article>
  );
}

import { notFound } from "next/navigation";
import { PrintButton } from "@/components/shared/print-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Logo } from "@/components/brand/logo";
import { addDays, formatDate, formatDateTime, isValidISODate, parseISODate, toISODate, todayInBusinessTz } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatKobo } from "@/lib/money";
import { requirePageActor } from "@/server/auth/current";
import { buildStatement } from "@/server/services/ledger";
import { Property, Unit } from "@/server/models";

export const metadata = { title: "Statement" };

export default async function StatementPage({ params, searchParams }: { params: Promise<{ tenancyId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requirePageActor("landlord", "tenant");
  const { tenancyId } = await params;
  const sp = await searchParams;
  const today = todayInBusinessTz();
  const to = sp.to && isValidISODate(sp.to) ? parseISODate(sp.to) : today;
  const from = sp.from && isValidISODate(sp.from) ? parseISODate(sp.from) : addDays(to, -365);
  const s = await buildStatement(actor, tenancyId, from, to).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [property, unit] = await Promise.all([Property.findById(s.tenancy.propertyId).select("name address").lean(), Unit.findById(s.tenancy.unitId).select("unitNumber").lean()]);
  const exportHref = `/api/exports?kind=statement&tenancyId=${tenancyId}&from=${toISODate(from)}&to=${toISODate(to)}`;
  return (
    <div className="space-y-6">
      <form className="no-print flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">From</span><Input type="date" name="from" defaultValue={toISODate(from)} className="w-44" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">To</span><Input type="date" name="to" defaultValue={toISODate(to)} className="w-44" /></label>
        <Button type="submit" variant="outline">Update</Button>
        <a href={exportHref} className="text-sm font-medium text-emerald-700 hover:underline">Download CSV</a>
        <span className="flex-1" />
        <PrintButton />
      </form>
      <article className="print-card rounded-3xl border border-cream-300 bg-white p-6 sm:p-10">
        <header className="border-b border-cream-200 pb-5">
          <Logo size="sm" />
          <h1 className="mt-1 text-2xl font-semibold">Tenancy statement</h1>
          <p className="mt-2 text-sm text-ink-700">{s.tenancy.tenantName} · {property?.name}, {unit?.unitNumber}</p>
          <p className="text-sm text-ink-500">{formatDate(from, "long")} – {formatDate(to, "long")} · generated {formatDateTime(new Date())} WAT</p>
        </header>
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Description</th><th className="py-2 text-right font-medium">Charges</th><th className="py-2 text-right font-medium">Payments / credits</th><th className="py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-cream-100 bg-cream-50"><td className="py-2" colSpan={4}>Opening balance</td><td className="tabular py-2 text-right font-medium">{formatKobo(s.openingBalanceKobo)}</td></tr>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-b border-cream-100 align-top">
                <td className="whitespace-nowrap py-2 pr-3">{formatDate(l.date)}</td>
                <td className="py-2 pr-3">{l.description}{l.reference ? <span className="block font-mono text-xs text-ink-500">Ref {l.reference}</span> : null}{l.recordedBy ? <span className="block text-xs text-ink-500">Confirmed by {l.recordedBy}</span> : null}</td>
                <td className="tabular py-2 text-right">{l.debitKobo ? formatKobo(l.debitKobo) : ""}</td>
                <td className="tabular py-2 text-right">{l.creditKobo ? formatKobo(l.creditKobo) : ""}</td>
                <td className="tabular py-2 text-right">{formatKobo(l.balanceKobo)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4} className="pt-4 font-semibold">Closing balance {s.closingBalanceKobo < 0 ? "(in credit)" : ""}</td><td className="tabular pt-4 text-right text-lg font-semibold">{formatKobo(s.closingBalanceKobo)}</td></tr>
          </tfoot>
        </table>
        {s.pendingClaims.length ? (
          <div className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <p className="font-semibold">Reported payments awaiting landlord confirmation (not included above)</p>
            <ul className="mt-1">{s.pendingClaims.map((p, i) => <li key={i} className="tabular">{formatDate(p.date)} · {formatKobo(p.amountKobo)}{p.reference ? ` · ref ${p.reference}` : ""}</li>)}</ul>
          </div>
        ) : null}
        <p className="mt-6 text-xs text-ink-500">A positive balance means money owed; negative means credit. Only confirmed payments are included. Balance includes charges billed up to the end date, including those not yet due.</p>
      </article>
    </div>
  );
}

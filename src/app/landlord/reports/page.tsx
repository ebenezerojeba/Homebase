import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { FilterBar, Money, Table, Td, Th } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { CollectionTrend } from "@/components/charts/collection-trend";
import { ExpenseDialog, VoidExpenseButton } from "@/components/landlord/expense-forms";
import { formatDate, isValidISODate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { requirePageActor } from "@/server/auth/current";
import { listProperties } from "@/server/services/properties";
import { listExpenses } from "@/server/services/records";
import { landlordDashboard, propertySummaries } from "@/server/services/reports";

export const metadata = { title: "Financial reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requirePageActor("landlord");
  const sp = await searchParams;
  const q = {
    from: sp.from && isValidISODate(sp.from) ? sp.from : undefined,
    to: sp.to && isValidISODate(sp.to) ? sp.to : undefined,
    propertyId: /^[a-f0-9]{24}$/.test(sp.propertyId ?? "") ? sp.propertyId : undefined,
  };
  const [d, summaries, properties, expenses] = await Promise.all([
    landlordDashboard(actor, q),
    propertySummaries(actor, q),
    listProperties(actor),
    listExpenses(actor, { propertyId: q.propertyId, from: q.from, to: q.to, page: 1, pageSize: 50 }),
  ]);
  const range = new URLSearchParams({ from: d.period.from, to: d.period.to, ...(q.propertyId ? { propertyId: q.propertyId } : {}) });
  return (
    <>
      <PageHeader title="Financial reports" description={`${formatDate(d.period.from, "long")} – ${formatDate(d.period.to, "long")}`} actions={<ExpenseDialog properties={properties.map((p) => ({ id: p._id.toString(), name: p.name }))} />} />
      <FilterBar>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">From</span><Input type="date" name="from" defaultValue={d.period.from} className="w-40" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">To</span><Input type="date" name="to" defaultValue={d.period.to} className="w-40" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">Property</span>
          <Select name="propertyId" defaultValue={q.propertyId ?? ""} className="w-48">
            <option value="">All properties</option>
            {properties.map((p) => <option key={p._id.toString()} value={p._id.toString()}>{p.name}</option>)}
          </Select>
        </label>
        <Button type="submit" variant="outline">Apply</Button>
      </FilterBar>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rent expected (billed)" value={formatKobo(d.expectedKobo)} hint="Charges falling due in this period" />
        <Stat label="Confirmed rent received" value={formatKobo(d.collectedKobo)} tone="positive" hint="Only confirmed payments, by payment date" />
        <Stat label="Expenses recorded" value={formatKobo(d.expensesKobo)} hint="Voided expenses excluded" />
        <Stat label="Net (received − expenses)" value={formatKobo(d.collectedKobo - d.expensesKobo)} tone={d.collectedKobo - d.expensesKobo >= 0 ? "default" : "danger"} hint={`Outstanding today: ${formatKobo(d.outstandingKobo)} · deposits held: ${formatKobo(d.depositsHeldKobo)}`} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Exports" description="CSV files open in Excel or Google Sheets. They contain the same records you can see here." />
        <CardBody className="flex flex-wrap gap-2">
          <a className={buttonClass("outline", "sm")} href={`/api/exports?kind=payments&${range}`}>Payments</a>
          <a className={buttonClass("outline", "sm")} href={`/api/exports?kind=charges&${range}`}>Charges (ledger)</a>
          <a className={buttonClass("outline", "sm")} href={`/api/exports?kind=receipts&${range}`}>Receipts</a>
          <a className={buttonClass("outline", "sm")} href={`/api/exports?kind=expenses&${range}`}>Expenses</a>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="By property" />
        <CardBody>
          <Table>
            <thead><tr><Th>Property</Th><Th>Occupancy</Th><Th className="text-right">Expected</Th><Th className="text-right">Received</Th><Th className="text-right">Outstanding now</Th><Th className="text-right">Expenses</Th><Th className="text-right">Net</Th></tr></thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.propertyId}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{s.occupied}/{s.units}</Td>
                  <Td className="text-right"><Money kobo={s.expectedKobo} /></Td>
                  <Td className="text-right"><Money kobo={s.collectedKobo} /></Td>
                  <Td className="text-right"><Money kobo={s.outstandingKobo} /></Td>
                  <Td className="text-right"><Money kobo={s.expensesKobo} /></Td>
                  <Td className="text-right font-medium"><Money kobo={s.netKobo} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Monthly rent collected" description="Last 12 months" />
        <CardBody><CollectionTrend months={d.months} /></CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Expenses" />
        <CardBody>
          {expenses.items.length ? (
            <Table>
              <thead><tr><Th>Date</Th><Th>Property</Th><Th>Category</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {expenses.items.map((e) => (
                  <tr key={e._id.toString()} className={e.status === "voided" ? "opacity-60" : undefined}>
                    <Td>{formatDate(e.incurredOn)}</Td>
                    <Td>{e.propertyId?.name}</Td>
                    <Td>{label(e.category)}</Td>
                    <Td>{e.description}{e.vendor ? <span className="block text-xs text-ink-500">{e.vendor}</span> : null}{e.voidReason ? <span className="block text-xs text-rose-700">Voided: {e.voidReason}</span> : null}</Td>
                    <Td className="text-right"><Money kobo={e.amountKobo} /></Td>
                    <Td><StatusBadge status={e.status} /></Td>
                    <Td className="text-right">{e.status === "recorded" ? <VoidExpenseButton id={e._id.toString()} /> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-ink-500">No expenses in this period.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}

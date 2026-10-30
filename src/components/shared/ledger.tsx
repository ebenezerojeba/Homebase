import Link from "next/link";
import type { ReactNode } from "react";
import type { IRentCharge } from "@/server/models";
import { SourceBadge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { Money, Table, Td, Th } from "@/components/ui/misc";
import { addDays, formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import type { BalanceSummary } from "@/server/services/ledger";

export function chargeDisplayStatus(c: Pick<IRentCharge, "status" | "dueDate">, grace: number, today: Date) {
  if ((c.status === "open" || c.status === "partially_paid") && addDays(c.dueDate, grace) < today) return "overdue";
  return c.status;
}

export function BalanceCards({ b, role }: { b: BalanceSummary; role: "landlord" | "tenant" }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label={role === "tenant" ? "You owe now" : "Outstanding now"} value={formatKobo(b.outstandingKobo)} tone={b.overdueKobo ? "danger" : b.outstandingKobo ? "warning" : "positive"} hint={b.overdueKobo ? `${formatKobo(b.overdueKobo)} past the grace period` : b.outstandingKobo ? "Within the grace period" : "Nothing due right now"} />
      <Stat label="Next due" value={b.nextDue ? formatDate(b.nextDue.dueDate) : "—"} hint={b.nextDue ? `${formatKobo(b.nextDue.amountDueKobo)} · ${b.nextDue.label}` : "No upcoming charges"} />
      <Stat label="Confirmed rent paid" value={formatKobo(b.confirmedPaidKobo)} tone="positive" hint={b.creditKobo ? `${formatKobo(b.creditKobo)} held as credit` : "All tenancy to date"} />
      <Stat label="Awaiting confirmation" value={formatKobo(b.pendingVerificationKobo)} hint={b.depositHeldKobo ? `Deposit held: ${formatKobo(b.depositHeldKobo)}` : "Not counted until confirmed"} />
    </div>
  );
}

export function ChargesTable({ charges, grace, today, actions }: { charges: IRentCharge[]; grace: number; today: Date; actions?: (c: IRentCharge) => ReactNode }) {
  return (
    <Table>
      <thead>
        <tr><Th>Due</Th><Th>Item</Th><Th>Period</Th><Th className="text-right">Amount</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th>{actions ? <Th /> : null}</tr>
      </thead>
      <tbody>
        {charges.map((c) => (
          <tr key={c._id.toString()} className={c.status === "cancelled" ? "opacity-60" : undefined}>
            <Td className="whitespace-nowrap">{formatDate(c.dueDate)}</Td>
            <Td>
              {c.label}
              {c.adjustments.length ? (
                <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
                  {c.adjustments.map((a) => (
                    <li key={a._id.toString()}>
                      {a.amountKobo < 0 ? "−" : "+"}
                      {formatKobo(Math.abs(a.amountKobo))}: {a.reason} ({formatDate(a.createdAt)})
                    </li>
                  ))}
                </ul>
              ) : null}
            </Td>
            <Td className="whitespace-nowrap text-xs text-ink-600">{formatDate(c.periodStart)} – {formatDate(c.periodEnd)}</Td>
            <Td className="text-right">
              <Money kobo={c.amountKobo} />
              {c.amountKobo !== c.baseAmountKobo ? <span className="block text-xs text-ink-500 line-through">{formatKobo(c.baseAmountKobo)}</span> : null}
            </Td>
            <Td className="text-right"><Money kobo={c.allocatedKobo} /></Td>
            <Td className="text-right font-medium"><Money kobo={c.status === "cancelled" ? 0 : c.amountKobo - c.allocatedKobo} /></Td>
            <Td><StatusBadge status={chargeDisplayStatus(c, grace, today)} /></Td>
            {actions ? <Td className="text-right">{actions(c)}</Td> : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export interface PaymentRow {
  _id: { toString(): string };
  paidOn: Date;
  amountKobo: number;
  method: string;
  purpose: string;
  source: string;
  status: string;
  externalReference?: string | null;
  providerReference?: string | null;
  rejectionReason?: string | null;
  reversalReason?: string | null;
  unallocatedKobo: number;
  verifiedAt?: Date | null;
  verifiedBy?: { name: string } | null;
  receiptId?: { _id: { toString(): string }; receiptNumber: string; status?: string } | null;
  tenancyId?: { tenantName: string; _id?: { toString(): string } } | null;
}

export function PaymentsTable({ payments, role, actions, showTenant }: { payments: PaymentRow[]; role: "landlord" | "tenant"; actions?: (p: PaymentRow) => ReactNode; showTenant?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Paid on</Th>
          {showTenant ? <Th>Tenant</Th> : null}
          <Th className="text-right">Amount</Th>
          <Th>Method</Th>
          <Th>Recorded via</Th>
          <Th>Status</Th>
          <Th>Receipt</Th>
          {actions ? <Th /> : null}
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p._id.toString()}>
            <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
            {showTenant ? <Td>{p.tenancyId?.tenantName}</Td> : null}
            <Td className="text-right">
              <Money kobo={p.amountKobo} className="font-medium" />
              {p.purpose === "deposit" ? <span className="block text-xs text-ink-500">deposit</span> : null}
              {p.status === "confirmed" && p.unallocatedKobo > 0 ? <span className="block text-xs text-sky-700">{formatKobo(p.unallocatedKobo)} credit</span> : null}
            </Td>
            <Td className="capitalize">
              {p.method.replace("_", " ")}
              {p.externalReference || p.providerReference ? <span className="block max-w-40 truncate text-xs normal-case text-ink-500" title={p.externalReference ?? p.providerReference ?? ""}>Ref {p.externalReference ?? p.providerReference}</span> : null}
            </Td>
            <Td><SourceBadge source={p.source} /></Td>
            <Td>
              <StatusBadge status={p.status} />
              {p.status === "confirmed" && p.verifiedAt ? <span className="mt-0.5 block text-xs text-ink-500">by {p.verifiedBy?.name ?? (p.source === "provider" ? "provider" : "landlord")} · {formatDate(p.verifiedAt)}</span> : null}
              {p.rejectionReason ? <span className="mt-0.5 block max-w-56 text-xs text-rose-700">{p.rejectionReason}</span> : null}
              {p.reversalReason && (p.status === "reversed" || p.status === "refunded") ? <span className="mt-0.5 block max-w-56 text-xs text-rose-700">{p.reversalReason}</span> : null}
            </Td>
            <Td>
              {p.receiptId ? (
                <Link href={`/${role}/receipts/${p.receiptId._id}`} className="text-emerald-700 hover:underline">
                  {p.receiptId.receiptNumber}
                  {p.receiptId.status === "voided" ? " (voided)" : ""}
                </Link>
              ) : (
                <span className="text-ink-400">—</span>
              )}
            </Td>
            {actions ? <Td className="text-right">{actions(p)}</Td> : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

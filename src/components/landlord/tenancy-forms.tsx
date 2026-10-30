"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormError, Input, MoneyInput, Select, Textarea } from "@/components/ui/form";
import { FileUpload } from "@/components/ui/file-upload";
import { api, useAction } from "@/lib/api-client";
import { formatKobo } from "@/lib/money";

const FREQS = [
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["half_yearly", "Half-yearly"],
  ["annual", "Annual"],
] as const;

type Charge = { label: string; amountKobo: number | null; recurrence: "recurring" | "once" };

export function TenancyForm({ units, defaultUnitId, today }: { units: { id: string; label: string }[]; defaultUnitId?: string; today: string }) {
  const router = useRouter();
  const [rent, setRent] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<number | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const a = useAction((body: unknown) => api<{ tenancyId: string }>("/api/tenancies", { body }), {
    success: "Tenancy created",
    onSuccess: (r) => router.push(`/landlord/tenancies/${r.tenancyId}`),
  });
  const fe = a.fieldErrors;
  if (units.length === 0) return <Alert tone="info" title="No vacant units">Add a unit to a property (or end the current tenancy on a unit) before creating a tenancy.</Alert>;
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void a.run({
          unitId: fd.get("unitId"),
          tenantName: String(fd.get("tenantName") ?? "").trim(),
          tenantEmail: String(fd.get("tenantEmail") ?? "").trim(),
          startDate: fd.get("startDate"),
          endDate: fd.get("endDate"),
          frequency: fd.get("frequency"),
          rentAmountKobo: rent,
          gracePeriodDays: Number(fd.get("gracePeriodDays") || 0),
          depositAmountKobo: deposit ?? 0,
          agreedCharges: charges.filter((c) => c.label && c.amountKobo).map((c) => ({ ...c })),
          prorateFinalPeriod: fd.get("prorate") === "on",
          notes: String(fd.get("notes") ?? "").trim() || undefined,
          sendInvite: fd.get("sendInvite") === "on",
        });
      }}
    >
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Unit and tenant</h2>
        <Field label="Unit" error={fe.unitId} required>
          {(p) => (
            <Select {...p} name="unitId" defaultValue={defaultUnitId ?? units[0]?.id}>
              {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tenant's full name" error={fe.tenantName} required>{(p) => <Input {...p} name="tenantName" />}</Field>
          <Field label="Tenant's email" hint="We'll send the invitation here" error={fe.tenantEmail} required>{(p) => <Input {...p} name="tenantEmail" type="email" />}</Field>
        </div>
      </section>
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Agreed terms</h2>
        <p className="text-sm text-ink-600">Record what you and the tenant agreed. The tenant reviews these before joining, and they can&apos;t be silently changed later.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" error={fe.startDate} required>{(p) => <Input {...p} name="startDate" type="date" defaultValue={today} />}</Field>
          <Field label="End date" error={fe.endDate} required>{(p) => <Input {...p} name="endDate" type="date" />}</Field>
          <Field label="Rent amount" error={fe.rentAmountKobo} required>{(p) => <MoneyInput {...p} valueKobo={rent} onChangeKobo={setRent} />}</Field>
          <Field label="Paid" error={fe.frequency} required>
            {(p) => (
              <Select {...p} name="frequency" defaultValue="annual">
                {FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Grace period (days)" hint="Days after the due date before rent counts as overdue" error={fe.gracePeriodDays}>{(p) => <Input {...p} name="gracePeriodDays" type="number" min={0} max={90} defaultValue={0} />}</Field>
          <Field label="Caution / security deposit" hint="Tracked separately from rent" error={fe.depositAmountKobo}>{(p) => <MoneyInput {...p} valueKobo={deposit} onChangeKobo={setDeposit} />}</Field>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-800">Other agreed charges (optional)</p>
          {charges.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_9rem_8rem_auto] items-center gap-2">
              <Input aria-label="Charge name" placeholder="e.g. Service charge" value={c.label} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <MoneyInput aria-label="Charge amount" valueKobo={c.amountKobo} onChangeKobo={(k) => setCharges(charges.map((x, j) => (j === i ? { ...x, amountKobo: k } : x)))} />
              <Select aria-label="How often" value={c.recurrence} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, recurrence: e.target.value as Charge["recurrence"] } : x)))}>
                <option value="recurring">Each period</option>
                <option value="once">Once</option>
              </Select>
              <button type="button" className="rounded-lg p-2 text-ink-400 hover:text-rose-700" aria-label="Remove charge" onClick={() => setCharges(charges.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          {charges.length < 10 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setCharges([...charges, { label: "", amountKobo: null, recurrence: "recurring" }])}>
              <Plus className="size-4" aria-hidden /> Add a charge
            </Button>
          ) : null}
        </div>
        <Checkbox name="prorate" label="Prorate a final short period" description="If the end date cuts a billing period short, charge only for the days covered. Otherwise the full period amount applies." />
        <Field label="Notes (optional)" error={fe.notes}>{(p) => <Textarea {...p} name="notes" placeholder="Anything else you agreed" />}</Field>
      </section>
      <Checkbox name="sendInvite" defaultChecked label="Email the tenant an invitation now" description="They'll be able to review these terms, pay, get receipts and report repairs. The link expires in 7 days." />
      <FormError message={a.error} />
      <Button type="submit" size="lg" loading={a.pending}>Create tenancy</Button>
    </form>
  );
}

export function InviteButton({ tenancyId, resend }: { tenancyId: string; resend?: boolean }) {
  const a = useAction(() => api(`/api/tenancies/${tenancyId}/invite`, { method: "POST" }), { success: "Invitation sent" });
  return (
    <>
      <Button variant={resend ? "outline" : "primary"} loading={a.pending} onClick={() => a.run()}>
        {resend ? "Resend invitation" : "Invite tenant"}
      </Button>
      {a.error ? <span className="text-xs text-rose-700" role="alert">{a.error}</span> : null}
    </>
  );
}

export function RecordPaymentDialog({ tenancies, defaultTenancyId, openCharges, trigger, defaultOpen }: { tenancies: { id: string; label: string }[]; defaultTenancyId?: string; openCharges?: { id: string; label: string }[]; trigger: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [amount, setAmount] = useState<number | null>(null);
  const a = useAction((body: unknown) => api("/api/payments", { body }), { success: "Payment recorded and receipt issued", onSuccess: () => setOpen(false) });
  const fe = a.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title="Record a payment you received" description="For cash, transfers or POS payments you've already confirmed in your own records. A receipt is issued immediately and the tenant is notified.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const chargeId = String(fd.get("chargeId") ?? "");
          void a.run({
            tenancyId: fd.get("tenancyId"),
            purpose: fd.get("purpose"),
            amountKobo: amount,
            paidOn: fd.get("paidOn"),
            method: fd.get("method"),
            reference: String(fd.get("reference") ?? "").trim() || undefined,
            chargeIds: chargeId ? [chargeId] : [],
            note: String(fd.get("note") ?? "").trim() || undefined,
          });
        }}
      >
        <Field label="Tenancy" error={fe.tenancyId} required>
          {(p) => (
            <Select {...p} name="tenancyId" defaultValue={defaultTenancyId}>
              {tenancies.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" error={fe.amountKobo} required>{(p) => <MoneyInput {...p} valueKobo={amount} onChangeKobo={setAmount} />}</Field>
          <Field label="Date received" error={fe.paidOn} required>{(p) => <Input {...p} name="paidOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />}</Field>
          <Field label="Method" error={fe.method}>
            {(p) => (
              <Select {...p} name="method" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="pos">POS</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </Select>
            )}
          </Field>
          <Field label="This is for" error={fe.purpose}>
            {(p) => (
              <Select {...p} name="purpose" defaultValue="rent">
                <option value="rent">Rent and charges</option>
                <option value="deposit">Security deposit</option>
              </Select>
            )}
          </Field>
        </div>
        {openCharges?.length ? (
          <Field label="Apply to first (optional)" hint="Otherwise the oldest unpaid charge is settled first" error={fe.chargeIds}>
            {(p) => (
              <Select {...p} name="chargeId" defaultValue="">
                <option value="">Oldest unpaid first</option>
                {openCharges.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Reference (optional)" hint="Transfer reference or receipt number" error={fe.reference}>{(p) => <Input {...p} name="reference" />}</Field>
        <Field label="Note (optional)" error={fe.note}>{(p) => <Input {...p} name="note" />}</Field>
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Record payment {amount ? `of ${formatKobo(amount)}` : ""}</Button>
      </form>
    </Dialog>
  );
}

export function ChangeRentDialog({ tenancyId, earliest }: { tenancyId: string; earliest: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const a = useAction((body: unknown) => api(`/api/tenancies/${tenancyId}/rent`, { body }), { success: "Rent change recorded", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="outline">Change future rent</Button>} title="Record a rent change" description="Applies only to billing periods starting on or after the effective date. Charges already billed and their payments are never changed.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run({ amountKobo: amount, effectiveFrom: fd.get("effectiveFrom"), note: String(fd.get("note") ?? "").trim() || undefined });
        }}
      >
        <Field label="New rent per period" error={a.fieldErrors.amountKobo} required>{(p) => <MoneyInput {...p} valueKobo={amount} onChangeKobo={setAmount} />}</Field>
        <Field label="Effective from" hint={`Must be after ${earliest}`} error={a.fieldErrors.effectiveFrom} required>{(p) => <Input {...p} name="effectiveFrom" type="date" min={earliest} />}</Field>
        <Field label="Reason / note" error={a.fieldErrors.note}>{(p) => <Input {...p} name="note" placeholder="e.g. Agreed annual review" />}</Field>
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Record change</Button>
      </form>
    </Dialog>
  );
}

export function EndTenancyDialog({ tenancyId, defaultEnd }: { tenancyId: string; defaultEnd: string }) {
  const [open, setOpen] = useState(false);
  const a = useAction((body: unknown) => api(`/api/tenancies/${tenancyId}/end`, { body }), { success: "Tenancy ended", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="ghost">End tenancy</Button>} title="End this tenancy" description="Unpaid charges for periods after the end date are cancelled. Anything already paid or part-paid stays on the record. The unit becomes vacant.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run({ endDate: fd.get("endDate"), kind: fd.get("kind"), reason: String(fd.get("reason") ?? "").trim() });
        }}
      >
        <Field label="End date" error={a.fieldErrors.endDate} required>{(p) => <Input {...p} name="endDate" type="date" defaultValue={defaultEnd} />}</Field>
        <Field label="Type" error={a.fieldErrors.kind}>
          {(p) => (
            <Select {...p} name="kind" defaultValue="ended">
              <option value="ended">Ended as agreed / tenant moved out</option>
              <option value="terminated">Ended early</option>
            </Select>
          )}
        </Field>
        <Field label="Reason" error={a.fieldErrors.reason} required>{(p) => <Textarea {...p} name="reason" placeholder="Recorded on the shared tenancy record" />}</Field>
        <FormError message={a.error} />
        <Button type="submit" variant="danger" loading={a.pending}>End tenancy</Button>
      </form>
    </Dialog>
  );
}

export function RenewDialog({ tenancyId, startDate, defaults }: { tenancyId: string; startDate: string; defaults: { rentAmountKobo: number; frequency: string; gracePeriodDays: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rent, setRent] = useState<number | null>(defaults.rentAmountKobo);
  const a = useAction((body: unknown) => api<{ tenancyId: string }>(`/api/tenancies/${tenancyId}/renew`, { body }), {
    success: "Renewal recorded",
    onSuccess: (r) => router.push(`/landlord/tenancies/${r.tenancyId}`),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="outline">Record renewal</Button>} title="Record a renewal" description={`The renewal starts on ${startDate}, the day after the current tenancy ends. Both tenancies stay on record, linked.`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run({ endDate: fd.get("endDate"), rentAmountKobo: rent, frequency: fd.get("frequency"), gracePeriodDays: Number(fd.get("gracePeriodDays") || 0), agreedCharges: [] });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New end date" error={a.fieldErrors.endDate} required>{(p) => <Input {...p} name="endDate" type="date" min={startDate} />}</Field>
          <Field label="Rent per period" error={a.fieldErrors.rentAmountKobo} required>{(p) => <MoneyInput {...p} valueKobo={rent} onChangeKobo={setRent} />}</Field>
          <Field label="Paid" error={a.fieldErrors.frequency}>
            {(p) => (
              <Select {...p} name="frequency" defaultValue={defaults.frequency}>
                {FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Grace period (days)" error={a.fieldErrors.gracePeriodDays}>{(p) => <Input {...p} name="gracePeriodDays" type="number" min={0} max={90} defaultValue={defaults.gracePeriodDays} />}</Field>
        </div>
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Record renewal</Button>
      </form>
    </Dialog>
  );
}

export function AdjustChargeDialog({ chargeId, label, adjustments }: { chargeId: string; label: string; adjustments: { id: string; amountKobo: number; reason: string }[] }) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"reduce" | "increase">("reduce");
  const [amount, setAmount] = useState<number | null>(null);
  const a = useAction((body: unknown) => api(`/api/charges/${chargeId}/adjust`, { body }), { success: "Adjustment recorded", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="ghost">Adjust</Button>} title={`Adjust ${label}`} description="Adjustments are added to the record with your reason. The original amount is always kept.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run({
            amountKobo: amount ? (direction === "reduce" ? -amount : amount) : 0,
            reason: String(fd.get("reason") ?? "").trim(),
            correctsAdjustmentId: String(fd.get("corrects") ?? "") || undefined,
          });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {(["reduce", "increase"] as const).map((d) => (
            <label key={d} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${direction === d ? "border-emerald-600 bg-emerald-50" : "border-cream-300"}`}>
              <input type="radio" className="sr-only" checked={direction === d} onChange={() => setDirection(d)} />
              {d === "reduce" ? "Reduce (discount / waiver / credit)" : "Increase (additional charge)"}
            </label>
          ))}
        </div>
        <Field label="Amount" error={a.fieldErrors.amountKobo} required>{(p) => <MoneyInput {...p} valueKobo={amount} onChangeKobo={setAmount} />}</Field>
        <Field label="Reason" error={a.fieldErrors.reason} required>{(p) => <Textarea {...p} name="reason" placeholder="Shown to the tenant on the shared record" />}</Field>
        {adjustments.length ? (
          <Field label="This corrects an earlier adjustment (optional)">
            {(p) => (
              <Select {...p} name="corrects" defaultValue="">
                <option value="">No</option>
                {adjustments.map((x) => <option key={x.id} value={x.id}>{formatKobo(x.amountKobo)} — {x.reason.slice(0, 40)}</option>)}
              </Select>
            )}
          </Field>
        ) : null}
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Record adjustment</Button>
      </form>
    </Dialog>
  );
}

export function GraceDialog({ tenancyId, grace }: { tenancyId: string; grace: number }) {
  const [open, setOpen] = useState(false);
  const a = useAction((body: unknown) => api(`/api/tenancies/${tenancyId}/terms`, { body }), { success: "Updated", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="ghost">Edit</Button>} title="Grace period" size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run({ gracePeriodDays: Number(new FormData(e.currentTarget).get("g") || 0) });
        }}
      >
        <Field label="Days after due date before overdue" error={a.fieldErrors.gracePeriodDays}>{(p) => <Input {...p} name="g" type="number" min={0} max={90} defaultValue={grace} />}</Field>
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Save</Button>
      </form>
    </Dialog>
  );
}

export function UploadAgreement({ tenancyId, replacesAssetId }: { tenancyId: string; replacesAssetId?: string }) {
  const router = useRouter();
  const [key, setKey] = useState(0);
  return (
    <FileUpload
      key={key}
      kind="agreement"
      tenancyId={tenancyId}
      replacesAssetId={replacesAssetId}
      max={1}
      label={replacesAssetId ? "Upload a new version" : "Upload tenancy agreement"}
      hint="PDF or photo · private to you and the tenant"
      onChange={(f) => {
        if (f.length) {
          setKey((k) => k + 1);
          router.refresh();
        }
      }}
    />
  );
}

export function ReversePaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="ghost">Reverse</Button>}
      title="Reverse this payment?"
      description="Use this if the money didn't actually arrive (e.g. a bounced transfer) or it was recorded in error. The payment stays on record as reversed, its receipt is voided, and the amount becomes outstanding again."
      confirmLabel="Reverse payment"
      tone="danger"
      onConfirm={async () => {
        await api(`/api/payments/${paymentId}/reverse`, { body: { reason } });
        router.refresh();
      }}
    >
      <Field label="Reason" required>{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </ConfirmDialog>
  );
}

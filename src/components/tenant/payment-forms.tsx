"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormError, Input, MoneyInput, Select, Textarea } from "@/components/ui/form";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { api, ApiError, useAction } from "@/lib/api-client";
import { formatKobo } from "@/lib/money";

export interface OpenCharge {
  id: string;
  label: string;
  dueKobo: number;
}

/** Starts a server-side checkout and sends the tenant to the provider. Confirmation happens only server-side. */
export function PayOnline({ tenancyId, charges, enabled }: { tenancyId: string; charges: OpenCharge[]; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(charges.slice(0, 1).map((c) => c.id)));
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = charges.filter((c) => selected.has(c.id)).reduce((s, c) => s + c.dueKobo, 0);
  if (!enabled) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="lg" disabled={!charges.length}>Pay online</Button>} title="Pay online" description="You'll be taken to our secure payment provider. Your payment counts once the provider confirms it to us — usually within seconds.">
      {charges.length === 0 ? (
        <Alert tone="success">Nothing to pay right now.</Alert>
      ) : (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink-800">What are you paying for?</legend>
            {charges.map((c) => (
              <Checkbox
                key={c.id}
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const n = new Set(selected);
                  if (e.target.checked) n.add(c.id);
                  else n.delete(c.id);
                  setSelected(n);
                }}
                label={<span className="tabular">{c.label} — {formatKobo(c.dueKobo)}</span>}
              />
            ))}
          </fieldset>
          <Checkbox checked={partial} onChange={(e) => setPartial(e.target.checked)} label="Pay part of this amount" />
          {partial ? <Field label="Amount to pay" hint={`Up to ${formatKobo(total)}`}>{(p) => <MoneyInput {...p} valueKobo={amount} onChangeKobo={setAmount} />}</Field> : null}
          <FormError message={error} />
          <Button
            className="w-full"
            size="lg"
            loading={pending}
            disabled={selected.size === 0 || (partial && !amount)}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                const r = await api<{ authorizationUrl: string }>("/api/payments/online", { body: { tenancyId, chargeIds: [...selected], amountKobo: partial ? amount : undefined } });
                window.location.assign(r.authorizationUrl);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Couldn't start payment");
                setPending(false);
              }
            }}
          >
            Continue to pay {formatKobo(partial && amount ? amount : total)}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/** Report a payment made outside the app (bank transfer, POS, cash). It stays "awaiting review" until the landlord confirms. */
export function ReportPaymentDialog({ tenancyId, charges }: { tenancyId: string; charges: OpenCharge[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [proof, setProof] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const a = useAction((body: unknown) => api("/api/payments", { body }), { success: "Sent to your landlord for confirmation", onSuccess: () => setOpen(false) });
  const fe = a.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="lg" variant="outline">I paid by transfer</Button>} title="Report a payment you made" description="Your landlord will check their account and confirm it. Until then it shows as awaiting review and isn't counted in your balance.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const chargeId = String(fd.get("chargeId") ?? "");
          void a.run({
            tenancyId,
            purpose: fd.get("purpose"),
            amountKobo: amount,
            paidOn: fd.get("paidOn"),
            method: fd.get("method"),
            reference: String(fd.get("reference") ?? "").trim(),
            bankName: String(fd.get("bankName") ?? "").trim() || undefined,
            proofAssetId: proof[0]?.id,
            chargeIds: chargeId ? [chargeId] : [],
            note: String(fd.get("note") ?? "").trim() || undefined,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount paid" error={fe.amountKobo} required>{(p) => <MoneyInput {...p} valueKobo={amount} onChangeKobo={setAmount} />}</Field>
          <Field label="Date paid" error={fe.paidOn} required>{(p) => <Input {...p} name="paidOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} max={new Date().toISOString().slice(0, 10)} />}</Field>
          <Field label="How did you pay?" error={fe.method}>
            {(p) => (
              <Select {...p} name="method" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option>
                <option value="pos">POS</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </Select>
            )}
          </Field>
          <Field label="Bank (optional)" error={fe.bankName}>{(p) => <Input {...p} name="bankName" placeholder="e.g. GTBank" />}</Field>
        </div>
        <Field label="Transfer reference / session ID" hint="From your bank app or receipt. Each reference can only be used once." error={fe.reference} required>{(p) => <Input {...p} name="reference" autoComplete="off" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="This was for" error={fe.purpose}>
            {(p) => (
              <Select {...p} name="purpose" defaultValue="rent">
                <option value="rent">Rent and charges</option>
                <option value="deposit">Security deposit</option>
              </Select>
            )}
          </Field>
          {charges.length ? (
            <Field label="Apply to (optional)">
              {(p) => (
                <Select {...p} name="chargeId" defaultValue="">
                  <option value="">Oldest unpaid first</option>
                  {charges.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
        <FileUpload kind="payment_proof" tenancyId={tenancyId} max={1} label="Attach receipt or screenshot (optional)" hint="Helps your landlord find the payment. It doesn't confirm the payment by itself." onChange={setProof} onBusyChange={setUploading} />
        <Field label="Note (optional)" error={fe.note}>{(p) => <Textarea {...p} name="note" rows={2} />}</Field>
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending} disabled={uploading}>{uploading ? "Uploading…" : "Send for confirmation"}</Button>
      </form>
    </Dialog>
  );
}

export function InspectionResponse({ inspectionId }: { inspectionId: string }) {
  const [comment, setComment] = useState("");
  const a = useAction((status: "acknowledged" | "disputed") => api(`/api/inspections/${inspectionId}/respond`, { body: { status, comment: comment.trim() || undefined } }), { success: "Response recorded" });
  return (
    <div className="space-y-3 rounded-2xl border border-cream-300 p-4">
      <p className="text-sm font-medium">Do you agree with this inspection?</p>
      <Textarea aria-label="Comment" placeholder="Comment (required if you disagree)" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
      <div className="flex flex-wrap gap-2">
        <Button loading={a.pending} onClick={() => a.run("acknowledged")}>I agree</Button>
        <Button variant="outline" loading={a.pending} onClick={() => a.run("disputed")}>I disagree</Button>
      </div>
      <FormError message={a.error} />
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/form";
import { api, useAction } from "@/lib/api-client";

/** Approve or reject a tenant-reported payment. The server guards against double confirmation. */
export function ReviewActions({ paymentId, amountLabel }: { paymentId: string; amountLabel: string }) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const approve = useAction(() => api(`/api/payments/${paymentId}/approve`, { body: {} }), { success: "Payment confirmed and receipt issued", onSuccess: () => setApproveOpen(false) });
  const reject = useAction((reason: string) => api(`/api/payments/${paymentId}/reject`, { body: { reason } }), { success: "Payment marked as not confirmed", onSuccess: () => setRejectOpen(false) });
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen} trigger={<Button size="sm">Confirm received</Button>} title={`Confirm ${amountLabel} received?`} size="sm" description="Only confirm once you've seen the money in your account. This issues a receipt to the tenant and updates the balance.">
        <FormError message={approve.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
          <Button loading={approve.pending} onClick={() => approve.run()}>Yes, I received it</Button>
        </div>
      </Dialog>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen} trigger={<Button size="sm" variant="outline">Not received</Button>} title="Mark as not confirmed" size="sm" description="The tenant is told your reason and can submit corrected details. The submission stays on the record.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void reject.run(String(new FormData(e.currentTarget).get("reason") ?? "").trim());
          }}
        >
          <Field label="Reason" hint="e.g. No matching credit in my account for this date and reference" error={reject.fieldErrors.reason} required>
            {(p) => <Textarea {...p} name="reason" />}
          </Field>
          <FormError message={reject.error} />
          <Button type="submit" variant="danger" loading={reject.pending}>Mark not confirmed</Button>
        </form>
      </Dialog>
    </div>
  );
}

export function CheckProviderButton({ paymentId }: { paymentId: string }) {
  const a = useAction(() => api(`/api/payments/${paymentId}/check`, { body: {} }), { success: "Checked with the payment provider" });
  return (
    <Button size="sm" variant="outline" loading={a.pending} onClick={() => a.run()} title={a.error ?? undefined}>
      Check status
    </Button>
  );
}

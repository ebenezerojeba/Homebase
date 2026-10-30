"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, MoneyInput, Select, Textarea } from "@/components/ui/form";
import { api, useAction } from "@/lib/api-client";
import { label } from "@/lib/nigeria";

const CATEGORIES = ["repairs", "plumbing", "electrical", "cleaning", "security", "waste", "utilities", "insurance", "legal", "agency", "tax_levy", "renovation", "other"];

export function ExpenseDialog({ properties }: { properties: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const a = useAction((body: unknown) => api("/api/expenses", { body }), { success: "Expense recorded", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="outline">Record expense</Button>} title="Record a property expense">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run({ propertyId: fd.get("propertyId"), category: fd.get("category"), description: String(fd.get("description") ?? "").trim(), amountKobo: amount, incurredOn: fd.get("incurredOn"), vendor: String(fd.get("vendor") ?? "").trim() || undefined });
        }}
      >
        <Field label="Property" error={a.fieldErrors.propertyId}>{(p) => <Select {...p} name="propertyId">{properties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">{(p) => <Select {...p} name="category">{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
          <Field label="Date" error={a.fieldErrors.incurredOn}>{(p) => <Input {...p} name="incurredOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />}</Field>
          <Field label="Amount" error={a.fieldErrors.amountKobo} required>{(p) => <MoneyInput {...p} valueKobo={amount} onChangeKobo={setAmount} />}</Field>
          <Field label="Paid to (optional)">{(p) => <Input {...p} name="vendor" />}</Field>
        </div>
        <Field label="Description" error={a.fieldErrors.description} required>{(p) => <Textarea {...p} name="description" rows={2} />}</Field>
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Save expense</Button>
      </form>
    </Dialog>
  );
}

export function VoidExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="ghost">Void</Button>}
      title="Void this expense?"
      description="It stays on record marked as voided and is excluded from totals."
      confirmLabel="Void expense"
      tone="danger"
      onConfirm={async () => {
        await api(`/api/expenses/${id}/void`, { body: { reason } });
        router.refresh();
      }}
    >
      <Field label="Reason">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </ConfirmDialog>
  );
}

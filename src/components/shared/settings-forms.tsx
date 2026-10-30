"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { api, useAction } from "@/lib/api-client";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const a = useAction((body: unknown) => api("/api/account/profile", { method: "PATCH", body }), { success: "Profile saved" });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void a.run({ name: String(fd.get("name") ?? "").trim() });
      }}
    >
      <Field label="Email" hint="Contact support to change your sign-in email">{(p) => <Input {...p} value={email} disabled readOnly />}</Field>
      <Field label="Full name" error={a.fieldErrors.name}>{(p) => <Input {...p} name="name" defaultValue={name} />}</Field>
      <FormError message={a.error} />
      <Button type="submit" loading={a.pending}>Save profile</Button>
    </form>
  );
}

export function PasswordForm() {
  const [key, setKey] = useState(0);
  const a = useAction((body: unknown) => api("/api/account/password", { body }), { success: "Password changed. Other devices were signed out.", onSuccess: () => setKey((k) => k + 1) });
  return (
    <form
      key={key}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void a.run({ currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") });
      }}
    >
      <Field label="Current password" error={a.fieldErrors.currentPassword}>{(p) => <Input {...p} name="currentPassword" type="password" autoComplete="current-password" />}</Field>
      <Field label="New password" hint="At least 10 characters, with letters and numbers" error={a.fieldErrors.newPassword}>{(p) => <Input {...p} name="newPassword" type="password" autoComplete="new-password" />}</Field>
      <FormError message={a.error} />
      <Button type="submit" loading={a.pending}>Change password</Button>
    </form>
  );
}

const PREFS: { type: string; label: string; roles: string[] }[] = [
  { type: "rent_upcoming", label: "Upcoming rent reminders", roles: ["tenant"] },
  { type: "rent_due", label: "Rent due today", roles: ["tenant"] },
  { type: "rent_overdue", label: "Overdue rent notices", roles: ["tenant"] },
  { type: "payment_claim_submitted", label: "New payments to review", roles: ["landlord"] },
  { type: "payment_confirmed", label: "Payment confirmations", roles: ["tenant"] },
  { type: "payment_rejected", label: "Payments not confirmed", roles: ["tenant"] },
  { type: "receipt_issued", label: "New receipts", roles: ["tenant"] },
  { type: "maintenance_update", label: "Repair updates", roles: ["landlord", "tenant"] },
  { type: "message_received", label: "New messages", roles: ["landlord", "tenant"] },
  { type: "tenancy_renewal", label: "Tenancy ending / renewal reminders", roles: ["landlord", "tenant"] },
  { type: "tenancy_update", label: "Tenancy record changes", roles: ["landlord", "tenant"] },
];

export function NotificationPrefs({ role, optOut }: { role: string; optOut: string[] }) {
  const [off, setOff] = useState(new Set(optOut));
  const a = useAction((emailOptOut: string[]) => api("/api/account/notification-preferences", { method: "PUT", body: { emailOptOut } }), { success: "Preferences saved" });
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">Choose which updates we also email you. Everything always appears in your in-app notifications. Account and security emails can&apos;t be turned off.</p>
      {PREFS.filter((p) => p.roles.includes(role)).map((p) => (
        <Checkbox
          key={p.type}
          label={p.label}
          checked={!off.has(p.type)}
          onChange={(e) => {
            const next = new Set(off);
            if (e.target.checked) next.delete(p.type);
            else next.add(p.type);
            setOff(next);
          }}
        />
      ))}
      <FormError message={a.error} />
      <Button loading={a.pending} onClick={() => a.run([...off])}>Save email preferences</Button>
    </div>
  );
}

export function PrivacyControls({ requests }: { requests: { _id: string; type: string; status: string; createdAt: string; resolutionNote: string | null }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const a = useAction((body: unknown) => api("/api/account/data-requests", { body }), { success: "Request received — we'll respond within 30 days", onSuccess: () => setOpen(false) });
  const [confirm, setConfirm] = useState("");
  const deactivate = useAction(() => api("/api/account/deactivate", { body: { confirm } }), {
    refresh: false,
    onSuccess: () => {
      router.push("/");
      router.refresh();
    },
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <a href="/api/account/export" className={buttonClass("outline")}>Download my data</a>
        <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="outline">Make a privacy request</Button>} title="Privacy request" description="Ask us to correct, delete or explain the personal data we hold. Some financial records must be kept for the legal retention period; we'll explain anything we can't delete.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void a.run({ type: fd.get("type"), details: String(fd.get("details") ?? "").trim() });
            }}
          >
            <Field label="Request type">
              {(p) => (
                <Select {...p} name="type">
                  <option value="access">Access — explain what you hold</option>
                  <option value="correction">Correction — fix something wrong</option>
                  <option value="deletion">Deletion — erase my data</option>
                </Select>
              )}
            </Field>
            <Field label="Details" error={a.fieldErrors.details} required>{(p) => <Textarea {...p} name="details" />}</Field>
            <FormError message={a.error} />
            <Button type="submit" loading={a.pending}>Submit request</Button>
          </form>
        </Dialog>
      </div>
      {requests.length ? (
        <ul className="space-y-2 text-sm">
          {requests.map((r) => (
            <li key={r._id} className="rounded-xl bg-cream-50 px-3 py-2">
              <span className="font-medium capitalize">{r.type}</span> request · {r.status.replace("_", " ")} · {new Date(r.createdAt).toLocaleDateString("en-NG")}
              {r.resolutionNote ? <span className="block text-ink-600">{r.resolutionNote}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rounded-2xl border border-rose-700/20 p-4">
        <p className="font-semibold text-rose-700">Deactivate account</p>
        <p className="mt-1 text-sm text-ink-600">You&apos;ll be signed out everywhere and won&apos;t be able to sign in. Tenancy and payment records shared with the other party are retained for the legal retention period.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label='Type "DEACTIVATE" to confirm' className="w-64">{(p) => <Input {...p} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
          <Button variant="danger" disabled={confirm !== "DEACTIVATE"} loading={deactivate.pending} onClick={() => deactivate.run()}>Deactivate</Button>
        </div>
        {deactivate.error ? <Alert tone="error" className="mt-3">{deactivate.error}</Alert> : null}
      </div>
    </div>
  );
}

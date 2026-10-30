"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, MoneyInput, Select, Textarea } from "@/components/ui/form";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { api, useAction } from "@/lib/api-client";
import { label } from "@/lib/nigeria";

const CATEGORIES = ["plumbing", "electrical", "structural", "roofing", "doors_windows", "appliances", "pest_control", "water_supply", "generator", "security", "painting", "cleaning", "other"];
const STATUSES = ["submitted", "acknowledged", "scheduled", "in_progress", "awaiting_tenant", "completed", "cancelled"];

export function NewRequestForm({ tenancies, base }: { tenancies: { id: string; label: string }[]; base: string }) {
  const router = useRouter();
  const [tenancyId, setTenancyId] = useState(tenancies[0]?.id ?? "");
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const a = useAction((body: unknown) => api<{ requestId: string }>("/api/maintenance", { body }), {
    success: "Request sent to your landlord",
    onSuccess: (r) => router.push(`${base}/${r.requestId}`),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void a.run({ tenancyId, title: fd.get("title"), description: fd.get("description"), category: fd.get("category"), priority: fd.get("priority"), assetIds: photos.map((p) => p.id) });
      }}
    >
      {tenancies.length > 1 ? (
        <Field label="Home">{(p) => <Select {...p} value={tenancyId} onChange={(e) => setTenancyId(e.target.value)}>{tenancies.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>}</Field>
      ) : null}
      <Field label="What's the problem?" hint="A short title, e.g. 'Kitchen tap leaking'" error={a.fieldErrors.title} required>{(p) => <Input {...p} name="title" maxLength={120} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" error={a.fieldErrors.category}>{(p) => <Select {...p} name="category" defaultValue="plumbing">{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
        <Field label="How urgent?" error={a.fieldErrors.priority}>
          {(p) => (
            <Select {...p} name="priority" defaultValue="normal">
              <option value="low">Low — when convenient</option>
              <option value="normal">Normal</option>
              <option value="high">High — affecting daily life</option>
              <option value="urgent">Urgent — safety risk or no water/power</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Details" hint="Where is it, when did it start, what have you tried?" error={a.fieldErrors.description} required>{(p) => <Textarea {...p} name="description" rows={5} />}</Field>
      {tenancyId ? <FileUpload kind="maintenance_photo" tenancyId={tenancyId} accept="image/jpeg,image/png,image/webp" label="Add photos" hint="JPG, PNG or WebP · up to 8 MB each" max={6} onChange={setPhotos} onBusyChange={setUploading} /> : null}
      <FormError message={a.error} />
      <Button type="submit" loading={a.pending} disabled={uploading}>{uploading ? "Uploading…" : "Submit request"}</Button>
    </form>
  );
}

export function LandlordUpdateForm({ requestId, current }: { requestId: string; current: { status: string; allowed: string[]; priority: string; assignedTo: string | null; expectedDate: string | null; costKobo: number | null; hasExpense: boolean } }) {
  const [status, setStatus] = useState(current.status);
  const [cost, setCost] = useState<number | null>(current.costKobo);
  const a = useAction((body: unknown) => api(`/api/maintenance/${requestId}/update`, { body }), { success: "Request updated" });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void a.run({
          status,
          priority: fd.get("priority"),
          assignedTo: String(fd.get("assignedTo") ?? "").trim() || null,
          expectedDate: String(fd.get("expectedDate") ?? "") || null,
          completionNotes: String(fd.get("completionNotes") ?? "").trim() || undefined,
          costKobo: cost,
          message: String(fd.get("message") ?? "").trim() || undefined,
          recordExpense: fd.get("recordExpense") === "on",
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status">{(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.filter((s) => s === current.status || current.allowed.includes(s)).map((s) => <option key={s} value={s}>{label(s)}{s === current.status ? " (current)" : ""}</option>)}</Select>}</Field>
        <Field label="Priority">{(p) => <Select {...p} name="priority" defaultValue={current.priority}>{["low", "normal", "high", "urgent"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
        <Field label="Assigned to" hint="Name / phone of the artisan">{(p) => <Input {...p} name="assignedTo" defaultValue={current.assignedTo ?? ""} />}</Field>
        <Field label="Expected date">{(p) => <Input {...p} name="expectedDate" type="date" defaultValue={current.expectedDate ?? ""} />}</Field>
      </div>
      {status === "completed" ? <Field label="Completion notes">{(p) => <Textarea {...p} name="completionNotes" rows={2} />}</Field> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Repair cost (optional)" hint="Private to you">{(p) => <MoneyInput {...p} valueKobo={cost} onChangeKobo={setCost} />}</Field>
        {!current.hasExpense ? <div className="pt-7"><Checkbox name="recordExpense" label="Record as a property expense" /></div> : <p className="pt-8 text-xs text-ink-500">An expense is already recorded for this request.</p>}
      </div>
      <Field label="Message to tenant (optional)" hint="Shared with the tenant">{(p) => <Textarea {...p} name="message" rows={2} />}</Field>
      <FormError message={a.error} />
      <Button type="submit" loading={a.pending}>Save update</Button>
    </form>
  );
}

export function CommentForm({ requestId, tenancyId, allowInternal }: { requestId: string; tenancyId: string; allowInternal: boolean }) {
  const [internal, setInternal] = useState(false);
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [key, setKey] = useState(0);
  const a = useAction((body: unknown) => api(`/api/maintenance/${requestId}/comment`, { body }), {
    success: internal ? "Internal note saved" : "Comment posted",
    onSuccess: () => {
      setPhotos([]);
      setKey((k) => k + 1);
    },
  });
  return (
    <form
      key={key}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run({ body: String(new FormData(e.currentTarget).get("body") ?? "").trim(), internal, assetIds: photos.map((p) => p.id) });
      }}
    >
      <Field label={internal ? "Internal note (only you can see this)" : "Add a comment"} error={a.fieldErrors.body}>{(p) => <Textarea {...p} name="body" rows={3} className={internal ? "bg-amber-50" : undefined} />}</Field>
      {!internal ? <FileUpload kind="maintenance_photo" tenancyId={tenancyId} accept="image/jpeg,image/png,image/webp" label="Add photos" max={4} onChange={setPhotos} onBusyChange={setUploading} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={a.pending} disabled={uploading}>{uploading ? "Uploading…" : internal ? "Save note" : "Post"}</Button>
        {allowInternal ? <Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)} label="Internal note (hidden from tenant)" /> : null}
      </div>
      <FormError message={a.error} />
    </form>
  );
}

export function TenantConfirm({ requestId }: { requestId: string }) {
  const [comment, setComment] = useState("");
  const a = useAction((resolved: boolean) => api(`/api/maintenance/${requestId}/confirm`, { body: { resolved, comment: comment.trim() || undefined } }), { success: "Thanks — your landlord has been told" });
  return (
    <div className="space-y-3 rounded-2xl border border-emerald-700/20 bg-emerald-50 p-4">
      <p className="text-sm font-medium text-emerald-900">Your landlord marked this as completed. Is the problem fixed?</p>
      <Textarea aria-label="Comment (optional)" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
      <div className="flex flex-wrap gap-2">
        <Button loading={a.pending} onClick={() => a.run(true)}>Yes, it&apos;s fixed</Button>
        <Button variant="outline" loading={a.pending} onClick={() => a.run(false)}>No, still not resolved</Button>
      </div>
      <FormError message={a.error} />
    </div>
  );
}

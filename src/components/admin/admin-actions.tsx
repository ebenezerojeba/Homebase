"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { api, useAction } from "@/lib/api-client";

export function UserStatusButton({ userId, status }: { userId: string; status: string }) {
  const [open, setOpen] = useState(false);
  const next = status === "active" ? "deactivated" : "active";
  const a = useAction((reason: string) => api(`/api/admin/users/${userId}/status`, { body: { status: next, reason } }), { success: "Updated", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant={next === "deactivated" ? "ghost" : "secondary"}>{next === "deactivated" ? "Deactivate" : "Reactivate"}</Button>} title={next === "deactivated" ? "Deactivate user" : "Reactivate user"} size="sm" description="This action is recorded in the audit log.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(String(new FormData(e.currentTarget).get("reason") ?? "")); }}>
        <Field label="Reason" error={a.fieldErrors.reason}>{(p) => <Input {...p} name="reason" />}</Field>
        <FormError message={a.error} />
        <Button type="submit" variant={next === "deactivated" ? "danger" : "primary"} loading={a.pending}>Confirm</Button>
      </form>
    </Dialog>
  );
}

export function ResolveRequest({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const a = useAction((body: unknown) => api(`/api/admin/data-requests/${id}`, { body }), { success: "Request updated", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="outline">Update</Button>} title="Update data request">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); void a.run({ status: fd.get("status"), resolutionNote: String(fd.get("note") ?? "").trim() || undefined }); }}>
        <Field label="Status">{(p) => <Select {...p} name="status"><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="declined">Declined (explain why)</option></Select>}</Field>
        <Field label="Note to the user">{(p) => <Textarea {...p} name="note" />}</Field>
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Save</Button>
      </form>
    </Dialog>
  );
}

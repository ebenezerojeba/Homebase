"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { FileUpload } from "@/components/ui/file-upload";
import { api, useAction } from "@/lib/api-client";

type Item = { key: number; area: string; condition: string; notes: string; assetIds: string[] };
const DEFAULT_AREAS = ["Living room", "Kitchen", "Bedroom(s)", "Bathroom(s)", "Doors & windows", "Electrical fittings", "Plumbing"];

export function InspectionDialog({ tenancyId }: { tenancyId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>(DEFAULT_AREAS.map((area, i) => ({ key: i, area, condition: "good", notes: "", assetIds: [] })));
  const a = useAction((body: unknown) => api("/api/inspections", { body }), { success: "Inspection recorded", onSuccess: () => setOpen(false) });
  const update = (key: number, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  return (
    <Dialog open={open} onOpenChange={setOpen} size="lg" trigger={<Button variant="outline">Record inspection</Button>} title="Move-in / move-out inspection" description="Record the condition of each area with dated photos. The tenant can acknowledge or dispute it.">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run({
            tenancyId,
            type: fd.get("type"),
            inspectedOn: fd.get("inspectedOn"),
            summary: String(fd.get("summary") ?? "").trim() || undefined,
            items: items.filter((i) => i.area.trim()).map((i) => ({ area: i.area.trim(), condition: i.condition, notes: i.notes.trim() || undefined, assetIds: i.assetIds })),
            finalize: true,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            {(p) => (
              <Select {...p} name="type" defaultValue="move_in">
                <option value="move_in">Move-in</option>
                <option value="move_out">Move-out</option>
              </Select>
            )}
          </Field>
          <Field label="Inspection date" error={a.fieldErrors.inspectedOn}>{(p) => <Input {...p} name="inspectedOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />}</Field>
        </div>
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.key} className="rounded-2xl border border-cream-300 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <Input aria-label="Area" value={it.area} onChange={(e) => update(it.key, { area: e.target.value })} />
                <Select aria-label={`Condition of ${it.area}`} value={it.condition} onChange={(e) => update(it.key, { condition: e.target.value })}>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                  <option value="damaged">Damaged</option>
                  <option value="missing">Missing</option>
                </Select>
                <button type="button" className="rounded-lg p-2 text-ink-400 hover:text-rose-700" aria-label={`Remove ${it.area}`} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <Input className="mt-2" aria-label={`Notes for ${it.area}`} placeholder="Notes (optional)" value={it.notes} onChange={(e) => update(it.key, { notes: e.target.value })} />
              <div className="mt-2">
                <FileUpload kind="inspection_photo" tenancyId={tenancyId} accept="image/jpeg,image/png,image/webp" label="Add photos" hint="Dated automatically" max={8} onChange={(f) => update(it.key, { assetIds: f.map((x) => x.id) })} />
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="ghost" size="sm" onClick={() => setItems((xs) => [...xs, { key: Date.now(), area: "", condition: "good", notes: "", assetIds: [] }])}>
          <Plus className="size-4" aria-hidden /> Add area
        </Button>
        <Field label="Overall summary (optional)">{(p) => <Textarea {...p} name="summary" />}</Field>
        {a.fieldErrors.items ? <p className="text-xs text-rose-700">{a.fieldErrors.items[0]}</p> : null}
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>Save and share with tenant</Button>
      </form>
    </Dialog>
  );
}

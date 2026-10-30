"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { FileUpload } from "@/components/ui/file-upload";
import { api, useAction } from "@/lib/api-client";
import { label, NIGERIAN_STATES, PROPERTY_TYPES, UNIT_TYPES } from "@/lib/nigeria";

export interface PropertyValues {
  name: string;
  propertyType: string;
  address: { line1: string; line2?: string | null; city: string; lga: string; state: string };
  description?: string | null;
}

export function PropertyForm({ propertyId, initial, onDone }: { propertyId?: string; initial?: PropertyValues; onDone?: () => void }) {
  const router = useRouter();
  const a = useAction(
    (body: unknown) => (propertyId ? api(`/api/properties/${propertyId}`, { method: "PATCH", body }) : api<{ property: { _id: string } }>("/api/properties", { body })),
    {
      success: propertyId ? "Property updated" : "Property added",
      onSuccess: (r) => {
        if (!propertyId && r && typeof r === "object" && "property" in r) router.push(`/landlord/properties/${(r as { property: { _id: string } }).property._id}`);
        onDone?.();
      },
    },
  );
  const fe = a.fieldErrors;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const s = (k: string) => String(fd.get(k) ?? "").trim();
        void a.run({
          name: s("name"),
          propertyType: s("propertyType"),
          address: { line1: s("line1"), line2: s("line2") || undefined, city: s("city"), lga: s("lga"), state: s("state") },
          description: s("description") || undefined,
        });
      }}
    >
      <Field label="Property name" hint="e.g. 'Palm Court' or '12 Adeola Street'" error={fe.name} required>{(p) => <Input {...p} name="name" defaultValue={initial?.name} />}</Field>
      <Field label="Property type" error={fe.propertyType} required>
        {(p) => (
          <Select {...p} name="propertyType" defaultValue={initial?.propertyType ?? "apartment_block"}>
            {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Street address" error={fe["address.line1"]} required>{(p) => <Input {...p} name="line1" autoComplete="address-line1" defaultValue={initial?.address.line1} />}</Field>
      <Field label="Address line 2 (optional)" error={fe["address.line2"]}>{(p) => <Input {...p} name="line2" autoComplete="address-line2" defaultValue={initial?.address.line2 ?? ""} />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City / town" error={fe["address.city"]} required>{(p) => <Input {...p} name="city" defaultValue={initial?.address.city} />}</Field>
        <Field label="LGA" error={fe["address.lga"]} required>{(p) => <Input {...p} name="lga" defaultValue={initial?.address.lga} />}</Field>
        <Field label="State" error={fe["address.state"]} required>
          {(p) => (
            <Select {...p} name="state" defaultValue={initial?.address.state ?? "Lagos"}>
              {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description (optional)" error={fe.description}>{(p) => <Textarea {...p} name="description" defaultValue={initial?.description ?? ""} />}</Field>
      <FormError message={a.error} />
      <Button type="submit" loading={a.pending}>{propertyId ? "Save changes" : "Add property"}</Button>
    </form>
  );
}

export function EditPropertyButton({ propertyId, initial }: { propertyId: string; initial: PropertyValues }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={<Button variant="outline">Edit</Button>} title="Edit property" size="lg">
      <PropertyForm propertyId={propertyId} initial={initial} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

export function ArchiveButton({ endpoint, archived, noun }: { endpoint: string; archived: boolean; noun: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={<Button variant={archived ? "secondary" : "ghost"}>{archived ? `Restore ${noun}` : `Archive ${noun}`}</Button>}
      title={archived ? `Restore this ${noun}?` : `Archive this ${noun}?`}
      description={archived ? undefined : `Archived ${noun}s are hidden from lists. Their history is kept and you can restore them.`}
      confirmLabel={archived ? "Restore" : "Archive"}
      onConfirm={async () => {
        await api(endpoint, { body: { archived: !archived } });
        router.refresh();
      }}
    />
  );
}

export interface UnitValues {
  unitNumber: string;
  unitType: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  features: string[];
  occupancy?: string;
}

export function UnitDialog({ propertyId, unitId, initial, trigger }: { propertyId: string; unitId?: string; initial?: UnitValues; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const a = useAction((body: unknown) => (unitId ? api(`/api/units/${unitId}`, { method: "PATCH", body }) : api(`/api/properties/${propertyId}/units`, { body })), {
    success: unitId ? "Unit updated" : "Unit added",
    onSuccess: () => setOpen(false),
  });
  const fe = a.fieldErrors;
  const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={unitId ? "Edit unit" : "Add a unit"} description="A unit is anything you let separately: a flat, room, shop, or the whole house.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run({
            unitNumber: String(fd.get("unitNumber") ?? "").trim(),
            unitType: fd.get("unitType"),
            bedrooms: num(fd.get("bedrooms")),
            bathrooms: num(fd.get("bathrooms")),
            features: String(fd.get("features") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
            occupancy: fd.get("unavailable") === "on" ? "unavailable" : "vacant",
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unit name / number" hint="e.g. Flat 2, Shop A" error={fe.unitNumber} required>{(p) => <Input {...p} name="unitNumber" defaultValue={initial?.unitNumber} />}</Field>
          <Field label="Type" error={fe.unitType} required>
            {(p) => (
              <Select {...p} name="unitType" defaultValue={initial?.unitType ?? "two_bedroom"}>
                {UNIT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Bedrooms" error={fe.bedrooms}>{(p) => <Input {...p} name="bedrooms" type="number" min={0} max={50} defaultValue={initial?.bedrooms ?? ""} />}</Field>
          <Field label="Bathrooms" error={fe.bathrooms}>{(p) => <Input {...p} name="bathrooms" type="number" min={0} max={50} defaultValue={initial?.bathrooms ?? ""} />}</Field>
        </div>
        <Field label="Features (comma separated)" hint="e.g. Prepaid meter, Borehole, Parking" error={fe.features}>{(p) => <Input {...p} name="features" defaultValue={initial?.features.join(", ")} />}</Field>
        {initial?.occupancy !== "occupied" ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="unavailable" defaultChecked={initial?.occupancy === "unavailable"} className="accent-emerald-700" /> Not available to let (e.g. under renovation)
          </label>
        ) : null}
        <FormError message={a.error} />
        <Button type="submit" loading={a.pending}>{unitId ? "Save unit" : "Add unit"}</Button>
      </form>
    </Dialog>
  );
}

export function PropertyImages({ propertyId, images }: { propertyId: string; images: { _id: string; displayName: string }[] }) {
  const router = useRouter();
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      {images.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((img) => (
            <div key={img._id} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-cream-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${img._id}`} alt={img.displayName} className="size-full object-cover" loading="lazy" />
              <button
                className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-medium text-rose-700 opacity-0 shadow transition-opacity focus:opacity-100 group-hover:opacity-100"
                onClick={async () => {
                  await api(`/api/assets/${img._id}`, { method: "DELETE" });
                  router.refresh();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <FileUpload
        key={key}
        kind="property_image"
        propertyId={propertyId}
        accept="image/jpeg,image/png,image/webp"
        label="Add photos"
        hint="JPG, PNG or WebP · up to 8 MB"
        max={6}
        onChange={(files) => {
          if (files.length) {
            setKey((k) => k + 1);
            router.refresh();
          }
        }}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/form";
import { api, useAction } from "@/lib/api-client";

type Channel = "sms" | "whatsapp";

export function PhoneSettings({
  phone,
  verified,
  sms,
  whatsapp,
  available,
}: {
  phone: string | null;
  verified: boolean;
  sms: boolean;
  whatsapp: boolean;
  available: Channel[];
}) {
  const [editing, setEditing] = useState(!verified);
  const [number, setNumber] = useState(phone ?? "");
  const [channel, setChannel] = useState<Channel>(available[0] ?? "whatsapp");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [on, setOn] = useState({ sms, whatsapp });

  const send = useAction((body: unknown) => api<{ sentTo: string }>("/api/account/phone/send-code", { body }), { refresh: false, onSuccess: (r) => setSentTo(r.sentTo) });
  const verify = useAction((c: string) => api<{ channel: Channel }>("/api/account/phone/verify", { body: { code: c } }), {
    success: "Phone number verified",
    onSuccess: (r) => {
      setSentTo(null);
      setCode("");
      setEditing(false);
      setOn((o) => ({ ...o, [r.channel]: true }));
    },
  });
  const save = useAction((body: { sms: boolean; whatsapp: boolean }) => api("/api/account/phone/channels", { body }), { success: "Text alert settings saved" });
  const remove = useAction(() => api("/api/account/phone/remove", { body: {} }), {
    success: "Phone number removed",
    onSuccess: () => {
      setEditing(true);
      setNumber("");
      setOn({ sms: false, whatsapp: false });
    },
  });

  if (available.length === 0) {
    return <p className="text-sm text-ink-600">SMS and WhatsApp alerts aren&apos;t switched on for this service yet. You&apos;ll still get alerts in the app and by email.</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-600">
        Get time-sensitive alerts (rent reminders, payment outcomes, repair updates) by {available.map((c) => (c === "sms" ? "SMS" : "WhatsApp")).join(" or ")}. We never send texts between 9pm and 7am, or for marketing.
      </p>

      {!editing && phone ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-cream-50 px-4 py-3 text-sm">
          <span className="font-medium">{phone}</span>
          <span className="text-xs font-semibold text-emerald-700">Verified</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Change</Button>
          <Button size="sm" variant="ghost" loading={remove.pending} onClick={() => remove.run()}>Remove</Button>
        </div>
      ) : sentTo ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify.run(code);
          }}
        >
          <Alert tone="info">We sent a 6-digit code to {sentTo}. It expires in 10 minutes.</Alert>
          <Field label="Verification code" error={verify.fieldErrors.code}>
            {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />}
          </Field>
          <FormError message={verify.fieldErrors.code ? null : verify.error} />
          <div className="flex gap-2">
            <Button type="submit" loading={verify.pending} disabled={code.length !== 6}>Verify</Button>
            <Button type="button" variant="ghost" onClick={() => setSentTo(null)}>Use a different number</Button>
          </div>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run({ phone: number, channel });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <Field label="Phone number" hint="Nigerian number, e.g. 0803 123 4567" error={send.fieldErrors.phone}>
              {(p) => <Input {...p} type="tel" autoComplete="tel" value={number} onChange={(e) => setNumber(e.target.value)} />}
            </Field>
            {available.length > 1 ? (
              <Field label="Send code by">
                {(p) => (
                  <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                    {available.map((c) => <option key={c} value={c}>{c === "sms" ? "SMS" : "WhatsApp"}</option>)}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
          <FormError message={send.fieldErrors.phone ? null : send.error} />
          <div className="flex gap-2">
            <Button type="submit" loading={send.pending}>Send code</Button>
            {phone && verified ? <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button> : null}
          </div>
        </form>
      )}

      {verified && !editing ? (
        <div className="space-y-2">
          {available.includes("whatsapp") ? <Checkbox label="WhatsApp alerts" checked={on.whatsapp} onChange={(e) => setOn({ ...on, whatsapp: e.target.checked })} /> : null}
          {available.includes("sms") ? <Checkbox label="SMS alerts" checked={on.sms} onChange={(e) => setOn({ ...on, sms: e.target.checked })} /> : null}
          <FormError message={save.error} />
          <Button size="sm" variant="outline" loading={save.pending} onClick={() => save.run(on)}>Save text alert settings</Button>
        </div>
      ) : null}
    </div>
  );
}

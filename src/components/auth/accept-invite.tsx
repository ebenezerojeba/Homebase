"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";

export function AcceptInvite({ token, email, accountExists, signedInAs }: { token: string; email: string; accountExists: boolean; signedInAs: { email: string; role: string } | null }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});

  async function accept(registration?: { name: string; password: string; acceptPrivacy: boolean }) {
    setPending(true);
    setError(null);
    setFields({});
    try {
      const r = await api<{ redirectTo: string }>("/api/invitations/accept", { body: { token, acknowledgeTerms: ack, registration } });
      router.push(r.redirectTo);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.details ?? {});
      }
    } finally {
      setPending(false);
    }
  }

  const ackBox = <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} label="I have reviewed these tenancy terms" />;

  if (signedInAs) {
    if (signedInAs.email !== email || signedInAs.role !== "tenant") {
      return (
        <div className="space-y-4">
          <Alert tone="info" title="You're signed in with another account">
            This browser is signed in as {signedInAs.email}. This invitation is for the tenant, so sign out here to continue (or open the link on the tenant&apos;s phone).
          </Alert>
          <Button
            size="lg"
            className="w-full"
            loading={pending}
            onClick={async () => {
              setPending(true);
              await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
              router.refresh();
              setPending(false);
            }}
          >
            Sign out and continue
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {ackBox}
        <FormError message={error} />
        <Button size="lg" className="w-full" disabled={!ack} loading={pending} onClick={() => accept()}>
          Accept and join tenancy
        </Button>
      </div>
    );
  }

  if (accountExists) {
    return (
      <div className="space-y-3">
        <Alert tone="info">You already have an account. Sign in to accept this invitation.</Alert>
        <Link className="block text-center text-sm font-semibold text-emerald-700 hover:underline" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
          Sign in to continue
        </Link>
      </div>
    );
  }

  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void accept({ name: String(fd.get("name") ?? ""), password: String(fd.get("password") ?? ""), acceptPrivacy: fd.get("acceptPrivacy") === "on" });
      }}
    >
      <p className="text-sm text-ink-700">
        Create your tenant account for <strong>{email}</strong>.
      </p>
      <Field label="Full name" error={fields["registration.name"]} required>{(p) => <Input {...p} name="name" autoComplete="name" />}</Field>
      <Field label="Password" error={fields["registration.password"]} hint="At least 10 characters, with letters and numbers" required>{(p) => <Input {...p} name="password" type="password" autoComplete="new-password" />}</Field>
      <Checkbox name="acceptPrivacy" label={<>I have read the <Link href="/privacy" className="font-medium text-emerald-700 underline" target="_blank">privacy notice</Link>.</>} />
      {ackBox}
      <FormError message={error} />
      <Button type="submit" size="lg" className="w-full" disabled={!ack} loading={pending}>
        Create account and join
      </Button>
    </form>
  );
}

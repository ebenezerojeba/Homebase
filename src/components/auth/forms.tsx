"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";

function useForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setPending(true);
    setError(null);
    setFields({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.details ?? {});
      } else setError("Something went wrong");
    } finally {
      setPending(false);
    }
  }
  return { pending, error, fields, submit };
}

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const f = useForm();
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const r = await f.submit(() => api<{ redirectTo: string }>("/api/auth/login", { body: { email: fd.get("email"), password: fd.get("password") } }));
        if (r) {
          const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
          // Only same-site relative paths are honoured (no open redirect); role layouts re-check access.
          router.push(safeNext && (safeNext.startsWith(r.redirectTo) || safeNext.startsWith("/invite/")) ? safeNext : r.redirectTo);
          router.refresh();
        }
      }}
    >
      <Field label="Email" error={f.fields.email}>{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
      <Field label="Password" error={f.fields.password}>{(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}</Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-emerald-700 hover:underline">
          Forgot password?
        </Link>
      </div>
      <FormError message={f.error} />
      <Button type="submit" size="lg" className="w-full" loading={f.pending}>
        Sign in
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const f = useForm();
  const [done, setDone] = useState<string | null>(null);
  const [role, setRole] = useState<"landlord" | "tenant">("landlord");
  if (done) return <Alert tone="success" title="Check your email">{done}</Alert>;
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const r = await f.submit(() =>
          api<{ message: string }>("/api/auth/register", {
            body: { name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), phone: fd.get("phone") || undefined, role, acceptPrivacy: fd.get("acceptPrivacy") === "on" },
          }),
        );
        if (r) setDone(r.message);
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-800">I am a…</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["landlord", "tenant"] as const).map((r) => (
            <label key={r} className={`cursor-pointer rounded-xl border px-4 py-3 text-sm ${role === r ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-600/15" : "border-cream-300 bg-white"}`}>
              <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
              <span className="block font-semibold capitalize text-ink-900">{r}</span>
              <span className="text-xs text-ink-500">{r === "landlord" ? "I let out property" : "I rent a home"}</span>
            </label>
          ))}
        </div>
        {role === "tenant" ? <p className="mt-2 text-xs text-ink-500">Tip: if your landlord sent you an invitation link, use it instead — it connects you to your tenancy automatically.</p> : null}
      </fieldset>
      <Field label="Full name" error={f.fields.name} required>{(p) => <Input {...p} name="name" autoComplete="name" />}</Field>
      <Field label="Email" error={f.fields.email} required>{(p) => <Input {...p} name="email" type="email" autoComplete="email" />}</Field>
      <Field label="Phone (optional)" error={f.fields.phone} hint="Nigerian number, e.g. 0803 123 4567">{(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" />}</Field>
      <Field label="Password" error={f.fields.password} hint="At least 10 characters, with letters and numbers" required>{(p) => <Input {...p} name="password" type="password" autoComplete="new-password" />}</Field>
      <Checkbox name="acceptPrivacy" label={<>I have read the <Link href="/privacy" className="font-medium text-emerald-700 underline" target="_blank">privacy notice</Link> and agree to my data being processed to provide this service.</>} />
      {f.fields.acceptPrivacy ? <p className="text-xs font-medium text-rose-700">{f.fields.acceptPrivacy[0]}</p> : null}
      <FormError message={f.error} />
      <Button type="submit" size="lg" className="w-full" loading={f.pending}>
        Create account
      </Button>
    </form>
  );
}

export function VerifyEmail({ token }: { token: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: "working" | "error"; message?: string }>(token ? { status: "working" } : { status: "error", message: "This link is missing its token." });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) return;
    api<{ redirectTo: string }>("/api/auth/verify-email", { body: { token } })
      .then((r) => {
        router.replace(r.redirectTo);
        router.refresh();
      })
      .catch((e: Error) => setState({ status: "error", message: e.message }));
  }, [token, router]);
  if (state.status === "working") return <p className="text-sm text-ink-600" role="status">Verifying your email…</p>;
  return (
    <div className="space-y-4">
      <Alert tone="error">{state.message}</Alert>
      <Link href="/login" className="text-sm font-medium text-emerald-700 hover:underline">
        Go to sign in
      </Link>
    </div>
  );
}

export function ForgotPasswordForm() {
  const f = useForm();
  const [done, setDone] = useState<string | null>(null);
  if (done) return <Alert tone="success">{done}</Alert>;
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const r = await f.submit(() => api<{ message: string }>("/api/auth/forgot-password", { body: { email: fd.get("email") } }));
        if (r) setDone(r.message);
      }}
    >
      <Field label="Email" error={f.fields.email}>{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
      <FormError message={f.error} />
      <Button type="submit" size="lg" className="w-full" loading={f.pending}>
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const f = useForm();
  const [done, setDone] = useState(false);
  if (!token) return <Alert tone="error">This link is invalid. Please request a new one.</Alert>;
  if (done)
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Password updated">You&apos;ve been signed out everywhere. Sign in with your new password.</Alert>
        <Link href="/login" className="text-sm font-medium text-emerald-700 hover:underline">Sign in</Link>
      </div>
    );
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (fd.get("password") !== fd.get("confirm")) {
          await f.submit(() => Promise.reject(new ApiError("Passwords don't match", 422, "VALIDATION", { confirm: ["Passwords don't match"] })));
          return;
        }
        const r = await f.submit(() => api("/api/auth/reset-password", { body: { token, password: fd.get("password") } }));
        if (r) setDone(true);
      }}
    >
      <Field label="New password" error={f.fields.password} hint="At least 10 characters, with letters and numbers">{(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required />}</Field>
      <Field label="Confirm new password" error={f.fields.confirm}>{(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}</Field>
      <FormError message={f.error} />
      <Button type="submit" size="lg" className="w-full" loading={f.pending}>
        Update password
      </Button>
    </form>
  );
}

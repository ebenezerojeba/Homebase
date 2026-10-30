"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useToast } from "@/components/ui/toast";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/** JSON fetch to our own API. Same-origin cookies carry the session; the server checks Origin for CSRF. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(typeof navigator !== "undefined" && !navigator.onLine ? "You appear to be offline. Check your connection and try again." : "Network error. Please try again.", 0, "NETWORK");
  }
  const data = (await res.json().catch(() => null)) as { error?: { message: string; code: string; details?: Record<string, string[]> } } | null;
  if (!res.ok) {
    // Session expired mid-use: send to sign-in. Auth endpoints return 401 for bad credentials, so skip those.
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/") && !path.startsWith("/api/invitations/")) {
      window.location.assign(new URL(`/login?next=${encodeURIComponent(window.location.pathname)}`, window.location.origin).toString());
    }
    throw new ApiError(data?.error?.message ?? "Something went wrong", res.status, data?.error?.code ?? "ERROR", data?.error?.details);
  }
  return data as T;
}

/**
 * Wraps a mutation: tracks pending state, field errors and a form-level error,
 * shows a toast on success, and refreshes server components.
 */
export function useAction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Promise<TResult>, opts: { success?: string; refresh?: boolean; onSuccess?: (r: TResult) => void } = {}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setPending(true);
      setError(null);
      setFieldErrors({});
      try {
        const r = await fn(...args);
        if (opts.success) toast.success(opts.success);
        opts.onSuccess?.(r);
        if (opts.refresh !== false) router.refresh();
        return r;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("Something went wrong", 0, "ERROR");
        setError(err.message);
        setFieldErrors(err.details ?? {});
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, router, toast],
  );
  return { run, pending, error, fieldErrors, setError };
}

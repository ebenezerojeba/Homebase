"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return (
    <div className="no-print border-b border-amber-700/15 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 sm:px-6 lg:px-8" role="status">
      Please verify <strong className="font-semibold">{email}</strong> to create tenancies, invite tenants and record payments.{" "}
      <button
        className="font-semibold underline underline-offset-2 disabled:opacity-60"
        disabled={state === "sending" || state === "sent"}
        onClick={async () => {
          setState("sending");
          try {
            await api("/api/auth/resend-verification", { method: "POST" });
            setState("sent");
          } catch {
            setState("error");
          }
        }}
      >
        {state === "sent" ? "Link sent — check your inbox" : state === "sending" ? "Sending…" : state === "error" ? "Try again" : "Resend link"}
      </button>
    </div>
  );
}

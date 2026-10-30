"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { api } from "@/lib/api-client";

export function MockCheckout({ reference }: { reference: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(outcome: string) {
    setPending(outcome);
    setError(null);
    try {
      const r = await api<{ redirectTo: string }>("/api/dev/mock-checkout", { body: { reference, outcome } });
      router.push(r.redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setPending(null);
    }
  }
  return (
    <div className="mt-5 space-y-2">
      <Button className="w-full" loading={pending === "success"} disabled={!!pending} onClick={() => go("success")}>Simulate successful payment</Button>
      <Button className="w-full" variant="outline" loading={pending === "failed"} disabled={!!pending} onClick={() => go("failed")}>Simulate failed payment</Button>
      <Button className="w-full" variant="outline" loading={pending === "wrong_amount"} disabled={!!pending} onClick={() => go("wrong_amount")}>Simulate wrong amount</Button>
      <Button className="w-full" variant="ghost" loading={pending === "abandoned"} disabled={!!pending} onClick={() => go("abandoned")}>Cancel checkout</Button>
      <FormError message={error} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "./print-button";
import { ReceiptDocument } from "./receipt";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/server/auth/actor";
import { getReceiptForActor } from "@/server/services/payments";

export async function ReceiptPage({ actor, id, back }: { actor: Actor; id: string; back: string }) {
  const data = await getReceiptForActor(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={back} className="text-sm text-emerald-700 hover:underline">← Back</Link>
        <PrintButton />
      </div>
      <ReceiptDocument data={data} />
    </div>
  );
}

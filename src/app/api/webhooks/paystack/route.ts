import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { reportError } from "@/lib/logger";
import { paymentProvider } from "@/server/providers/payments";
import { processWebhook } from "@/server/services/payments";

export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

/**
 * Paystack webhook. Public, authenticated by HMAC-SHA512 signature over the raw body.
 * Only acknowledges (200) once the event is durably recorded; errors return 500 so Paystack retries.
 */
export async function POST(req: NextRequest) {
  try {
    if (env().PAYMENT_PROVIDER !== "paystack") return NextResponse.json({ error: "not enabled" }, { status: 404 });
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
    const res = await processWebhook(paymentProvider(), raw, req.headers.get("x-paystack-signature"));
    return NextResponse.json({ result: res.result }, { status: res.httpStatus });
  } catch (e) {
    await reportError(e, { where: "paystack_webhook" });
    return NextResponse.json({ error: "error" }, { status: 500 });
  }
}

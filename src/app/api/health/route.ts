import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pingDb } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness for uptime monitors. Reports configuration modes, never secrets. */
export async function GET() {
  let configOk = true;
  let modes: Record<string, string> = {};
  try {
    const e = env();
    modes = { payments: e.PAYMENT_PROVIDER, storage: e.STORAGE_DRIVER, email: e.EMAIL_PROVIDER };
  } catch {
    configOk = false;
  }
  const db = configOk ? await pingDb() : false;
  const ok = configOk && db;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks: { config: configOk, database: db }, modes, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

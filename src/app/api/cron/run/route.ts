import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { reportError } from "@/lib/logger";
import { runScheduledTasks } from "@/server/services/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Called by Vercel Cron (Authorization: Bearer $CRON_SECRET). Safe to call repeatedly. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runScheduledTasks());
  } catch (e) {
    await reportError(e, { where: "cron" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

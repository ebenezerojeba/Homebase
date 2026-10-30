import { NextResponse, type NextRequest } from "next/server";
import { applyUnsubscribe, verifyUnsubscribe } from "@/server/services/unsubscribe";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe (mail providers POST here without cookies or an Origin header),
 * and the confirmation form on /email/unsubscribe. Authorised only by the signed link.
 */
export async function POST(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const v = verifyUnsubscribe(p.get("u"), p.get("t"), p.get("s"));
  if (!v) return NextResponse.json({ error: "invalid link" }, { status: 400 });
  await applyUnsubscribe(v.userId, v.type);
  const form = await req.formData().catch(() => null);
  if (form?.get("from") === "page") {
    return NextResponse.redirect(new URL(`/email/unsubscribe?done=1`, req.nextUrl.origin), 303);
  }
  return NextResponse.json({ ok: true });
}

import "server-only";
import { after, NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { env } from "@/lib/env";
import { AppError, errors } from "@/lib/errors";
import { reportError } from "@/lib/logger";
import type { Role } from "@/server/models/_shared";
import type { Actor } from "./auth/actor";
import { getActor } from "./auth/current";
import { rateLimit, RULES, type RateLimitRule } from "./auth/rate-limit";
import { flushPendingDeliveries } from "./services/notifications";

/** Deliver emails queued by a mutation right after the response is sent (cron retries anything left). */
function flushAfterResponse(req: NextRequest) {
  if (req.method === "GET") return;
  after(async () => {
    await flushPendingDeliveries({ limit: 10 }).catch(() => {});
  });
}

type Params = Record<string, string | string[]>;

interface Ctx<P extends Params> {
  req: NextRequest;
  params: P;
  actor: Actor;
}
interface PublicCtx<P extends Params> {
  req: NextRequest;
  params: P;
  actor: Actor | null;
}

interface Options {
  roles?: Role[];
  rateLimit?: RateLimitRule;
  /** Skip the same-origin check (only for provider webhooks and cron, which authenticate by signature/secret). */
  skipOriginCheck?: boolean;
  requireVerifiedEmail?: boolean;
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * CSRF defence for cookie-authenticated mutations: SameSite=Lax cookies plus a strict
 * Origin (or Referer) check against APP_URL on every non-GET request.
 */
export function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const expected = new URL(env().APP_URL).origin;
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const actual = origin ?? (referer ? new URL(referer).origin : null);
  const self = req.nextUrl.origin;
  if (!actual || (actual !== expected && actual !== self)) {
    throw errors.forbidden("Cross-origin request blocked");
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_";
      (details[key] ??= []).push(issue.message);
    }
    return NextResponse.json({ error: { code: "VALIDATION", message: "Please check the highlighted fields", details } }, { status: 422 });
  }
  void reportError(e, { where: "api" });
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500 });
}

async function resolveParams<P extends Params>(ctx: { params: Promise<P> } | undefined): Promise<P> {
  return ctx ? await ctx.params : ({} as P);
}

/** Authenticated API route. */
export function authed<P extends Params = Params>(
  opts: Options,
  handler: (ctx: Ctx<P>) => Promise<Response | unknown>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }) => {
    try {
      if (!opts.skipOriginCheck) assertSameOrigin(req);
      const actor = await getActor();
      if (!actor) throw errors.unauthenticated();
      if (opts.roles?.length && !opts.roles.includes(actor.role)) throw errors.forbidden();
      if (opts.requireVerifiedEmail && !actor.emailVerified) {
        throw errors.forbidden("Please verify your email address first");
      }
      if (req.method !== "GET") await rateLimit(opts.rateLimit ?? RULES.mutation, actor.userId);
      else if (opts.rateLimit) await rateLimit(opts.rateLimit, actor.userId);
      const result = await handler({ req, params: await resolveParams(routeCtx), actor });
      flushAfterResponse(req);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Public API route (login, register, webhooks). */
export function open<P extends Params = Params>(
  opts: Omit<Options, "roles" | "requireVerifiedEmail">,
  handler: (ctx: PublicCtx<P>) => Promise<Response | unknown>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }) => {
    try {
      if (!opts.skipOriginCheck) assertSameOrigin(req);
      if (opts.rateLimit) await rateLimit(opts.rateLimit, clientIp(req));
      const actor = opts.skipOriginCheck ? null : await getActor();
      const result = await handler({ req, params: await resolveParams(routeCtx), actor });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function parseJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw errors.badRequest("Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

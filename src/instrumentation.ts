import type { Instrumentation } from "next";

/** Validate configuration at server start so misconfiguration fails fast, not on first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { env } = await import("@/lib/env");
    env();
  }
}

/** Structured, redacted reporting of every server rendering / route error. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { reportError } = await import("@/lib/logger");
  await reportError(error, { path: request.path, method: request.method, routeType: context.routeType, routePath: context.routePath });
};

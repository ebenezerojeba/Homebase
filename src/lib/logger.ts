/**
 * Minimal structured JSON logger with field redaction.
 * Never log passwords, tokens, secrets, card data or full request bodies.
 */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = /pass(word)?|secret|token|authorization|cookie|signature|api[-_]?key|card|cvv|pin|otp|hash/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level | undefined) ?? (process.env.NODE_ENV === "test" ? "error" : "info");
  return order[lvl] ?? order.info;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};

/**
 * Error reporting hook. Logs structurally and, if ERROR_WEBHOOK_URL is set,
 * forwards a redacted summary (e.g. to a Slack/Sentry-compatible relay).
 */
export async function reportError(error: unknown, context: Record<string, unknown> = {}) {
  logger.error("unhandled_error", { error, ...context });
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(redact({ message: e.message, name: e.name, context, at: new Date().toISOString() })),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // never let error reporting throw
  }
}

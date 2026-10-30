import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once at first use.
 * Anything that must never reach the browser lives here (no NEXT_PUBLIC_ prefix).
 */
const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_NAME: z.string().min(1).default("Homebase"),
    APP_URL: z.url().default("http://localhost:3000"),
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    MONGODB_DB: z.string().optional(),
    /** Set to "false" only on deployments that cannot run multi-document transactions. */
    MONGODB_TRANSACTIONS: z.enum(["auto", "true", "false"]).default("auto"),

    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    /** Used to HMAC rate-limit keys and similar non-password secrets. */
    APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),

    PAYMENT_PROVIDER: z.enum(["paystack", "mock", "disabled"]).default("disabled"),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_PUBLIC_KEY: z.string().optional(),
    PAYSTACK_BASE_URL: z.url().default("https://api.paystack.co"),

    STORAGE_DRIVER: z.enum(["cloudinary", "local"]).default("local"),
    /** Development only. Defaults outside the project so the dev file watcher ignores uploads. */
    LOCAL_STORAGE_DIR: z.string().optional(),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    /** Preferred: the single "API environment variable" from the Cloudinary dashboard. */
    CLOUDINARY_URL: z.string().regex(/^cloudinary:\/\/[^:]+:[^@]+@.+$/, "Expected cloudinary://API_KEY:API_SECRET@CLOUD_NAME").optional(),
    CLOUDINARY_FOLDER: z.string().default("homebase"),

    EMAIL_PROVIDER: z.enum(["smtp", "brevo", "console", "disabled"]).default("console"),
    /** For EMAIL_PROVIDER=smtp: smtps://USER:PASSWORD@smtp.gmail.com:465 (URL-encode special characters). */
    SMTP_URL: z.string().regex(/^smtps?:\/\/.+/, "Expected smtp(s)://user:password@host:port").optional(),
    BREVO_API_KEY: z.string().optional(),
    EMAIL_FROM_ADDRESS: z.email().default("no-reply@example.com"),
    EMAIL_FROM_NAME: z.string().default("Homebase"),

    CRON_SECRET: z.string().min(16).optional(),
    REMINDER_DAYS_BEFORE: z
      .string()
      .default("7,3,1")
      .transform((s) =>
        s
          .split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 60),
      ),
    OVERDUE_REMINDER_DAYS: z
      .string()
      .default("1,7,14")
      .transform((s) =>
        s
          .split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 90),
      ),
    RENEWAL_REMINDER_DAYS: z
      .string()
      .default("60,30")
      .transform((s) =>
        s
          .split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365),
      ),

    /** SMS: disabled | console (dev log) | termii */
    SMS_PROVIDER: z.enum(["termii", "console", "disabled"]).default("disabled"),
    TERMII_API_KEY: z.string().optional(),
    TERMII_SENDER_ID: z.string().max(11).optional(),
    /** "dnd" reaches numbers on Do-Not-Disturb (transactional route); "generic" is cheaper but blocked for DND numbers. */
    TERMII_CHANNEL: z.enum(["dnd", "generic"]).default("dnd"),
    /** Your account's base URL from the Termii dashboard. */
    TERMII_BASE_URL: z.url().default("https://api.ng.termii.com"),

    /** WhatsApp: disabled | console (dev log) | meta (WhatsApp Cloud API) */
    WHATSAPP_PROVIDER: z.enum(["meta", "console", "disabled"]).default("disabled"),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v22.0"),
    /** Approved "utility" template with two body variables: {{1}} = title, {{2}} = details. */
    WHATSAPP_NOTIFICATION_TEMPLATE: z.string().default("homebase_update"),
    /** Approved "authentication" template (one-time code with copy-code button). */
    WHATSAPP_OTP_TEMPLATE: z.string().default("homebase_code"),
    WHATSAPP_TEMPLATE_LANG: z.string().default("en"),

    /** No SMS/WhatsApp between these hours (Africa/Lagos); messages wait until the end of quiet hours. */
    QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(21),
    QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(7),

    ERROR_WEBHOOK_URL: z.url().optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    ALLOW_MOCK_IN_PRODUCTION: bool,
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === "paystack" && !env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({ code: "custom", path: ["PAYSTACK_SECRET_KEY"], message: "Required when PAYMENT_PROVIDER=paystack" });
    }
    if (env.STORAGE_DRIVER === "cloudinary" && !env.CLOUDINARY_URL) {
      for (const k of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const) {
        if (!env[k]) ctx.addIssue({ code: "custom", path: [k], message: "Set CLOUDINARY_URL (or the three CLOUDINARY_* keys) when STORAGE_DRIVER=cloudinary" });
      }
    }
    if (env.SMS_PROVIDER === "termii") {
      if (!env.TERMII_API_KEY) ctx.addIssue({ code: "custom", path: ["TERMII_API_KEY"], message: "Required when SMS_PROVIDER=termii" });
      if (!env.TERMII_SENDER_ID) ctx.addIssue({ code: "custom", path: ["TERMII_SENDER_ID"], message: "Required when SMS_PROVIDER=termii" });
    }
    if (env.WHATSAPP_PROVIDER === "meta") {
      if (!env.WHATSAPP_ACCESS_TOKEN) ctx.addIssue({ code: "custom", path: ["WHATSAPP_ACCESS_TOKEN"], message: "Required when WHATSAPP_PROVIDER=meta" });
      if (!env.WHATSAPP_PHONE_NUMBER_ID) ctx.addIssue({ code: "custom", path: ["WHATSAPP_PHONE_NUMBER_ID"], message: "Required when WHATSAPP_PROVIDER=meta" });
    }
    if (env.EMAIL_PROVIDER === "smtp" && !env.SMTP_URL) {
      ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "Required when EMAIL_PROVIDER=smtp" });
    }
    if (env.EMAIL_PROVIDER === "brevo" && !env.BREVO_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["BREVO_API_KEY"], message: "Required when EMAIL_PROVIDER=brevo" });
    }
    // A production build served on localhost (local smoke/e2e tests) can't be a real deployment,
    // so only there are http and local disk storage tolerated. Every real domain gets all checks.
    const local = isLocalUrl(env.APP_URL);
    if (env.NODE_ENV === "production") {
      if (!env.APP_URL.startsWith("https://") && !local) {
        ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "Must use https in production" });
      }
      if (!env.CRON_SECRET) {
        ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "Required in production" });
      }
      if (env.STORAGE_DRIVER === "local" && !local) {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_DRIVER"],
          message: "Local disk storage is not durable on serverless hosts; use cloudinary in production",
        });
      }
      if (env.PAYMENT_PROVIDER === "mock" && !env.ALLOW_MOCK_IN_PRODUCTION) {
        ctx.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "Mock payments are not allowed in production" });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // Treat blank values ("KEY=") as unset so optional settings can be left empty in env files.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}

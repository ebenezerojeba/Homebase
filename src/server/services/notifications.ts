import "server-only";
import type { ClientSession } from "mongoose";
import { env } from "@/lib/env";
import { errors, isDuplicateKeyError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { connectDb } from "@/server/db";
import { Notification, User, type DeliveryChannel, type NotificationType } from "@/server/models";
import { enabledTextChannels, ProviderSendError, textProvider, type TextChannel } from "@/server/providers/text";
import { emailProvider, renderEmail } from "@/server/providers/email";
import type { Actor } from "@/server/auth/actor";

export const MAX_EMAIL_ATTEMPTS = 5;
export const MAX_DELIVERY_ATTEMPTS = MAX_EMAIL_ATTEMPTS;

/**
 * Only time-sensitive events go to SMS/WhatsApp (each text costs money and attention).
 * Everything else stays in-app and email.
 */
export const TEXT_NOTIFICATION_TYPES: readonly NotificationType[] = [
  "rent_upcoming",
  "rent_due",
  "rent_overdue",
  "payment_claim_submitted",
  "payment_confirmed",
  "payment_rejected",
  "payment_reversed",
  "maintenance_update",
  "tenancy_renewal",
];

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  relatedResourceId?: string | null;
  /** Required: identical keys are delivered once, no matter how many times a job retries. */
  dedupeKey: string;
}

type UserPrefs = { emailOptOut: NotificationType[]; smsEnabled?: boolean; whatsappEnabled?: boolean; phone?: string | null; phoneVerifiedAt?: Date | null };

/** Which channels a notification should go out on, given the user's settings and configured providers. */
export function plannedChannels(user: UserPrefs, type: NotificationType, enabled: TextChannel[]): Record<DeliveryChannel, boolean> {
  const textOk = Boolean(user.phone && user.phoneVerifiedAt) && TEXT_NOTIFICATION_TYPES.includes(type);
  return {
    email: !user.emailOptOut.includes(type),
    sms: textOk && Boolean(user.smsEnabled) && enabled.includes("sms"),
    whatsapp: textOk && Boolean(user.whatsappEnabled) && enabled.includes("whatsapp"),
  };
}

/** Create an in-app notification and queue email/SMS/WhatsApp as the user chose. Idempotent by dedupeKey. */
export async function notify(input: NotifyInput, session?: ClientSession | null): Promise<boolean> {
  const user = await User.findById(input.userId)
    .select("emailOptOut status smsEnabled whatsappEnabled phone phoneVerifiedAt")
    .session(session ?? null)
    .lean();
  if (!user || user.status !== "active") return false;
  const plan = plannedChannels(user, input.type, enabledTextChannels());
  const now = new Date();
  const d = (on: boolean) => ({ status: (on ? "pending" : "skipped") as "pending" | "skipped", attempts: 0, nextAttemptAt: on ? now : null });
  try {
    await Notification.create(
      [
        {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
          relatedResourceId: input.relatedResourceId ?? null,
          dedupeKey: input.dedupeKey,
          email: d(plan.email),
          sms: d(plan.sms),
          whatsapp: d(plan.whatsapp),
        },
      ],
      { session: session ?? undefined },
    );
    return true;
  } catch (e) {
    if (isDuplicateKeyError(e)) return false;
    throw e;
  }
}

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 60_000, 6 * 3600_000); // 2m, 4m, 8m ... capped at 6h
}

/** Hour of day in Lagos (WAT is UTC+1 with no daylight saving). */
function lagosHour(d: Date): number {
  return (d.getUTCHours() + 1) % 24;
}

/** If `now` falls inside quiet hours (Lagos time), the moment they end; otherwise null. */
export function quietHoursEnd(now: Date, start: number, end: number): Date | null {
  if (start === end) return null;
  const h = lagosHour(now);
  const inQuiet = start > end ? h >= start || h < end : h >= start && h < end;
  if (!inQuiet) return null;
  const t = new Date(now);
  t.setUTCHours((end + 23) % 24, 0, 0, 0); // Lagos hour `end` expressed in UTC
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

/**
 * Deliver one channel's queue. Each row is leased atomically before sending, so concurrent runners
 * (cron + post-request flush) never double-send. Failures are retried with backoff; permanent
 * provider rejections (bad number, unapproved template) fail immediately.
 */
export async function flushChannel(
  channel: DeliveryChannel,
  { limit = 25, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<{ sent: number; failed: number; deferred: number }> {
  await connectDb();
  let sent = 0;
  let failed = 0;
  const status = channel + ".status";
  const next = channel + ".nextAttemptAt";
  const textProv = channel === "email" ? null : textProvider(channel);
  if (channel !== "email" && !textProv) {
    // Channel switched off after messages were queued: don't leave them pending forever.
    await Notification.updateMany({ [status]: "pending" }, { $set: { [status]: "skipped", [channel + ".lastError"]: "Channel disabled" } });
    return { sent, failed, deferred: 0 };
  }
  if (channel !== "email") {
    const e = env();
    const until = quietHoursEnd(now, e.QUIET_HOURS_START, e.QUIET_HOURS_END);
    if (until) {
      const res = await Notification.updateMany({ [status]: "pending", [next]: { $lt: until } }, { $set: { [next]: until } });
      return { sent, failed, deferred: res.modifiedCount };
    }
  }
  for (let i = 0; i < limit; i++) {
    const leaseUntil = new Date(now.getTime() + 5 * 60_000);
    const n = await Notification.findOneAndUpdate(
      { [status]: "pending", [next]: { $lte: now } },
      { $set: { [next]: leaseUntil }, $inc: { [channel + ".attempts"]: 1 } },
      { sort: { [next]: 1 }, returnDocument: "after" },
    ).lean();
    if (!n) break;
    const user = await User.findById(n.userId).select("email name status phone phoneVerifiedAt smsEnabled whatsappEnabled").lean();
    const stillWanted =
      !!user &&
      user.status === "active" &&
      (channel === "email" || Boolean(user.phone && user.phoneVerifiedAt && (channel === "sms" ? user.smsEnabled : user.whatsappEnabled)));
    if (!user || !stillWanted) {
      await Notification.updateOne({ _id: n._id }, { $set: { [status]: "skipped" } });
      continue;
    }
    const url = n.link ? new URL(n.link, env().APP_URL).toString() : undefined;
    try {
      let id: string | null;
      if (channel === "email") {
        const { text, html } = renderEmail({ heading: n.title, paragraphs: [n.body], cta: url ? { label: "Open in " + env().APP_NAME, url } : undefined });
        id = (await emailProvider().send({ to: { email: user.email, name: user.name }, subject: n.title, text, html })).id;
      } else {
        id = (await textProv!.sendNotification(user.phone!, { title: n.title, body: n.body, url })).id;
      }
      await Notification.updateOne(
        { _id: n._id },
        { $set: { [status]: "sent", [channel + ".sentAt"]: new Date(), [channel + ".lastError"]: null, [channel + ".providerMessageId"]: id } },
      );
      sent++;
    } catch (e) {
      failed++;
      const attempts = n[channel]?.attempts ?? 1;
      const permanent = e instanceof ProviderSendError && !e.retryable;
      const giveUp = permanent || attempts >= MAX_DELIVERY_ATTEMPTS;
      await Notification.updateOne(
        { _id: n._id },
        {
          $set: {
            [status]: giveUp ? "failed" : "pending",
            [next]: giveUp ? null : new Date(now.getTime() + backoffMs(attempts)),
            [channel + ".lastError"]: (e instanceof Error ? e.message : String(e)).slice(0, 300),
          },
        },
      );
      logger.warn("notification_delivery_failed", { channel, notificationId: n._id.toString(), attempts, giveUp });
    }
  }
  return { sent, failed, deferred: 0 };
}

export async function flushPendingEmails(opts: { limit?: number; now?: Date } = {}) {
  return flushChannel("email", opts);
}

/** Deliver every channel (cron and right after each mutating request). */
export async function flushPendingDeliveries(opts: { limit?: number; now?: Date } = {}) {
  const [email, sms, whatsapp] = await Promise.all([flushChannel("email", opts), flushChannel("sms", opts), flushChannel("whatsapp", opts)]);
  return { email, sms, whatsapp };
}

export async function listNotifications(actor: Actor, opts: { page: number; pageSize: number; unreadOnly?: boolean }) {
  await connectDb();
  const filter: Record<string, unknown> = { userId: actor.userId };
  if (opts.unreadOnly) filter.readAt = null;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .select("type title body link readAt createdAt")
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: actor.userId, readAt: null }),
  ]);
  return { items, total, unread };
}

export async function unreadNotificationCount(actor: Actor): Promise<number> {
  await connectDb();
  return Notification.countDocuments({ userId: actor.userId, readAt: null });
}

export async function markNotificationsRead(actor: Actor, ids: string[] | "all") {
  await connectDb();
  const filter: Record<string, unknown> = { userId: actor.userId, readAt: null };
  if (ids !== "all") {
    if (ids.length === 0) throw errors.badRequest();
    filter._id = { $in: ids };
  }
  const res = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return { updated: res.modifiedCount };
}

export async function updateEmailPreferences(actor: Actor, optOut: NotificationType[]) {
  await connectDb();
  // Account/security emails can't be opted out of.
  const filtered = [...new Set(optOut)].filter((t) => t !== "account" && t !== "invitation");
  await User.updateOne({ _id: actor.userId }, { $set: { emailOptOut: filtered } });
  return { emailOptOut: filtered };
}

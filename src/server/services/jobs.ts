import "server-only";
import { addDays, diffDays, toISODate, todayInBusinessTz } from "@/lib/dates";
import { env } from "@/lib/env";
import { isDuplicateKeyError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { formatKobo } from "@/lib/money";
import { connectDb } from "@/server/db";
import { Job, RentCharge, Tenancy, type IJob } from "@/server/models";
import { flushPendingDeliveries, notify } from "./notifications";
import { CHARGE_LOOKAHEAD_DAYS } from "./ledger";
import { reconcilePendingOnlinePayments } from "./payments";
import { isOverdue } from "./schedule";
import { closeExpiredTenancies, refreshAllActiveTenancies } from "./tenancy";

const LOCK_MS = 10 * 60_000;

export async function enqueueJob(type: string, dedupeKey: string, payload: Record<string, unknown> = {}, runAt = new Date(), maxAttempts = 5) {
  await connectDb();
  try {
    await Job.create({ type, dedupeKey, payload, runAt, maxAttempts });
    return true;
  } catch (e) {
    if (isDuplicateKeyError(e)) return false; // already queued/run
    throw e;
  }
}

type Handler = (job: IJob) => Promise<unknown>;

/* ---------------- Reminder scanning (pure selection + idempotent notifications) ---------------- */

/** Which "days before due" reminder applies today, if any. Only the nearest one fires, so a missed run can't cause a burst. */
export function upcomingReminderOffset(dueDate: Date, today: Date, offsets: number[]): number | null {
  const daysUntil = diffDays(dueDate, today);
  if (daysUntil <= 0) return null;
  const applicable = offsets.filter((d) => d > 0 && daysUntil <= d);
  return applicable.length ? Math.min(...applicable) : null;
}

/** Which overdue milestone applies today (days past due + grace), if any. */
export function overdueReminderMilestone(dueDate: Date, grace: number, today: Date, milestones: number[]): number | null {
  if (!isOverdue(dueDate, grace, today)) return null;
  const daysLate = diffDays(today, addDays(dueDate, grace));
  const applicable = milestones.filter((k) => k <= daysLate);
  return applicable.length ? Math.max(...applicable) : null;
}

export async function scanRentReminders(today = todayInBusinessTz()) {
  await connectDb();
  const e = env();
  const maxBefore = Math.max(0, ...e.REMINDER_DAYS_BEFORE);
  const charges = await RentCharge.find({
    status: { $in: ["open", "partially_paid"] },
    dueDate: { $gte: addDays(today, -400), $lte: addDays(today, maxBefore) },
  })
    .populate<{ tenancyId: { _id: unknown; tenantId: unknown; status: string; gracePeriodDays: number; landlordId: unknown; tenantName: string } }>("tenancyId", "tenantId status gracePeriodDays landlordId tenantName")
    .limit(5000)
    .lean();
  let created = 0;
  for (const c of charges) {
    const t = c.tenancyId;
    // Re-checked at send time: ended/cancelled tenancies and tenants not yet joined get nothing.
    if (!t || t.status !== "active" || !t.tenantId) continue;
    const tenantId = String(t.tenantId);
    const left = c.amountKobo - c.allocatedKobo;
    if (left <= 0) continue;
    const due = toISODate(c.dueDate);
    const before = upcomingReminderOffset(c.dueDate, today, e.REMINDER_DAYS_BEFORE);
    if (before !== null) {
      if (
        await notify({
          userId: tenantId,
          type: "rent_upcoming",
          title: `${c.label} due in ${before} day${before === 1 ? "" : "s"}`,
          body: `Friendly reminder: ${formatKobo(left)} for ${c.label.toLowerCase()} is due on ${due}. If you've already paid, you can ignore this or submit the payment details.`,
          link: "/tenant/payments",
          relatedResourceId: c._id.toString(),
          dedupeKey: `reminder:${c._id}:before:${before}`,
        })
      )
        created++;
      continue;
    }
    if (toISODate(c.dueDate) === toISODate(today)) {
      if (
        await notify({
          userId: tenantId,
          type: "rent_due",
          title: `${c.label} is due today`,
          body: `${formatKobo(left)} for ${c.label.toLowerCase()} is due today (${due}).`,
          link: "/tenant/payments",
          relatedResourceId: c._id.toString(),
          dedupeKey: `reminder:${c._id}:due`,
        })
      )
        created++;
      continue;
    }
    const milestone = overdueReminderMilestone(c.dueDate, t.gracePeriodDays, today, e.OVERDUE_REMINDER_DAYS);
    if (milestone !== null) {
      if (
        await notify({
          userId: tenantId,
          type: "rent_overdue",
          title: `${c.label} past due`,
          body: `Our records show ${formatKobo(left)} for ${c.label.toLowerCase()} (due ${due}) is still outstanding. If you've paid, please submit the details so your landlord can confirm it, or message your landlord.`,
          link: "/tenant/payments",
          relatedResourceId: c._id.toString(),
          dedupeKey: `reminder:${c._id}:overdue:${milestone}`,
        })
      )
        created++;
    }
  }
  return { scanned: charges.length, created };
}

export async function scanRenewalReminders(today = todayInBusinessTz()) {
  await connectDb();
  const offsets = env().RENEWAL_REMINDER_DAYS;
  const max = Math.max(0, ...offsets);
  const tenancies = await Tenancy.find({ status: "active", renewedToId: null, endDate: { $gte: today, $lte: addDays(today, max) } })
    .select("tenantId landlordId tenantName endDate")
    .lean();
  let created = 0;
  for (const t of tenancies) {
    const offset = upcomingReminderOffset(t.endDate, today, offsets);
    if (offset === null) continue;
    const end = toISODate(t.endDate);
    created += Number(
      await notify({
        userId: t.landlordId.toString(),
        type: "tenancy_renewal",
        title: `Tenancy for ${t.tenantName} ends ${end}`,
        body: `The tenancy ends in about ${offset} days. You can record a renewal or plan the end of tenancy.`,
        link: `/landlord/tenancies/${t._id}`,
        dedupeKey: `renewal:${t._id}:landlord:${offset}`,
      }),
    );
    if (t.tenantId) {
      created += Number(
        await notify({
          userId: t.tenantId.toString(),
          type: "tenancy_renewal",
          title: `Your tenancy ends on ${end}`,
          body: `Your recorded tenancy ends in about ${offset} days. Speak with your landlord about renewal if you plan to stay.`,
          link: `/tenant/tenancy`,
          dedupeKey: `renewal:${t._id}:tenant:${offset}`,
        }),
      );
    }
  }
  return { created };
}

const HANDLERS: Record<string, Handler> = {
  "ledger.generate_charges": () => refreshAllActiveTenancies(addDays(todayInBusinessTz(), CHARGE_LOOKAHEAD_DAYS)),
  "tenancy.close_expired": () => closeExpiredTenancies(),
  "reminders.rent": () => scanRentReminders(),
  "reminders.renewal": () => scanRenewalReminders(),
  "payments.reconcile_online": () => reconcilePendingOnlinePayments(),
};

/** Claim and run due jobs. A job's lock expires, so a crashed run is retried by the next invocation. */
export async function runDueJobs(limit = 20, now = new Date()) {
  await connectDb();
  const ran: { type: string; status: string }[] = [];
  for (let i = 0; i < limit; i++) {
    const job = await Job.findOneAndUpdate(
      {
        $or: [
          { status: "queued", runAt: { $lte: now } },
          { status: "running", lockedUntil: { $lt: now } },
        ],
      },
      { $set: { status: "running", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
      { sort: { runAt: 1 }, returnDocument: "after" },
    ).lean();
    if (!job) break;
    const handler = HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job);
      await Job.updateOne({ _id: job._id }, { $set: { status: "succeeded", completedAt: new Date(), lockedUntil: null, lastError: null } });
      ran.push({ type: job.type, status: "succeeded" });
    } catch (e) {
      const dead = job.attempts >= job.maxAttempts;
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: dead ? "dead" : "queued",
            runAt: new Date(now.getTime() + Math.min(2 ** job.attempts * 60_000, 3600_000)),
            lockedUntil: null,
            lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500),
          },
        },
      );
      logger.error("job_failed", { type: job.type, attempts: job.attempts, dead, error: e });
      ran.push({ type: job.type, status: dead ? "dead" : "retrying" });
    }
  }
  return ran;
}

/**
 * Entry point for the scheduler (Vercel Cron → /api/cron/run). Enqueues today's tasks exactly once
 * per day (dedupe keys), runs whatever is due, and retries failed email deliveries.
 */
export async function runScheduledTasks(now = new Date()) {
  const day = toISODate(todayInBusinessTz(now));
  const hour = now.toISOString().slice(0, 13);
  // Order matters: generate charges and close tenancies before reminders read them.
  const daily = ["ledger.generate_charges", "tenancy.close_expired", "reminders.rent", "reminders.renewal"];
  for (const [i, type] of daily.entries()) {
    await enqueueJob(type, `${type}:${day}`, {}, new Date(now.getTime() + i));
  }
  await enqueueJob("payments.reconcile_online", `payments.reconcile_online:${hour}`, {}, now);
  const jobs = await runDueJobs(20, new Date(now.getTime() + 10));
  const emails = await flushPendingDeliveries({ limit: 100 });
  return { day, jobs, emails };
}

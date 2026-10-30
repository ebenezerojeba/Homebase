import { describe, expect, it } from "vitest";
import { addDays, todayInBusinessTz } from "@/lib/dates";
import { Job, Notification, RentCharge } from "@/server/models";
import { setEmailProviderForTests, type EmailProvider } from "@/server/providers/email";
import { enqueueJob, runDueJobs, scanRenewalReminders, scanRentReminders } from "@/server/services/jobs";
import { flushPendingEmails, MAX_EMAIL_ATTEMPTS, notify, updateEmailPreferences } from "@/server/services/notifications";
import { endTenancy } from "@/server/services/tenancy";
import { iso, makeJoinedTenancy, makeUser } from "../support/factories";

describe("notification deduplication", () => {
  it("the same dedupe key creates one notification", async () => {
    const u = await makeUser("tenant");
    const input = { userId: u.userId, type: "rent_due" as const, title: "t", body: "b", dedupeKey: "same-key" };
    const results = await Promise.all([notify(input), notify(input), notify(input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await Notification.countDocuments()).toBe(1);
  });

  it("respects email opt-outs but still records in-app", async () => {
    const u = await makeUser("tenant");
    await updateEmailPreferences(u, ["rent_upcoming"]);
    await notify({ userId: u.userId, type: "rent_upcoming", title: "t", body: "b", dedupeKey: "k1" });
    expect((await Notification.findOne().lean())?.email.status).toBe("skipped");
  });
});

describe("email delivery retries", () => {
  it("retries with backoff and stops after max attempts; never double-sends", async () => {
    const u = await makeUser("tenant");
    let calls = 0;
    const failing: EmailProvider = { name: "fail", send: async () => { calls++; throw new Error("SMTP down"); } };
    setEmailProviderForTests(failing);
    await notify({ userId: u.userId, type: "account", title: "t", body: "b", dedupeKey: "retry-1" });
    let now = new Date();
    for (let i = 0; i < MAX_EMAIL_ATTEMPTS + 2; i++) {
      await flushPendingEmails({ now });
      now = new Date(now.getTime() + 7 * 3600_000); // jump past any backoff
    }
    const n = await Notification.findOne().lean();
    expect(calls).toBe(MAX_EMAIL_ATTEMPTS);
    expect(n?.email.status).toBe("failed");
    expect(n?.email.lastError).toMatch(/SMTP down/);
  });

  it("concurrent flushes send each email once", async () => {
    const u = await makeUser("tenant");
    let calls = 0;
    setEmailProviderForTests({ name: "count", send: async () => { calls++; return { id: null }; } });
    await notify({ userId: u.userId, type: "account", title: "t", body: "b", dedupeKey: "once-1" });
    await Promise.all([flushPendingEmails(), flushPendingEmails(), flushPendingEmails()]);
    expect(calls).toBe(1);
    expect((await Notification.findOne().lean())?.email.status).toBe("sent");
  });
});

describe("rent reminders", () => {
  it("schedules an upcoming reminder once, however many times the scan runs", async () => {
    const landlord = await makeUser("landlord");
    // Monthly from 27 days ago -> next charge due in ~3-4 days.
    const { tenancyId } = await makeJoinedTenancy(landlord, { startDate: iso(-27), endDate: iso(338) });
    const next = await RentCharge.findOne({ tenancyId, dueDate: { $gt: todayInBusinessTz() } }).lean();
    expect(next).toBeTruthy();
    await scanRentReminders();
    await scanRentReminders();
    const upcoming = await Notification.find({ type: "rent_upcoming" }).lean();
    expect(upcoming).toHaveLength(1);
  });

  it("sends overdue notices for unpaid past-due charges, factual in tone", async () => {
    const landlord = await makeUser("landlord");
    await makeJoinedTenancy(landlord, { startDate: iso(-3), endDate: iso(362) });
    await scanRentReminders();
    const overdue = await Notification.find({ type: "rent_overdue" }).lean();
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.body).not.toMatch(/legal|evict|court|police/i);
  });

  it("stops reminders after the tenancy ends", async () => {
    const landlord = await makeUser("landlord");
    const { tenancyId } = await makeJoinedTenancy(landlord, { startDate: iso(-3), endDate: iso(362) });
    await endTenancy(landlord, tenancyId, { endDate: iso(0), kind: "terminated", reason: "Moved out" });
    await scanRentReminders();
    expect(await Notification.countDocuments({ type: { $in: ["rent_overdue", "rent_upcoming", "rent_due"] } })).toBe(0);
  });

  it("renewal reminders go to both parties once", async () => {
    const landlord = await makeUser("landlord");
    await makeJoinedTenancy(landlord, { startDate: iso(-340), endDate: iso(25), frequency: "annual" });
    await scanRenewalReminders();
    await scanRenewalReminders();
    expect(await Notification.countDocuments({ type: "tenancy_renewal" })).toBe(2);
  });
});

describe("persistent jobs", () => {
  it("dedupes enqueues and retries failed jobs until they become dead", async () => {
    expect(await enqueueJob("does.not.exist", "k1", {}, new Date(), 2)).toBe(true);
    expect(await enqueueJob("does.not.exist", "k1")).toBe(false);
    let now = new Date();
    await runDueJobs(5, now);
    expect((await Job.findOne().lean())?.status).toBe("queued");
    now = addDays(now, 1);
    await runDueJobs(5, now);
    const j = await Job.findOne().lean();
    expect(j?.status).toBe("dead");
    expect(j?.attempts).toBe(2);
  });

  it("recovers jobs whose worker crashed (expired lock)", async () => {
    await enqueueJob("reminders.renewal", "k2");
    await Job.updateOne({ dedupeKey: "k2" }, { $set: { status: "running", lockedUntil: new Date(Date.now() - 1000) } });
    const ran = await runDueJobs(5);
    expect(ran).toEqual([{ type: "reminders.renewal", status: "succeeded" }]);
  });
});

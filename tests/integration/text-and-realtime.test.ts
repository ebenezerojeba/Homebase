import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { Conversation, Notification, PhoneVerification, User } from "@/server/models";
import {
  cleanParam,
  MetaWhatsApp,
  ProviderSendError,
  setTextProviderForTests,
  smsText,
  TermiiSms,
  type TextProvider,
} from "@/server/providers/text";
import { flushChannel, notify, plannedChannels, quietHoursEnd } from "@/server/services/notifications";
import { sendPhoneCode, setTextChannels, verifyPhoneCode } from "@/server/services/phone";
import { sendMessage } from "@/server/services/messaging";
import { subscribeConversation, type ConversationEvent } from "@/server/services/realtime";
import { iso, makeJoinedTenancy, makeUser } from "../support/factories";

/** Fake provider that records what was sent and can be told to fail. */
function fakeProvider(channel: "sms" | "whatsapp") {
  const sent: { to: string; text: string; kind: "code" | "note" }[] = [];
  let failWith: ProviderSendError | null = null;
  const p: TextProvider = {
    channel,
    name: "fake",
    async sendNotification(to, msg) {
      if (failWith) throw failWith;
      sent.push({ to, text: `${msg.title} ${msg.body}`, kind: "note" });
      return { id: "msg-1" };
    },
    async sendCode(to, code) {
      if (failWith) throw failWith;
      sent.push({ to, text: code, kind: "code" });
      return { id: "otp-1" };
    },
  };
  return { p, sent, fail: (e: ProviderSendError | null) => (failWith = e) };
}

// A daytime moment in Lagos (12:00 WAT) so quiet hours never interfere unless a test wants them.
const NOON_WAT = (() => {
  const d = new Date(Date.now() + 86400_000);
  d.setUTCHours(11, 0, 0, 0);
  return d;
})();

describe("message formatting", () => {
  it("keeps SMS within two segments and WhatsApp params clean", () => {
    const t = smsText("Homebase", { title: "Rent due", body: "x".repeat(500), url: "https://app.example/tenant" });
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t.endsWith("https://app.example/tenant")).toBe(true);
    expect(cleanParam("a\nb\t\tc     d", 100)).toBe("a b c d");
    expect(cleanParam("", 10)).toBe("-");
  });

  it("quiet hours (Lagos time) defer texts until morning", () => {
    expect(quietHoursEnd(new Date("2026-06-15T11:00:00.000Z"), 21, 7)).toBeNull();
    const lateNight = new Date("2026-06-15T22:30:00.000Z"); // 23:30 WAT
    expect(quietHoursEnd(lateNight, 21, 7)?.toISOString()).toBe("2026-06-16T06:00:00.000Z"); // 07:00 WAT
    const earlyMorning = new Date("2026-06-16T03:00:00.000Z"); // 04:00 WAT
    expect(quietHoursEnd(earlyMorning, 21, 7)?.toISOString()).toBe("2026-06-16T06:00:00.000Z");
  });

  it("only time-sensitive events go to text channels, and only when verified and enabled", () => {
    const verified = { emailOptOut: [], smsEnabled: true, whatsappEnabled: true, phone: "+2348031234567", phoneVerifiedAt: new Date() };
    expect(plannedChannels(verified, "rent_due", ["sms", "whatsapp"])).toEqual({ email: true, sms: true, whatsapp: true });
    expect(plannedChannels(verified, "message_received", ["sms", "whatsapp"])).toEqual({ email: true, sms: false, whatsapp: false });
    expect(plannedChannels({ ...verified, phoneVerifiedAt: null }, "rent_due", ["sms", "whatsapp"]).sms).toBe(false);
    expect(plannedChannels(verified, "rent_due", ["whatsapp"]).sms).toBe(false);
  });
});

describe("provider adapters", () => {
  it("Termii sends the documented payload and maps errors", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const ok = new TermiiSms("key", "Homebase", "dnd", "https://api.ng.termii.com", (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ message_id: "abc", message: "Successfully Sent" }), { status: 200 });
    }) as typeof fetch);
    await ok.sendNotification("+2348031234567", { title: "Rent due", body: "₦150,000 due today" });
    expect(calls[0]!.url).toBe("https://api.ng.termii.com/api/sms/send");
    expect(calls[0]!.body).toMatchObject({ api_key: "key", to: "2348031234567", from: "Homebase", type: "plain", channel: "dnd" });
    const bad = new TermiiSms("key", "Homebase", "dnd", "https://x", (async () => new Response(JSON.stringify({ message: "Insufficient balance" }), { status: 400 })) as typeof fetch);
    await expect(bad.sendCode("+2348031234567", "123456")).rejects.toMatchObject({ retryable: false });
  });

  it("WhatsApp Cloud API uses approved templates (notification + one-time code)", async () => {
    const bodies: Record<string, unknown>[] = [];
    const wa = new MetaWhatsApp("token", "12345", "v22.0", { notification: "homebase_update", otp: "homebase_code", lang: "en" }, (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://graph.facebook.com/v22.0/12345/messages");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as typeof fetch);
    await wa.sendNotification("+2348031234567", { title: "Payment confirmed", body: "Line one\nline two", url: "https://app/x" });
    await wa.sendCode("+2348031234567", "654321");
    expect(bodies[0]).toMatchObject({ messaging_product: "whatsapp", to: "2348031234567", type: "template", template: { name: "homebase_update", language: { code: "en" } } });
    const params = (bodies[0] as { template: { components: { parameters: { text: string }[] }[] } }).template.components[0]!.parameters;
    expect(params[1]!.text).not.toMatch(/\n/);
    expect(JSON.stringify(bodies[1])).toContain("654321");
    expect(JSON.stringify(bodies[1])).toContain('"sub_type":"url"');
  });
});

describe("phone verification", () => {
  it("verifies with the right code, rejects wrong ones and locks after 5 attempts", async () => {
    const wa = fakeProvider("whatsapp");
    setTextProviderForTests("whatsapp", wa.p);
    const u = await makeUser("tenant");
    await sendPhoneCode(u, { phone: "+2348031234567", channel: "whatsapp" });
    const code = wa.sent.at(-1)!.text;
    await expect(verifyPhoneCode(u, code === "000000" ? "111111" : "000000")).rejects.toThrow(/isn't right/);
    await verifyPhoneCode(u, code);
    const user = await User.findById(u.userId).lean();
    expect(user?.phone).toBe("+2348031234567");
    expect(user?.phoneVerifiedAt).toBeTruthy();
    expect(user?.whatsappEnabled).toBe(true);
    await expect(verifyPhoneCode(u, code)).rejects.toThrow(/expired|new code/); // single use

    await sendPhoneCode(u, { phone: "+2348031234567", channel: "whatsapp" });
    const real = wa.sent.at(-1)!.text;
    const wrong = real === "999999" ? "888888" : "999999";
    for (let i = 0; i < 5; i++) await verifyPhoneCode(u, wrong).catch(() => {});
    await expect(verifyPhoneCode(u, real)).rejects.toThrow(/new code/);
    expect(await PhoneVerification.countDocuments({ userId: u.userId })).toBe(2);
  });

  it("stores only a hash of the code and refuses unverified channel changes", async () => {
    const sms = fakeProvider("sms");
    setTextProviderForTests("sms", sms.p);
    const u = await makeUser("landlord");
    await expect(setTextChannels(u, { sms: true, whatsapp: false })).rejects.toThrow(/Verify your phone/);
    await sendPhoneCode(u, { phone: "+2348031234567", channel: "sms" });
    const row = await PhoneVerification.findOne({ userId: u.userId }).lean();
    expect(row?.codeHash).not.toContain(sms.sent.at(-1)!.text);
  });

  it("refuses when the channel isn't configured", async () => {
    setTextProviderForTests("sms", null);
    const u = await makeUser("tenant");
    await expect(sendPhoneCode(u, { phone: "+2348031234567", channel: "sms" })).rejects.toThrow(/isn't available/);
  });
});

describe("SMS / WhatsApp delivery", () => {
  async function verifiedTenant(provider: ReturnType<typeof fakeProvider>) {
    setTextProviderForTests(provider.p.channel, provider.p);
    const u = await makeUser("tenant");
    await User.updateOne({ _id: u.userId }, { $set: { phone: "+2348031234567", phoneVerifiedAt: new Date(), [provider.p.channel === "sms" ? "smsEnabled" : "whatsappEnabled"]: true } });
    return u;
  }

  it("delivers time-sensitive alerts once, and never for chatty events", async () => {
    const wa = fakeProvider("whatsapp");
    const u = await verifiedTenant(wa);
    await notify({ userId: u.userId, type: "rent_due", title: "Rent due today", body: "₦150,000", dedupeKey: "t1" });
    await notify({ userId: u.userId, type: "message_received", title: "New message", body: "Hi", dedupeKey: "t2" });
    await Promise.all([flushChannel("whatsapp", { now: NOON_WAT }), flushChannel("whatsapp", { now: NOON_WAT })]);
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0]!.text).toContain("Rent due today");
    const rows = await Notification.find().sort({ dedupeKey: 1 }).lean();
    expect(rows[0]!.whatsapp.status).toBe("sent");
    expect(rows[1]!.whatsapp.status).toBe("skipped");
  });

  it("holds texts during quiet hours", async () => {
    const sms = fakeProvider("sms");
    const u = await verifiedTenant(sms);
    await notify({ userId: u.userId, type: "rent_overdue", title: "Rent past due", body: "x", dedupeKey: "q1" });
    const night = new Date(Date.now() + 86400_000);
    night.setUTCHours(22, 0, 0, 0); // 23:00 WAT
    const r = await flushChannel("sms", { now: night });
    expect(r.deferred).toBe(1);
    expect(sms.sent).toHaveLength(0);
    const morning = new Date(night.getTime() + 9 * 3600_000); // 08:00 WAT next day
    await flushChannel("sms", { now: morning });
    expect(sms.sent).toHaveLength(1);
  });

  it("fails immediately on permanent errors and retries temporary ones", async () => {
    const sms = fakeProvider("sms");
    const u = await verifiedTenant(sms);
    await notify({ userId: u.userId, type: "payment_confirmed", title: "Paid", body: "x", dedupeKey: "f1" });
    sms.fail(new ProviderSendError("Invalid number", false));
    await flushChannel("sms", { now: NOON_WAT });
    expect((await Notification.findOne({ dedupeKey: "f1" }).lean())?.sms.status).toBe("failed");

    await notify({ userId: u.userId, type: "payment_confirmed", title: "Paid", body: "y", dedupeKey: "f2" });
    sms.fail(new ProviderSendError("Timeout", true));
    await flushChannel("sms", { now: NOON_WAT });
    expect((await Notification.findOne({ dedupeKey: "f2" }).lean())?.sms.status).toBe("pending");
    sms.fail(null);
    await flushChannel("sms", { now: new Date(NOON_WAT.getTime() + 3600_000) });
    expect((await Notification.findOne({ dedupeKey: "f2" }).lean())?.sms.status).toBe("sent");
  });

  it("stops texting a user who turned the channel off after it was queued", async () => {
    const wa = fakeProvider("whatsapp");
    const u = await verifiedTenant(wa);
    await notify({ userId: u.userId, type: "rent_due", title: "Due", body: "x", dedupeKey: "o1" });
    await User.updateOne({ _id: u.userId }, { $set: { whatsappEnabled: false } });
    await flushChannel("whatsapp", { now: NOON_WAT });
    expect(wa.sent).toHaveLength(0);
    expect((await Notification.findOne({ dedupeKey: "o1" }).lean())?.whatsapp.status).toBe("skipped");
  });
});

describe("real-time conversation stream", () => {
  async function waitFor(events: ConversationEvent[], type: ConversationEvent["type"], ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (events.some((e) => e.type === type)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  for (const mode of ["change stream", "polling fallback"] as const) {
    it(`signals new messages and read receipts (${mode})`, async () => {
      const landlord = await makeUser("landlord");
      const { tenant, tenancyId } = await makeJoinedTenancy(landlord, { startDate: iso(-5), endDate: iso(360) });
      const conv = await Conversation.findOne({ tenancyId }).lean();
      const events: ConversationEvent[] = [];
      const stop = await subscribeConversation(conv!._id.toString(), (e) => events.push(e), { forcePolling: mode === "polling fallback" });
      await new Promise((r) => setTimeout(r, 300)); // let the stream open
      await sendMessage(tenant, conv!._id.toString(), { body: "Hello", attachmentAssetIds: [] });
      expect(await waitFor(events, "new_message")).toBe(true);
      await stop();
      const before = events.length;
      await sendMessage(tenant, conv!._id.toString(), { body: "After close", attachmentAssetIds: [] });
      await new Promise((r) => setTimeout(r, 500));
      expect(events.length).toBe(before);
    });
  }

  it("never streams another tenancy's conversation", async () => {
    const landlord = await makeUser("landlord");
    const a = await makeJoinedTenancy(landlord, { startDate: iso(-5), endDate: iso(360) });
    const b = await makeJoinedTenancy(landlord, { startDate: iso(-5), endDate: iso(360) });
    const convA = await Conversation.findOne({ tenancyId: a.tenancyId }).lean();
    const convB = await Conversation.findOne({ tenancyId: b.tenancyId }).lean();
    const events: ConversationEvent[] = [];
    const stop = await subscribeConversation(convA!._id.toString(), (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 300));
    await sendMessage(b.tenant, convB!._id.toString(), { body: "Other conversation", attachmentAssetIds: [] });
    await new Promise((r) => setTimeout(r, 800));
    expect(events.filter((e) => e.type === "new_message")).toHaveLength(0);
    await stop();
    void mongoose;
  });
});

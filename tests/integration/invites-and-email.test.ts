import { describe, expect, it } from "vitest";
import { Conversation, Invitation, Notification, User } from "@/server/models";
import { devOutbox, renderEmail, setEmailProviderForTests } from "@/server/providers/email";
import { totalUnreadMessages, listConversations, sendMessage, markConversationRead } from "@/server/services/messaging";
import { flushPendingEmails, notify } from "@/server/services/notifications";
import { createInvitation, getInvitationPreview } from "@/server/services/tenancy";
import { applyUnsubscribe, unsubscribeLinks, verifyUnsubscribe } from "@/server/services/unsubscribe";
import { iso, makeJoinedTenancy, makeTenancy, makeUser } from "../support/factories";

describe("invitation sharing", () => {
  it("returns a working link to the landlord, with or without email", async () => {
    const l = await makeUser("landlord");
    const t = await makeTenancy(l);
    const shared = await createInvitation(l, t._id.toString(), { sendEmail: false });
    expect(shared.emailed).toBe(false);
    expect(devOutbox).toHaveLength(0);
    const token = decodeURIComponent(shared.url.split("/invite/")[1]!);
    expect(await getInvitationPreview(token)).not.toBeNull();

    const emailed = await createInvitation(l, t._id.toString());
    expect(emailed.emailed).toBe(true);
    expect(devOutbox.at(-1)?.text).toContain(emailed.url);
    // The earlier shared link is revoked: only one live link at a time.
    expect(await getInvitationPreview(token)).toBeNull();
    expect(await Invitation.countDocuments({ tenancyId: t._id, status: "pending" })).toBe(1);
  });

  it("still produces a link when the email provider fails", async () => {
    setEmailProviderForTests({ name: "down", send: async () => { throw new Error("SMTP unavailable"); } });
    const l = await makeUser("landlord");
    const t = await makeTenancy(l);
    const r = await createInvitation(l, t._id.toString());
    expect(r.emailed).toBe(false);
    expect(await getInvitationPreview(decodeURIComponent(r.url.split("/invite/")[1]!))).not.toBeNull();
  });

  it("invitation email replies go to the landlord and name them as sender", async () => {
    const sent: { fromName?: string; replyTo?: { email: string } }[] = [];
    setEmailProviderForTests({ name: "spy", send: async (m) => { sent.push(m); return { id: null }; } });
    const l = await makeUser("landlord", { name: "Chidi Okafor" });
    const t = await makeTenancy(l);
    await createInvitation(l, t._id.toString());
    expect(sent[0]?.fromName).toBe("Chidi Okafor via Homebase");
    expect(sent[0]?.replyTo?.email).toBe(l.email);
  });
});

describe("email content", () => {
  it("shows the link as copyable text, not only as a button", () => {
    const { html, text } = renderEmail({ heading: "Hi", paragraphs: ["Body"], cta: { label: "Open", url: "https://app.example/invite/abc" } });
    expect(html.match(/https:\/\/app\.example\/invite\/abc/g)?.length).toBeGreaterThanOrEqual(3); // button href + text link href + visible text
    expect(text).toContain("https://app.example/invite/abc");
    expect(html).not.toMatch(/<img|<script/i);
  });

  it("notification emails carry one-click unsubscribe headers that work", async () => {
    const sent: { headers?: Record<string, string>; html: string }[] = [];
    setEmailProviderForTests({ name: "spy", send: async (m) => { sent.push(m); return { id: null }; } });
    const u = await makeUser("tenant");
    await notify({ userId: u.userId, type: "rent_upcoming", title: "Rent due soon", body: "x", dedupeKey: "u1" });
    await flushPendingEmails();
    const h = sent[0]!.headers!;
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const url = new URL(h["List-Unsubscribe"]!.slice(1, -1));
    const v = verifyUnsubscribe(url.searchParams.get("u"), url.searchParams.get("t"), url.searchParams.get("s"));
    expect(v).toEqual({ userId: u.userId, type: "rent_upcoming" });
    await applyUnsubscribe(v!.userId, v!.type);
    expect((await User.findById(u.userId).lean())?.emailOptOut).toContain("rent_upcoming");
    // Tampered or account-type links are refused.
    expect(verifyUnsubscribe(u.userId, "rent_due", url.searchParams.get("s"))).toBeNull();
    const acct = unsubscribeLinks(u.userId, "account");
    const q = new URL(acct.oneClick).searchParams;
    expect(verifyUnsubscribe(q.get("u"), q.get("t"), q.get("s"))).toBeNull();
    // Account emails get no unsubscribe header.
    await notify({ userId: u.userId, type: "account", title: "Security", body: "x", dedupeKey: "u2" });
    await flushPendingEmails();
    expect(sent[1]!.headers).toBeUndefined();
    void Notification;
  });
});

describe("unread badge", () => {
  it("counts unread messages in one query, matching the per-conversation counts", async () => {
    const l = await makeUser("landlord");
    const a = await makeJoinedTenancy(l, { startDate: iso(-5), endDate: iso(360) });
    const b = await makeJoinedTenancy(l, { startDate: iso(-5), endDate: iso(360) });
    const ca = await Conversation.findOne({ tenancyId: a.tenancyId }).lean();
    const cb = await Conversation.findOne({ tenancyId: b.tenancyId }).lean();
    expect(await totalUnreadMessages(l)).toBe(0);
    await sendMessage(a.tenant, ca!._id.toString(), { body: "1", attachmentAssetIds: [] });
    await sendMessage(a.tenant, ca!._id.toString(), { body: "2", attachmentAssetIds: [] });
    await sendMessage(b.tenant, cb!._id.toString(), { body: "3", attachmentAssetIds: [] });
    await sendMessage(l, cb!._id.toString(), { body: "my own reply doesn't count", attachmentAssetIds: [] });
    const perConv = (await listConversations(l)).reduce((s, c) => s + c.unread, 0);
    expect(await totalUnreadMessages(l)).toBe(perConv);
    expect(perConv).toBe(2); // replying marks b as read up to that point
    await markConversationRead(l, ca!._id.toString());
    expect(await totalUnreadMessages(l)).toBe(0);
  });
});

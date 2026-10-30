import { expect, test, type Page } from "@playwright/test";

import dns from "node:dns";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";

/**
 * Live smoke test. Test accounts use "+hb-test-…" variants of EMAIL_FROM_ADDRESS so any emails land
 * in the owner's inbox. The invitation is created with a known token (equivalent to clicking the
 * emailed link). Everything created is removed in afterAll.
 */
dns.setServers((process.env.DNS_SERVERS ?? "8.8.8.8,1.1.1.1").split(","));
const run = Date.now().toString(36);
const [user, domain] = (process.env.EMAIL_FROM_ADDRESS ?? "owner@example.com").split("@");
const LANDLORD = { name: "HB Test Landlord", email: `${user}+hb-test-landlord-${run}@${domain}`.toLowerCase(), password: "smoke-test-pass-1" };
const TENANT = { name: "HB Test Tenant", email: `${user}+hb-test-tenant-${run}@${domain}`.toLowerCase(), password: "smoke-test-pass-2" };
/** Set SMOKE_SKIP_UPLOADS=1 to skip file uploads (e.g. while storage credentials are being fixed). */
const UPLOADS = process.env.SMOKE_SKIP_UPLOADS !== "1";
const SHOTS = path.join(os.tmpdir(), "homebase-smoke", "shots");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHElEQVR4nGNk+M9AEmAiTfmohlENoxpGNQxpDQDOJAEfVYd9uwAAAABJRU5ErkJggg==",
  "base64",
);

let db: mongoose.mongo.Db;
const created = { userIds: [] as mongoose.Types.ObjectId[] };

async function settle(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

test.beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB });
  db = mongoose.connection.db!;
});

test.afterAll(async () => {
  if (!db) return;
  // Remove everything tied to the test accounts (native driver: app-level append-only guards don't apply).
  const ids = (await db.collection("users").find({ email: { $in: [LANDLORD.email, TENANT.email] } }).project({ _id: 1 }).toArray()).map((u) => u._id);
  const tenancyIds = (await db.collection("tenancies").find({ landlordId: { $in: ids } }).project({ _id: 1 }).toArray()).map((t) => t._id);
  const assets = await db.collection("assets").find({ ownerId: { $in: ids } }).toArray();
  if (assets.length && process.env.CLOUDINARY_URL) {
    const u = new URL(process.env.CLOUDINARY_URL);
    cloudinary.config({ cloud_name: u.hostname, api_key: decodeURIComponent(u.username), api_secret: decodeURIComponent(u.password), secure: true });
    for (const a of assets) {
      const publicId = `${process.env.CLOUDINARY_FOLDER ?? "homebase"}/${String(a.storageKey).replace(/\.[a-z0-9]+$/, "")}`;
      await cloudinary.uploader.destroy(publicId, { resource_type: String(a.mimeType).startsWith("image/") ? "image" : "raw", type: a.access === "public" ? "upload" : "authenticated", invalidate: true }).catch(() => null);
    }
  }
  const byTenancy = { tenancyId: { $in: tenancyIds } };
  const convIds = (await db.collection("conversations").find(byTenancy).project({ _id: 1 }).toArray()).map((c) => c._id);
  await Promise.all([
    db.collection("messages").deleteMany({ conversationId: { $in: convIds } }),
    db.collection("conversations").deleteMany(byTenancy),
    db.collection("rentcharges").deleteMany(byTenancy),
    db.collection("payments").deleteMany(byTenancy),
    db.collection("paymentallocations").deleteMany(byTenancy),
    db.collection("receipts").deleteMany(byTenancy),
    db.collection("timelineevents").deleteMany(byTenancy),
    db.collection("maintenancerequests").deleteMany(byTenancy),
    db.collection("maintenancecomments").deleteMany(byTenancy),
    db.collection("invitations").deleteMany(byTenancy),
    db.collection("inspections").deleteMany(byTenancy),
    db.collection("tenancies").deleteMany({ _id: { $in: tenancyIds } }),
    db.collection("units").deleteMany({ landlordId: { $in: ids } }),
    db.collection("properties").deleteMany({ landlordId: { $in: ids } }),
    db.collection("expenses").deleteMany({ landlordId: { $in: ids } }),
    db.collection("assets").deleteMany({ ownerId: { $in: ids } }),
    db.collection("notifications").deleteMany({ userId: { $in: ids } }),
    db.collection("sessions").deleteMany({ userId: { $in: ids } }),
    db.collection("authtokens").deleteMany({ userId: { $in: ids } }),
    db.collection("auditlogs").deleteMany({ actorId: { $in: ids } }),
    db.collection("users").deleteMany({ _id: { $in: ids } }),
  ]);
  console.log(`cleanup: removed ${ids.length} test users and ${tenancyIds.length} tenancies with their records`);
  await mongoose.disconnect();
});

test("live site: full landlord and tenant journey", async ({ browser }) => {
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

  // Health and public pages.
  const ctx0 = await browser.newContext();
  const h = await ctx0.request.get("/api/health");
  expect((await h.json()).status).toBe("ok");
  expect((await h.json()).modes).toMatchObject({ payments: "paystack", storage: "cloudinary", email: "smtp" });

  // 1. Landlord registers through the real form (verification email goes out via Gmail SMTP).
  const landlord = await (await browser.newContext()).newPage();
  await settle(landlord, "/register");
  await landlord.getByLabel(/^Full name/).fill(LANDLORD.name);
  await landlord.getByLabel(/^Email/).fill(LANDLORD.email);
  await landlord.getByLabel(/^Password/).fill(LANDLORD.password);
  await landlord.getByLabel(/privacy notice/).check();
  await landlord.getByRole("button", { name: "Create account" }).click();
  await expect(landlord.getByText("Check your email")).toBeVisible();
  const lUser = await db.collection("users").findOne({ email: LANDLORD.email });
  expect(lUser).toBeTruthy();
  expect(await db.collection("authtokens").countDocuments({ userId: lUser!._id, type: "email_verify" })).toBe(1);
  // We can't open the inbox, so mark verified directly (the link itself is covered by the automated tests).
  await db.collection("users").updateOne({ _id: lUser!._id }, { $set: { emailVerifiedAt: new Date() } });

  await settle(landlord, "/login");
  await landlord.getByLabel(/^Email/).fill(LANDLORD.email);
  await landlord.getByLabel(/^Password/).fill(LANDLORD.password);
  await landlord.getByRole("button", { name: "Sign in" }).click();
  await expect(landlord).toHaveURL(/\/landlord$/);
  await shot(landlord, "01-landlord-welcome");

  // 2. Property, photo (Cloudinary public image), unit.
  await landlord.getByRole("link", { name: "Add a property" }).first().click();
  await landlord.getByLabel(/^Property name/).fill(`Smoke Test Court ${run}`);
  await landlord.getByLabel(/^Street address/).fill("1 Test Street");
  await landlord.getByLabel(/^City/).fill("Ikeja");
  await landlord.getByLabel(/^LGA/).fill("Ikeja");
  await landlord.getByRole("button", { name: "Add property" }).click();
  await expect(landlord.getByRole("heading", { name: new RegExp(`Smoke Test Court ${run}`) })).toBeVisible();
  if (UPLOADS) {
    await landlord.locator('input[type="file"]').setInputFiles({ name: "front.png", mimeType: "image/png", buffer: PNG });
    await expect(landlord.locator('img[alt="front.png"]')).toBeVisible({ timeout: 60_000 });
    // Served from Cloudinary via the authorised asset route; wait for the (lazy) image to finish loading.
    await landlord.locator('img[alt="front.png"]').scrollIntoViewIfNeeded();
    await expect.poll(() => landlord.locator('img[alt="front.png"]').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  }
  await landlord.getByRole("button", { name: "Add unit" }).click();
  await landlord.getByLabel(/^Unit name/).fill("Flat 1");
  await landlord.getByRole("dialog").getByRole("button", { name: "Add unit" }).click();
  await expect(landlord.getByRole("cell", { name: "Flat 1" })).toBeVisible();

  // 3. Tenancy (invitation email is sent to the tenant test address via SMTP).
  await landlord.getByRole("link", { name: "New tenancy" }).first().click();
  await landlord.getByLabel(/^Tenant's full name/).fill(TENANT.name);
  await landlord.getByLabel(/^Tenant's email/).fill(TENANT.email);
  await landlord.getByLabel(/^Start date/).fill(new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10));
  await landlord.getByLabel(/^End date/).fill(new Date(Date.now() + 362 * 86400_000).toISOString().slice(0, 10));
  await landlord.getByLabel(/^Rent amount/).fill("100");
  await landlord.getByLabel(/^Paid( \*)?$/).selectOption("monthly");
  await landlord.getByRole("button", { name: "Create tenancy" }).click();
  await expect(landlord.getByRole("heading", { name: new RegExp(TENANT.name) })).toBeVisible();
  await expect(landlord.getByText("Invitation sent to")).toBeVisible();
  const tenancyId = landlord.url().split("/").pop()!.split("?")[0]!;

  // 4. Landlord gets a shareable link from the tenancy page (the WhatsApp/SMS path) and the tenant opens it.
  await landlord.getByRole("button", { name: "Get link to share" }).click();
  const linkBox = landlord.getByRole("textbox", { name: "Invitation link" });
  await expect(linkBox).toBeVisible();
  const inviteUrl = await linkBox.inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[\w%-]+$/);
  await expect(landlord.getByRole("link", { name: "Share on WhatsApp" })).toHaveAttribute("href", /wa\.me/);
  await landlord.keyboard.press("Escape");
  // Opening the tenant's link in the landlord's own browser offers "Sign out and continue" instead of a dead end.
  const sameBrowser = await landlord.context().newPage();
  await sameBrowser.goto(inviteUrl);
  await expect(sameBrowser.getByRole("button", { name: "Sign out and continue" })).toBeVisible();
  await sameBrowser.close();
  const tenant = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await settle(tenant, new URL(inviteUrl).pathname);
  await expect(tenant.getByText("₦100.00").first()).toBeVisible();
  await tenant.getByLabel(/^Full name/).fill(TENANT.name);
  await tenant.getByLabel(/^Password/).fill(TENANT.password);
  await tenant.getByLabel(/privacy notice/).check();
  await tenant.getByLabel("I have reviewed these tenancy terms").check();
  await tenant.getByRole("button", { name: "Create account and join" }).click();
  await expect(tenant).toHaveURL(/\/tenant$/);
  await expect(tenant.getByText("Amount due now")).toBeVisible();
  await shot(tenant, "02-tenant-home-mobile");

  // 5. Transfer claim with proof (private Cloudinary file), landlord confirms, receipt issued.
  await tenant.getByRole("button", { name: "I paid by transfer" }).click();
  await tenant.getByLabel(/^Amount paid/).fill("40");
  await tenant.getByLabel(/Transfer reference/).fill(`SMOKE${run}`.toUpperCase());
  if (UPLOADS) {
    await tenant.locator('input[type="file"]').setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: PNG });
    await expect(tenant.getByRole("button", { name: "Remove proof.png" })).toBeVisible({ timeout: 60_000 }); // upload finished
  }
  await tenant.getByRole("button", { name: "Send for confirmation" }).click();
  await expect(tenant.getByText("Sent to your landlord for confirmation")).toBeVisible();

  await settle(landlord, "/landlord/reconciliation");
  if (UPLOADS) {
    const proof = landlord.getByRole("link", { name: "View supporting document" });
    await expect(proof).toBeVisible();
    const proofRes = await landlord.request.get((await proof.getAttribute("href"))!, { maxRedirects: 0 });
    expect(proofRes.status()).toBe(302); // private file: short-lived signed Cloudinary link
    expect(proofRes.headers().location).toMatch(/cloudinary\.com/);
    const anon = await ctx0.request.get((await proof.getAttribute("href"))!, { maxRedirects: 0 });
    expect(anon.status()).toBe(401); // not reachable without a session
  }
  await landlord.getByRole("button", { name: "Confirm received" }).click();
  await landlord.getByRole("button", { name: "Yes, I received it" }).click();
  await expect(landlord.getByText("You're all caught up")).toBeVisible();
  await settle(tenant, "/tenant/receipts");
  await tenant.getByRole("link", { name: /HB-\d{4}-\d{6}/ }).first().click();
  await expect(tenant.getByRole("heading", { name: "Payment receipt" })).toBeVisible();

  // 6. Paystack (test mode): checkout is initialised server-side and redirects to Paystack.
  await settle(tenant, "/tenant/payments");
  await tenant.getByRole("button", { name: "Pay online" }).first().click();
  await tenant.getByRole("button", { name: /Continue to pay/ }).click();
  await tenant.waitForURL(/checkout\.paystack\.com/, { timeout: 60_000 });
  const pay = await db.collection("payments").findOne({ tenancyId: new mongoose.Types.ObjectId(tenancyId), source: "provider" });
  expect(pay?.status).toBe("initiated");
  expect(pay?.providerReference).toMatch(/^HB_/);

  // 7. Maintenance with a photo; landlord updates; tenant sees it.
  await settle(tenant, "/tenant/maintenance/new");
  await tenant.getByLabel("What's the problem?").fill("Smoke test: door handle loose");
  await tenant.getByLabel(/^Details/).fill("Automated production check.");
  await tenant.getByRole("button", { name: "Submit request" }).click();
  await expect(tenant.getByRole("heading", { name: "Smoke test: door handle loose" })).toBeVisible();
  await settle(landlord, "/landlord/maintenance");
  await landlord.getByRole("link", { name: /Smoke test: door handle loose/ }).click();
  await landlord.getByLabel(/^Status/).selectOption("in_progress");
  await landlord.getByRole("button", { name: "Save update" }).click();
  await expect(landlord.getByText("Request updated")).toBeVisible();

  // 8. Real-time chat over the live stream on Vercel.
  await settle(tenant, "/tenant/messages");
  await tenant.getByRole("link", { name: new RegExp(LANDLORD.name) }).click();
  await settle(landlord, "/landlord/messages");
  await landlord.getByRole("link", { name: new RegExp(TENANT.name) }).first().click();
  await expect(tenant.getByText("Live", { exact: true })).toBeVisible();
  await expect(landlord.getByText("Live", { exact: true })).toBeVisible();
  await tenant.getByRole("textbox", { name: "Message" }).fill(`Hello from the smoke test ${run}`);
  await tenant.getByRole("button", { name: "Send" }).click();
  const t0 = Date.now();
  await expect(landlord.getByText(`Hello from the smoke test ${run}`)).toBeVisible({ timeout: 15_000 });
  console.log(`realtime: message appeared on the other screen after ${Date.now() - t0} ms`);
  await shot(landlord, "03-landlord-chat");

  // 9. Shared record, statement, export, access control.
  await settle(tenant, "/tenant/record");
  await expect(tenant.getByText("Landlord-confirmed").first()).toBeVisible();
  const csv = await landlord.request.get(`/api/exports?kind=payments&tenancyId=${tenancyId}`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain(`SMOKE${run}`.toUpperCase());
  expect((await tenant.request.get("/api/exports?kind=expenses")).status()).toBe(403);
  await settle(tenant, "/landlord");
  await expect(tenant).toHaveURL(/\/tenant$/);

  // 10. Email delivery queue: notifications created by this journey went out via SMTP.
  await new Promise((r) => setTimeout(r, 5000));
  const ids = [lUser!._id, (await db.collection("users").findOne({ email: TENANT.email }))!._id];
  const notes = await db.collection("notifications").find({ userId: { $in: ids } }).project({ type: 1, "email.status": 1, "email.lastError": 1 }).toArray();
  const byStatus = notes.reduce<Record<string, number>>((m, n) => ((m[n.email.status] = (m[n.email.status] ?? 0) + 1), m), {});
  console.log("notification emails:", JSON.stringify(byStatus), notes.find((n) => n.email.lastError)?.email.lastError ?? "");
  expect(byStatus.failed ?? 0).toBe(0);
  expect(byStatus.sent ?? 0).toBeGreaterThan(0);

  created.userIds = ids;
});

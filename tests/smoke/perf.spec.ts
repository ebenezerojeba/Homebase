import { expect, test } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";
import dns from "node:dns";
import mongoose from "mongoose";

/**
 * Navigation timing on the live site. Creates a throwaway landlord session directly in the
 * database (no UI noise), measures server response and in-app navigation, then cleans up.
 */
dns.setServers((process.env.DNS_SERVERS ?? "8.8.8.8,1.1.1.1").split(","));
const run = Date.now().toString(36);
let userId: mongoose.Types.ObjectId;
let token: string;
let db: mongoose.mongo.Db;

test.beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB, serverSelectionTimeoutMS: 30000 });
  db = mongoose.connection.db!;
  const now = new Date();
  const r = await db.collection("users").insertOne({
    name: "HB Perf Test", email: `perf-${run}@example.test`, passwordHash: "x", role: "landlord", emailVerifiedAt: now, status: "active",
    emailOptOut: [], smsEnabled: false, whatsappEnabled: false, failedLoginCount: 0, createdAt: now, updatedAt: now,
  });
  userId = r.insertedId;
  token = randomBytes(32).toString("base64url");
  await db.collection("sessions").insertOne({ tokenHash: createHash("sha256").update(token).digest("hex"), userId, role: "landlord", expiresAt: new Date(Date.now() + 3600_000), lastSeenAt: now, revokedAt: null, createdAt: now });
});

test.afterAll(async () => {
  await db?.collection("sessions").deleteMany({ userId });
  await db?.collection("users").deleteMany({ _id: userId });
  await mongoose.disconnect();
});

test("navigation timing", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "__Host-hb_session", value: token, url: baseURL! }]);
  const page = await ctx.newPage();
  const pages = ["/landlord", "/landlord/properties", "/landlord/tenancies", "/landlord/payments", "/landlord/reconciliation", "/landlord/maintenance", "/landlord/reports"];
  const rows: string[] = [];
  // Full page loads (server render time = TTFB).
  for (const p of pages) {
    const res = await page.goto(p);
    expect(res?.status()).toBe(200);
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { ttfb: Math.round(n.responseStart - n.requestStart), load: Math.round(n.loadEventEnd - n.startTime) };
    });
    rows.push(`full load  ${p.padEnd(26)} server ${String(t.ttfb).padStart(5)} ms   total ${t.load} ms`);
  }
  // In-app navigation via the sidebar (what users feel when clicking around).
  await page.goto("/landlord");
  await page.waitForLoadState("networkidle");
  for (const [label, path] of [["Properties", "/landlord/properties"], ["Tenancies", "/landlord/tenancies"], ["Rent & payments", "/landlord/payments"], ["Overview", "/landlord"], ["Properties", "/landlord/properties"]] as const) {
    const t0 = Date.now();
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL((u) => u.pathname === path);
    await page.locator("main h1").first().waitFor();
    rows.push(`click nav  ${label.padEnd(26)} ${String(Date.now() - t0).padStart(5)} ms until content shows`);
  }
  console.log("\n" + rows.join("\n"));
});

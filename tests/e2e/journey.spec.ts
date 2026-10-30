import { expect, test, type Browser, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUTBOX = path.join(os.tmpdir(), "homebase-e2e", "outbox.jsonl");
const run = Date.now().toString(36);
const LANDLORD = { name: "Chidi Okafor", email: `landlord-${run}@example.test`, password: "landlord-pass-123" };
const TENANT = { name: "Amaka Bello", email: `tenant-${run}@example.test`, password: "tenant-pass-1234" };

function linkFromOutbox(to: string, pattern: RegExp): string {
  const lines = existsSync(OUTBOX) ? readFileSync(OUTBOX, "utf8").trim().split("\n") : [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = JSON.parse(lines[i]!) as { to: string; text: string };
    if (m.to !== to) continue;
    const hit = m.text.match(pattern);
    if (hit) return hit[0];
  }
  throw new Error(`No email to ${to} matching ${pattern}`);
}

async function waitForLink(to: string, pattern: RegExp) {
  for (let i = 0; i < 40; i++) {
    try {
      return linkFromOutbox(to, pattern);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return linkFromOutbox(to, pattern);
}

/** Navigate and wait until the dev server has compiled and React has hydrated. */
async function go(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function newPage(browser: Browser, mobile = false): Promise<Page> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  return ctx.newPage();
}

test.beforeAll(() => {
  if (existsSync(OUTBOX)) rmSync(OUTBOX);
});

test("landlord and tenant complete the core journey", async ({ browser }) => {
  // 1. Landlord registers and verifies email.
  const landlord = await newPage(browser);
  await go(landlord, "/register");
  await landlord.getByLabel(/^Full\ name( \*)?$/).fill(LANDLORD.name);
  await landlord.getByLabel(/^Email( \*)?$/).fill(LANDLORD.email);
  await landlord.getByLabel(/^Password( \*)?$/).fill(LANDLORD.password);
  await landlord.getByLabel(/privacy notice/).check();
  await landlord.getByRole("button", { name: "Create account" }).click();
  await expect(landlord.getByText("Check your email")).toBeVisible();
  const verify = await waitForLink(LANDLORD.email, /http:\/\/localhost:\d+\/verify-email\?token=[\w%-]+/);
  await go(landlord, verify);
  await expect(landlord).toHaveURL(/\/landlord$/);
  await expect(landlord.getByRole("heading", { name: /Welcome, Chidi/ })).toBeVisible();

  // 2. Property and unit.
  await landlord.getByRole("link", { name: "Add a property" }).first().click();
  await landlord.getByLabel("Property name").fill("Palm Court");
  await landlord.getByLabel("Street address").fill("12 Admiralty Way");
  await landlord.getByLabel("City / town").fill("Lekki");
  await landlord.getByLabel("LGA").fill("Eti-Osa");
  await landlord.getByRole("button", { name: "Add property" }).click();
  await expect(landlord.getByRole("heading", { name: "Palm Court" })).toBeVisible();
  await landlord.getByRole("button", { name: "Add unit" }).click();
  await landlord.getByLabel("Unit name / number").fill("Flat 2");
  await landlord.getByRole("dialog").getByRole("button", { name: "Add unit" }).click();
  await expect(landlord.getByRole("cell", { name: "Flat 2" })).toBeVisible();

  // 3. Tenancy with invitation (monthly, started 5 days ago so rent is due now).
  await landlord.getByRole("link", { name: "New tenancy" }).first().click();
  await landlord.getByLabel("Tenant's full name").fill(TENANT.name);
  await landlord.getByLabel("Tenant's email").fill(TENANT.email);
  const start = new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 360 * 86400_000).toISOString().slice(0, 10);
  await landlord.getByLabel(/^Start\ date( \*)?$/).fill(start);
  await landlord.getByLabel(/^End\ date( \*)?$/).fill(end);
  await landlord.getByLabel(/^Rent\ amount( \*)?$/).fill("150,000");
  await landlord.getByLabel(/^Paid( \*)?$/).selectOption("monthly");
  await landlord.getByRole("button", { name: "Create tenancy" }).click();
  await expect(landlord.getByRole("heading", { name: new RegExp(TENANT.name) })).toBeVisible();
  await expect(landlord.getByText("₦150,000.00").first()).toBeVisible();

  // 4. Tenant accepts the invitation on a phone-sized screen.
  const invite = await waitForLink(TENANT.email, /http:\/\/localhost:\d+\/invite\/[\w%-]+/);
  const tenant = await newPage(browser, true);
  await go(tenant, invite);
  await expect(tenant.getByText("₦150,000.00").first()).toBeVisible();
  await tenant.getByLabel(/^Full\ name( \*)?$/).fill(TENANT.name);
  await tenant.getByLabel(/^Password( \*)?$/).fill(TENANT.password);
  await tenant.getByLabel(/privacy notice/).check();
  await tenant.getByLabel("I have reviewed these tenancy terms").check();
  await tenant.getByRole("button", { name: "Create account and join" }).click();
  await expect(tenant).toHaveURL(/\/tenant$/);
  await expect(tenant.getByText("Amount due now")).toBeVisible();
  await expect(tenant.getByText("₦150,000.00").first()).toBeVisible();
  await expect(tenant.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" })).toBeVisible();

  // 5. Tenant reports a part payment by bank transfer.
  await tenant.getByRole("button", { name: "I paid by transfer" }).click();
  await tenant.getByLabel(/^Amount\ paid( \*)?$/).fill("50,000");
  await tenant.getByLabel(/Transfer reference/).fill(`FT${run}`);
  await tenant.getByRole("button", { name: "Send for confirmation" }).click();
  await expect(tenant.getByText("Sent to your landlord for confirmation")).toBeVisible();
  await expect(tenant.getByText(/₦50,000.00 reported and awaiting/)).toBeVisible();

  // 6. Landlord confirms it in the payment review workspace.
  await go(landlord, "/landlord/reconciliation");
  await expect(landlord.getByText(/Partial payment: ₦100,000.00 would remain outstanding/)).toBeVisible();
  await landlord.getByRole("button", { name: "Confirm received" }).click();
  await landlord.getByRole("button", { name: "Yes, I received it" }).click();
  await expect(landlord.getByText("You're all caught up")).toBeVisible();

  // 7. Tenant sees the reduced balance and a receipt.
  await go(tenant, "/tenant/receipts");
  await tenant.getByRole("link", { name: /HB-\d{4}-\d{6}/ }).first().click();
  await expect(tenant.getByRole("heading", { name: "Payment receipt" })).toBeVisible();
  await expect(tenant.getByText("₦50,000.00").first()).toBeVisible();
  await go(tenant, "/tenant");
  await expect(tenant.getByText("₦100,000.00").first()).toBeVisible();

  // 8. Tenant pays the rest online through the sandbox checkout; the server verifies it.
  await tenant.getByRole("button", { name: "Pay online" }).click();
  await tenant.getByRole("button", { name: /Continue to pay ₦100,000.00/ }).click();
  await expect(tenant.getByText("Test mode — no real money moves")).toBeVisible();
  await tenant.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(tenant.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();

  // 9. Shared record shows both confirmations, with sources.
  await go(tenant, "/tenant/record");
  await expect(tenant.getByText("Provider-confirmed").first()).toBeVisible();
  await expect(tenant.getByText("Landlord-confirmed").first()).toBeVisible();

  // 10. Maintenance: tenant reports, landlord completes, tenant confirms.
  await go(tenant, "/tenant/maintenance/new");
  await tenant.getByLabel("What's the problem?").fill("Kitchen tap leaking");
  await tenant.getByLabel(/^Details( \*)?$/).fill("Water drips constantly from the kitchen tap.");
  await tenant.getByRole("button", { name: "Submit request" }).click();
  await expect(tenant.getByRole("heading", { name: "Kitchen tap leaking" })).toBeVisible();
  await go(landlord, "/landlord/maintenance");
  await landlord.getByRole("link", { name: /Kitchen tap leaking/ }).click();
  await landlord.getByLabel("Internal note (hidden from tenant)").check();
  await landlord.getByLabel(/Internal note \(only you/).fill("Plumber charges 15k");
  await landlord.getByRole("button", { name: "Save note" }).click();
  await expect(landlord.getByText("Plumber charges 15k")).toBeVisible();
  await landlord.getByLabel(/^Status( \*)?$/).selectOption("completed");
  await landlord.getByRole("button", { name: "Save update" }).click();
  await expect(landlord.getByText("Request updated")).toBeVisible();
  await tenant.reload();
  await expect(tenant.getByText("Plumber charges 15k")).toHaveCount(0);
  await tenant.getByRole("button", { name: "Yes, it's fixed" }).click();
  await expect(tenant.getByText(/Thanks/)).toBeVisible();

  // 11. Messaging.
  await go(tenant, "/tenant/messages");
  await tenant.getByRole("link", { name: new RegExp(LANDLORD.name) }).click();
  await tenant.getByLabel(/^Message( \*)?$/).fill("Thank you for the quick fix!");
  await tenant.getByRole("button", { name: "Send" }).click();
  await expect(tenant.getByText("Thank you for the quick fix!")).toBeVisible();
  await go(landlord, "/landlord/messages");
  await landlord.getByRole("link", { name: new RegExp(TENANT.name) }).first().click();
  await expect(landlord.getByText("Thank you for the quick fix!")).toBeVisible();
  // Real-time: both chats are open; the landlord's reply must appear on the tenant's screen
  // without a reload, well before the 30s fallback poll could fetch it.
  await expect(tenant.getByText("Live", { exact: true })).toBeVisible();
  await expect(landlord.getByText("Live", { exact: true })).toBeVisible();
  await landlord.getByLabel(/^Message( \*)?$/).fill("You're welcome!");
  await landlord.getByRole("button", { name: "Send" }).click();
  await expect(tenant.getByText("You're welcome!")).toBeVisible({ timeout: 10_000 });

  // 12. Access control: tenant can't open landlord pages or guessed ids.
  await go(tenant, "/landlord");
  await expect(tenant).toHaveURL(/\/tenant$/);
  const res = await tenant.request.get("/api/tenancies/000000000000000000000000/timeline");
  expect(res.status()).toBe(404);
  const exportRes = await tenant.request.get("/api/exports?kind=expenses");
  expect(exportRes.status()).toBe(403);
});

test("unauthenticated users are sent to sign in and APIs refuse them", async ({ page }) => {
  await go(page, "/landlord/payments");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.request.get("/api/payments");
  expect(res.status()).toBe(401);
  const xsite = await page.request.post("/api/auth/login", { headers: { origin: "https://evil.example" }, data: { email: "a@b.co", password: "x" } });
  expect(xsite.status()).toBe(403);
});

test("webhook endpoint rejects unsigned requests and cron requires the secret", async ({ request }) => {
  const hook = await request.post("/api/webhooks/paystack", { data: { event: "charge.success" } });
  expect([401, 404]).toContain(hook.status());
  const cron = await request.get("/api/cron/run");
  expect(cron.status()).toBe(401);
  const ok = await request.get("/api/cron/run", { headers: { authorization: "Bearer e2e-cron-secret-123456" } });
  expect(ok.status()).toBe(200);
  const health = await request.get("/api/health");
  expect((await health.json()).status).toBe("ok");
});

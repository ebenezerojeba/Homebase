import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Brand screenshots for visual review (not assertions on pixels). Saved outside the project. */
const OUT = path.join(os.tmpdir(), "homebase-e2e", "visual");
const OUTBOX = path.join(os.tmpdir(), "homebase-e2e", "outbox.jsonl");

test("brand screenshots", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto("/");
  await desktop.waitForLoadState("networkidle");
  await desktop.screenshot({ path: path.join(OUT, "landing.png") });
  await desktop.goto("/login");
  await desktop.screenshot({ path: path.join(OUT, "login.png") });

  const email = `visual-${Date.now()}@example.test`;
  await desktop.goto("/register");
  await desktop.waitForLoadState("networkidle");
  await desktop.getByLabel(/^Full name/).fill("Ngozi Eze");
  await desktop.getByLabel(/^Email/).fill(email);
  await desktop.getByLabel(/^Password/).fill("visual-pass-123");
  await desktop.getByLabel(/privacy notice/).check();
  await desktop.getByRole("button", { name: "Create account" }).click();
  await expect(desktop.getByText("Check your email")).toBeVisible();
  let link = "";
  for (let i = 0; i < 40 && !link; i++) {
    const lines = existsSync(OUTBOX) ? readFileSync(OUTBOX, "utf8").trim().split("\n") : [];
    for (const l of lines) {
      const m = JSON.parse(l) as { to: string; text: string };
      if (m.to === email) link = m.text.match(/http:\/\/localhost:\d+\/verify-email\?token=[\w%-]+/)?.[0] ?? link;
    }
    if (!link) await new Promise((r) => setTimeout(r, 300));
  }
  await desktop.goto(link);
  await expect(desktop).toHaveURL(/\/landlord$/);
  const res = await desktop.request.post("/api/properties", {
    headers: { origin: new URL(desktop.url()).origin },
    data: { name: "Palm Court", propertyType: "apartment_block", address: { line1: "12 Admiralty Way", city: "Lekki", lga: "Eti-Osa", state: "Lagos" } },
  });
  expect(res.ok()).toBe(true);
  await desktop.goto("/landlord");
  await desktop.waitForLoadState("networkidle");
  await desktop.screenshot({ path: path.join(OUT, "landlord-overview.png") });
  await desktop.goto("/landlord/properties");
  await desktop.screenshot({ path: path.join(OUT, "landlord-properties.png") });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto("/");
  await mobile.waitForLoadState("networkidle");
  await mobile.screenshot({ path: path.join(OUT, "landing-mobile.png") });
});

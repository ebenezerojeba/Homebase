import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Production smoke test: `npx playwright test -c playwright.smoke.config.ts`
 * Reads SMOKE_BASE_URL (default: APP_URL) and DB credentials from .env.production.local.
 * Creates clearly-labelled test data and deletes it at the end.
 */
const envFile = ".env.production.local";
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (v && process.env[k] === undefined) process.env[k] = v;
  }
}

export default defineConfig({
  testDir: "tests/smoke",
  outputDir: path.join(os.tmpdir(), "homebase-smoke", "results"),
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  // Flaky local connections (ECONNRESET) shouldn't fail the whole run; each attempt cleans up after itself.
  retries: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.SMOKE_BASE_URL ?? process.env.APP_URL ?? "https://homebase-iota-khaki.vercel.app", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

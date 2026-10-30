import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const PORT = 3100;
const DB_PORT = 27077;
const tmp = path.join(os.tmpdir(), "homebase-e2e");
export const outbox = path.join(tmp, "outbox.jsonl");

/**
 * End-to-end journeys against a PRODUCTION build (`next build` must run first: `npm run build`),
 * an in-memory MongoDB replica set, the mock payment sandbox and a file email outbox.
 * No real money, email or cloud storage is touched.
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: path.join(tmp, "test-results"),
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx scripts/dev-db.ts",
      port: DB_PORT,
      env: { DEV_DB_PORT: String(DB_PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        MONGODB_URI: `mongodb://127.0.0.1:${DB_PORT}/?replicaSet=testset`,
        MONGODB_DB: "homebase_e2e",
        APP_URL: `http://localhost:${PORT}`,
        APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
        PAYMENT_PROVIDER: "mock",
        ALLOW_MOCK_IN_PRODUCTION: "true",
        STORAGE_DRIVER: "local",
        LOCAL_STORAGE_DIR: path.join(tmp, "uploads"),
        EMAIL_PROVIDER: "console",
        DEV_OUTBOX_FILE: outbox,
        CRON_SECRET: "e2e-cron-secret-123456",
        LOG_LEVEL: "warn",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});

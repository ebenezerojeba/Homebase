import { afterAll, beforeAll, beforeEach, inject } from "vitest";
import mongoose from "mongoose";
import os from "node:os";
import path from "node:path";

const dbName = `hb_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
Object.assign(process.env, {
  NODE_ENV: "test",
  MONGODB_URI: inject("mongoUri"),
  MONGODB_DB: dbName,
  APP_SECRET: "test-secret-test-secret-test-secret-123456",
  APP_URL: "http://localhost:3000",
  PAYMENT_PROVIDER: "mock",
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_DIR: path.join(os.tmpdir(), "homebase-test-uploads", dbName),
  EMAIL_PROVIDER: "console",
  CRON_SECRET: "test-cron-secret-1234",
  LOG_LEVEL: "error",
});

beforeAll(async () => {
  const { connectDb } = await import("@/server/db");
  await connectDb();
  await import("@/server/models");
  await import("@/server/providers/payments");
  // Build every index up front so unique constraints are enforced from the first test.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

beforeEach(async () => {
  const db = mongoose.connection.db!;
  const cols = await db.collections();
  // Native deletes: bypasses the app-level append-only guard on audit collections (test cleanup only).
  await Promise.all(cols.map((c) => c.deleteMany({})));
  const { devOutbox, setEmailProviderForTests } = await import("@/server/providers/email");
  devOutbox.length = 0;
  setEmailProviderForTests(null);
  const { setPaymentProviderForTests } = await import("@/server/providers/payments");
  setPaymentProviderForTests(null);
  const { setTextProviderForTests } = await import("@/server/providers/text");
  setTextProviderForTests("sms", undefined);
  setTextProviderForTests("whatsapp", undefined);
});

afterAll(async () => {
  await mongoose.connection.db?.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

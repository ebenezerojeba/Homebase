import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null; txSupported: boolean | null };

// Serverless-friendly: reuse one connection per warm instance.
const g = globalThis as unknown as { __homebaseMongo?: Cache };
const cache: Cache = (g.__homebaseMongo ??= { conn: null, promise: null, txSupported: null });

// Unknown filter keys are stripped. Operator injection is prevented by validating every
// request with Zod (ids are parsed to strings/ObjectIds, never passed through as objects).
mongoose.set("strictQuery", true);

export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;
  if (!cache.promise) {
    const { MONGODB_URI, MONGODB_DB } = env();
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DB,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 8000,
        autoIndex: process.env.NODE_ENV !== "production",
      })
      .catch((e: unknown) => {
        cache.promise = null;
        throw e;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

/** Transactions need a replica set or sharded cluster (MongoDB Atlas always qualifies). */
export async function transactionsSupported(): Promise<boolean> {
  const mode = env().MONGODB_TRANSACTIONS;
  if (mode === "true") return true;
  if (mode === "false") return false;
  if (cache.txSupported !== null) return cache.txSupported;
  await connectDb();
  try {
    const db = mongoose.connection.db;
    const hello = db ? await db.admin().command({ hello: 1 }) : {};
    cache.txSupported = Boolean(hello.setName) || hello.msg === "isdbgrid";
  } catch {
    cache.txSupported = false;
  }
  if (!cache.txSupported) {
    logger.warn("mongodb_transactions_unavailable", {
      note: "Falling back to idempotent, ordered writes guarded by unique indexes.",
    });
  }
  return cache.txSupported;
}

/**
 * Run a multi-document change atomically when the deployment supports it.
 *
 * Fallback contract (no transactions): every financial write path in this codebase
 * is ordered so that (1) a single atomic status transition "claims" the operation
 * (findOneAndUpdate with a status precondition) and (2) all follow-up writes are
 * upserts/inserts protected by unique indexes, so a retry after a crash completes
 * the remaining steps without duplicating anything. `reconcile` jobs re-drive
 * any operation left half-done.
 */
export async function withTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  await connectDb();
  if (!(await transactionsSupported())) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    await connectDb();
    await mongoose.connection.db?.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

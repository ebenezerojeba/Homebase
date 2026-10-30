/**
 * Create any missing indexes defined in the Mongoose models. Safe and non-destructive:
 * uses createIndexes (never drops indexes). Run after each deploy that changes models.
 * Usage: npx tsx --env-file=.env.local scripts/sync-indexes.ts
 */
import dns from "node:dns";
import mongoose from "mongoose";

// Some local resolvers can't answer Atlas SRV lookups; set DNS_SERVERS=8.8.8.8,1.1.1.1 to work around it.
if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(","));

async function main() {
  process.env.APP_SECRET ??= "x".repeat(32);
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB, autoIndex: false });
  await import("../src/server/models/index");
  await import("../src/server/providers/payments").catch(() => null);
  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes();
    console.log(`✓ ${model.modelName}`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

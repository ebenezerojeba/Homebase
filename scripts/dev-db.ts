/**
 * Local MongoDB for development/e2e without installing MongoDB: an in-memory single-node
 * replica set (supports transactions). Data is lost when the process stops.
 * Usage: npx tsx scripts/dev-db.ts   → prints the MONGODB_URI to use.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";

const port = Number(process.env.DEV_DB_PORT ?? 27077);
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ port }] });
console.log(`MONGODB_URI=${rs.getUri()}`);
const stop = async () => {
  await rs.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);

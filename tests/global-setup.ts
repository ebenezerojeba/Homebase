import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let rs: MongoMemoryReplSet | undefined;

// A single-node replica set, so multi-document transactions are exercised exactly as on Atlas.
export async function setup(project: TestProject) {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  project.provide("mongoUri", rs.getUri());
}

export async function teardown() {
  await rs?.stop();
}

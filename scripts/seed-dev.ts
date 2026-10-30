/**
 * Development-only demo data with FAKE people (never real tenant records).
 * Refuses to run when NODE_ENV=production or against a URI containing "prod".
 * Usage: npx tsx --env-file=.env.local scripts/seed-dev.ts
 * Logins: landlord@demo.test / tenant@demo.test, password: demo-password-1
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

async function main() {
  const uri = process.env.MONGODB_URI ?? "";
  if (process.env.NODE_ENV === "production" || /prod/i.test(uri) || /prod/i.test(process.env.MONGODB_DB ?? "")) {
    console.error("Refusing to seed a production database.");
    process.exit(1);
  }
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB });
  const db = mongoose.connection.db!;
  if (await db.collection("users").findOne({ email: "landlord@demo.test" })) {
    console.log("Demo data already present.");
    return mongoose.disconnect();
  }
  const hash = await bcrypt.hash("demo-password-1", 10);
  const now = new Date();
  const base = { passwordHash: hash, emailVerifiedAt: now, status: "active", emailOptOut: [], failedLoginCount: 0, createdAt: now, updatedAt: now };
  await db.collection("users").insertMany([
    { ...base, name: "Demo Landlord", email: "landlord@demo.test", role: "landlord" },
    { ...base, name: "Demo Tenant", email: "tenant@demo.test", role: "tenant" },
  ]);
  console.log("Created demo users. Sign in as landlord@demo.test, add a property and unit, then create a tenancy for tenant@demo.test.");
  console.log("Invitation links print in the server log when EMAIL_PROVIDER=console.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

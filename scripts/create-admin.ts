/**
 * Create (or promote nothing — admins are never created from the web UI) a platform administrator.
 * Usage: npx tsx --env-file=.env.local scripts/create-admin.ts admin@example.com "Admin Name"
 * The password is read from ADMIN_PASSWORD so it never appears in shell history arguments.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

async function main() {
  const [email, name] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !name || !password || password.length < 12) {
    console.error('Usage: ADMIN_PASSWORD=... npx tsx --env-file=.env.local scripts/create-admin.ts <email> "<name>"  (password 12+ chars)');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB });
  const users = mongoose.connection.db!.collection("users");
  const existing = await users.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.error("A user with that email already exists. Roles can't be changed; use a different email.");
    process.exit(1);
  }
  const now = new Date();
  await users.insertOne({
    name,
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
    role: "admin",
    emailVerifiedAt: now,
    status: "active",
    emailOptOut: [],
    failedLoginCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await mongoose.connection.db!.collection("auditlogs").insertOne({ actorId: null, actorRole: "system", action: "admin.created_via_script", resourceType: "User", metadata: { email }, at: now });
  console.log(`Admin ${email} created.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

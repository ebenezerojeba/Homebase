import mongoose, { type Model, type Schema } from "mongoose";

export const { Types } = mongoose;
export type ObjectId = mongoose.Types.ObjectId;

/** Reuse compiled models across hot reloads / serverless warm starts. */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

/**
 * Make a collection append-only from the application's point of view.
 * Mongoose-level update/delete calls throw; only inserts are allowed.
 * (Database-level protection: grant the app user insert/find only on these collections — see docs/SECURITY.md.)
 */
export function appendOnly(schema: Schema, label: string) {
  const blocked = [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findOneAndReplace",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ] as const;
  for (const op of blocked) {
    schema.pre(op, function () {
      throw new Error(`${label} records are append-only (${op} is not permitted)`);
    });
  }
  schema.pre("save", function () {
    if (!this.isNew) throw new Error(`${label} records are append-only`);
  });
}

export const ROLES = ["landlord", "tenant", "admin"] as const;
export type Role = (typeof ROLES)[number];

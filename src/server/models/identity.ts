import { Schema } from "mongoose";
import { defineModel, ROLES, type ObjectId, type Role } from "./_shared";

export const NOTIFICATION_TYPES = [
  "rent_upcoming",
  "rent_due",
  "rent_overdue",
  "payment_claim_submitted",
  "payment_confirmed",
  "payment_rejected",
  "payment_reversed",
  "receipt_issued",
  "maintenance_update",
  "message_received",
  "tenancy_renewal",
  "tenancy_update",
  "invitation",
  "account",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface IUser {
  _id: ObjectId;
  name: string;
  email: string;
  phone?: string | null;
  passwordHash: string;
  role: Role;
  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
  status: "active" | "deactivated";
  deactivatedAt?: Date | null;
  deactivationReason?: string | null;
  /** Email opt-outs per notification type. In-app notifications are always kept. */
  emailOptOut: NotificationType[];
  /** Text alerts. Only effective when the phone number is verified (phoneVerifiedAt). */
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  failedLoginCount: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
  privacyAcceptedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, default: null, maxlength: 20 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, immutable: true },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: ["active", "deactivated"], default: "active" },
    deactivatedAt: { type: Date, default: null },
    deactivationReason: { type: String, default: null, maxlength: 500 },
    emailOptOut: { type: [String], enum: NOTIFICATION_TYPES, default: [] },
    smsEnabled: { type: Boolean, default: false },
    whatsappEnabled: { type: Boolean, default: false },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    privacyAcceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, createdAt: -1 });
export const User = defineModel<IUser>("User", userSchema);

export interface ISession {
  _id: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  role: Role;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date | null;
  userAgent?: string | null;
  createdAt: Date;
}
const sessionSchema = new Schema<ISession>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ROLES, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = defineModel<ISession>("Session", sessionSchema);

export interface IAuthToken {
  _id: ObjectId;
  type: "email_verify" | "password_reset";
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}
const authTokenSchema = new Schema<IAuthToken>(
  {
    type: { type: String, enum: ["email_verify", "password_reset"], required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
authTokenSchema.index({ tokenHash: 1 }, { unique: true });
authTokenSchema.index({ userId: 1, type: 1 });
// Keep used/expired tokens a week for troubleshooting, then purge.
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });
export const AuthToken = defineModel<IAuthToken>("AuthToken", authTokenSchema);

export interface IInvitation {
  _id: ObjectId;
  landlordId: ObjectId;
  tenancyId: ObjectId;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  status: "pending" | "accepted" | "revoked";
  acceptedAt?: Date | null;
  acceptedBy?: ObjectId | null;
  revokedAt?: Date | null;
  lastSentAt: Date;
  sendCount: number;
  createdAt: Date;
  updatedAt: Date;
}
const invitationSchema = new Schema<IInvitation>(
  {
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ["pending", "accepted", "revoked"], default: "pending" },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt: { type: Date, default: null },
    lastSentAt: { type: Date, required: true },
    sendCount: { type: Number, default: 1 },
  },
  { timestamps: true },
);
invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ tenancyId: 1, status: 1 });
// Only one live invitation per tenancy.
invitationSchema.index(
  { tenancyId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" }, name: "one_pending_invite_per_tenancy" },
);
export const Invitation = defineModel<IInvitation>("Invitation", invitationSchema);

export interface IRateLimit {
  _id: ObjectId;
  key: string;
  count: number;
  expiresAt: Date;
}
const rateLimitSchema = new Schema<IRateLimit>({
  key: { type: String, required: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
});
rateLimitSchema.index({ key: 1 }, { unique: true });
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RateLimit = defineModel<IRateLimit>("RateLimit", rateLimitSchema);

export interface IDataRequest {
  _id: ObjectId;
  userId: ObjectId;
  type: "access" | "correction" | "deletion";
  details: string;
  status: "open" | "in_progress" | "completed" | "declined";
  resolutionNote?: string | null;
  resolvedBy?: ObjectId | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const dataRequestSchema = new Schema<IDataRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["access", "correction", "deletion"], required: true },
    details: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ["open", "in_progress", "completed", "declined"], default: "open" },
    resolutionNote: { type: String, default: null, maxlength: 2000 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
dataRequestSchema.index({ status: 1, createdAt: 1 });
dataRequestSchema.index({ userId: 1, createdAt: -1 });
export const DataRequest = defineModel<IDataRequest>("DataRequest", dataRequestSchema);

/** One-time codes proving control of a phone number before SMS/WhatsApp alerts are enabled. */
export interface IPhoneVerification {
  _id: ObjectId;
  userId: ObjectId;
  phone: string;
  channel: "sms" | "whatsapp";
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt: Date;
}
const phoneVerificationSchema = new Schema<IPhoneVerification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    phone: { type: String, required: true },
    channel: { type: String, enum: ["sms", "whatsapp"], required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
phoneVerificationSchema.index({ userId: 1, createdAt: -1 });
phoneVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const PhoneVerification = defineModel<IPhoneVerification>("PhoneVerification", phoneVerificationSchema);

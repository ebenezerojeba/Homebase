import { Schema } from "mongoose";
import { appendOnly, defineModel, ROLES, type ObjectId, type Role } from "./_shared";
import { NOTIFICATION_TYPES, type NotificationType } from "./identity";

/* ---------------- Shared Tenancy Record ---------------- */

export const TIMELINE_EVENT_TYPES = [
  "tenancy_created",
  "tenancy_terms_changed",
  "tenancy_renewed",
  "tenancy_ended",
  "tenant_invited",
  "tenant_joined",
  "terms_acknowledged",
  "charge_created",
  "charge_adjusted",
  "payment_submitted",
  "payment_recorded",
  "payment_initiated",
  "payment_confirmed",
  "payment_rejected",
  "payment_failed",
  "payment_reversed",
  "payment_refunded",
  "credit_applied",
  "receipt_issued",
  "agreement_uploaded",
  "document_uploaded",
  "maintenance_submitted",
  "maintenance_status_changed",
  "maintenance_comment",
  "maintenance_tenant_confirmation",
  "inspection_recorded",
  "inspection_response",
  "notice_sent",
  "correction",
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/** Who the information comes from. Displayed so readers can weigh each entry. */
export const TIMELINE_SOURCES = ["tenant_submitted", "landlord_recorded", "landlord_confirmed", "provider_confirmed", "system"] as const;
export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

export interface ITimelineEvent {
  _id: ObjectId;
  tenancyId: ObjectId;
  landlordId: ObjectId;
  type: TimelineEventType;
  source: TimelineSource;
  actorId?: ObjectId | null;
  actorRole?: Role | "system" | null;
  entityType?: string | null;
  entityId?: ObjectId | null;
  summary: string;
  /** Safe, small, display-oriented values only. Never secrets or credentials. */
  metadata?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  visibility: "shared" | "landlord_only";
  correctsEventId?: ObjectId | null;
  /** Server-generated; never accepted from clients. */
  occurredAt: Date;
  dedupeKey?: string | null;
}
const timelineSchema = new Schema<ITimelineEvent>(
  {
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: TIMELINE_EVENT_TYPES, required: true },
    source: { type: String, enum: TIMELINE_SOURCES, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, enum: [...ROLES, "system", null], default: null },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    summary: { type: String, required: true, maxlength: 500 },
    metadata: { type: Schema.Types.Mixed, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    visibility: { type: String, enum: ["shared", "landlord_only"], default: "shared" },
    correctsEventId: { type: Schema.Types.ObjectId, ref: "TimelineEvent", default: null },
    occurredAt: { type: Date, required: true, default: () => new Date() },
    dedupeKey: { type: String, default: null },
  },
  { versionKey: false },
);
timelineSchema.index({ tenancyId: 1, occurredAt: -1, _id: -1 });
timelineSchema.index({ tenancyId: 1, type: 1, occurredAt: -1 });
timelineSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
appendOnly(timelineSchema, "Timeline");
export const TimelineEvent = defineModel<ITimelineEvent>("TimelineEvent", timelineSchema);

export interface IAuditLog {
  _id: ObjectId;
  actorId?: ObjectId | null;
  actorRole?: Role | "system" | null;
  action: string;
  resourceType: string;
  resourceId?: ObjectId | null;
  metadata?: Record<string, unknown> | null;
  ipHash?: string | null;
  at: Date;
}
const auditSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, enum: [...ROLES, "system", null], default: null },
    action: { type: String, required: true, maxlength: 80 },
    resourceType: { type: String, required: true, maxlength: 60 },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    ipHash: { type: String, default: null },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);
auditSchema.index({ resourceType: 1, resourceId: 1, at: -1 });
auditSchema.index({ actorId: 1, at: -1 });
auditSchema.index({ action: 1, at: -1 });
appendOnly(auditSchema, "Audit log");
export const AuditLog = defineModel<IAuditLog>("AuditLog", auditSchema);

/* ---------------- Maintenance ---------------- */

export const MAINTENANCE_STATUSES = [
  "submitted",
  "acknowledged",
  "scheduled",
  "in_progress",
  "awaiting_tenant",
  "completed",
  "cancelled",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export const MAINTENANCE_CATEGORIES = [
  "plumbing", "electrical", "structural", "roofing", "doors_windows", "appliances", "pest_control",
  "water_supply", "generator", "security", "painting", "cleaning", "other",
] as const;
export const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export interface IMaintenanceRequest {
  _id: ObjectId;
  tenancyId: ObjectId;
  propertyId: ObjectId;
  unitId: ObjectId;
  landlordId: ObjectId;
  tenantId?: ObjectId | null;
  reportedBy: ObjectId;
  title: string;
  description: string;
  category: (typeof MAINTENANCE_CATEGORIES)[number];
  priority: (typeof MAINTENANCE_PRIORITIES)[number];
  status: MaintenanceStatus;
  assignedTo?: string | null;
  expectedDate?: Date | null;
  completedAt?: Date | null;
  completionNotes?: string | null;
  costKobo?: number | null;
  tenantConfirmation: "not_requested" | "pending" | "confirmed_resolved" | "reported_unresolved";
  assetIds: ObjectId[];
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
const maintenanceSchema = new Schema<IMaintenanceRequest>(
  {
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    unitId: { type: Schema.Types.ObjectId, ref: "Unit", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reportedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, maxlength: 4000 },
    category: { type: String, enum: MAINTENANCE_CATEGORIES, required: true },
    priority: { type: String, enum: MAINTENANCE_PRIORITIES, default: "normal" },
    status: { type: String, enum: MAINTENANCE_STATUSES, default: "submitted" },
    assignedTo: { type: String, default: null, maxlength: 120 },
    expectedDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    completionNotes: { type: String, default: null, maxlength: 2000 },
    costKobo: { type: Number, default: null, min: 0, validate: (v: number | null) => v === null || Number.isSafeInteger(v) },
    tenantConfirmation: {
      type: String,
      enum: ["not_requested", "pending", "confirmed_resolved", "reported_unresolved"],
      default: "not_requested",
    },
    assetIds: [{ type: Schema.Types.ObjectId, ref: "Asset" }],
    lastActivityAt: { type: Date, required: true },
  },
  { timestamps: true },
);
maintenanceSchema.index({ landlordId: 1, status: 1, lastActivityAt: -1 });
maintenanceSchema.index({ tenancyId: 1, createdAt: -1 });
maintenanceSchema.index({ propertyId: 1, status: 1 });
export const MaintenanceRequest = defineModel<IMaintenanceRequest>("MaintenanceRequest", maintenanceSchema);

export interface IMaintenanceComment {
  _id: ObjectId;
  requestId: ObjectId;
  tenancyId: ObjectId;
  authorId?: ObjectId | null;
  authorRole: Role | "system";
  /** internal = landlord-only notes. Enforced in every query that serves tenants. */
  visibility: "shared" | "internal";
  kind: "comment" | "status_change" | "assignment" | "tenant_confirmation";
  body?: string | null;
  fromStatus?: MaintenanceStatus | null;
  toStatus?: MaintenanceStatus | null;
  assetIds: ObjectId[];
  createdAt: Date;
}
const maintenanceCommentSchema = new Schema<IMaintenanceComment>(
  {
    requestId: { type: Schema.Types.ObjectId, ref: "MaintenanceRequest", required: true },
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    authorRole: { type: String, enum: [...ROLES, "system"], required: true },
    visibility: { type: String, enum: ["shared", "internal"], required: true },
    kind: { type: String, enum: ["comment", "status_change", "assignment", "tenant_confirmation"], required: true },
    body: { type: String, default: null, maxlength: 4000 },
    fromStatus: { type: String, enum: [...MAINTENANCE_STATUSES, null], default: null },
    toStatus: { type: String, enum: [...MAINTENANCE_STATUSES, null], default: null },
    assetIds: [{ type: Schema.Types.ObjectId, ref: "Asset" }],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
maintenanceCommentSchema.index({ requestId: 1, visibility: 1, createdAt: 1 });
appendOnly(maintenanceCommentSchema, "Maintenance history");
export const MaintenanceComment = defineModel<IMaintenanceComment>("MaintenanceComment", maintenanceCommentSchema);

/* ---------------- Messaging ---------------- */

export interface IConversation {
  _id: ObjectId;
  tenancyId: ObjectId;
  landlordId: ObjectId;
  tenantId: ObjectId;
  participantIds: ObjectId[];
  lastMessageAt?: Date | null;
  lastMessagePreview?: string | null;
  readState: { userId: ObjectId; lastReadAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
}
const conversationSchema = new Schema<IConversation>(
  {
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    participantIds: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null, maxlength: 140 },
    readState: [{ _id: false, userId: { type: Schema.Types.ObjectId, required: true }, lastReadAt: { type: Date, required: true } }],
  },
  { timestamps: true },
);
conversationSchema.index({ tenancyId: 1, tenantId: 1 }, { unique: true });
conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
export const Conversation = defineModel<IConversation>("Conversation", conversationSchema);

export interface IMessage {
  _id: ObjectId;
  conversationId: ObjectId;
  senderId: ObjectId;
  body: string;
  attachmentAssetIds: ObjectId[];
  clientId?: string | null;
  createdAt: Date;
}
const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, default: "", maxlength: 4000 },
    attachmentAssetIds: [{ type: Schema.Types.ObjectId, ref: "Asset" }],
    clientId: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
// Retried sends from a flaky connection don't create duplicate messages.
messageSchema.index({ conversationId: 1, senderId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: "string" } } });
export const Message = defineModel<IMessage>("Message", messageSchema);

/* ---------------- Notifications ---------------- */

export interface INotification {
  _id: ObjectId;
  userId: ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  relatedResourceId?: ObjectId | null;
  /** Prevents duplicate notifications for the same event across job retries. */
  dedupeKey: string;
  readAt?: Date | null;
  email: IDelivery;
  sms: IDelivery;
  whatsapp: IDelivery;
  createdAt: Date;
}

export type DeliveryChannel = "email" | "sms" | "whatsapp";

export interface IDelivery {
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  sentAt?: Date | null;
  providerMessageId?: string | null;
}

const deliverySchema = () => ({
  status: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "skipped" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: null },
  lastError: { type: String, default: null, maxlength: 300 },
  sentAt: { type: Date, default: null },
  providerMessageId: { type: String, default: null, maxlength: 120 },
});
const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 1000 },
    link: { type: String, default: null, maxlength: 300 },
    relatedResourceId: { type: Schema.Types.ObjectId, default: null },
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
    email: deliverySchema(),
    sms: deliverySchema(),
    whatsapp: deliverySchema(),
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ "email.status": 1, "email.nextAttemptAt": 1 });
notificationSchema.index({ "sms.status": 1, "sms.nextAttemptAt": 1 });
notificationSchema.index({ "whatsapp.status": 1, "whatsapp.nextAttemptAt": 1 });
export const Notification = defineModel<INotification>("Notification", notificationSchema);

/* ---------------- Assets (file metadata only — binaries live in object storage) ---------------- */

export const ASSET_KINDS = [
  "property_image",
  "agreement",
  "payment_proof",
  "maintenance_photo",
  "inspection_photo",
  "message_attachment",
  "property_document",
  "expense_receipt",
  "tenancy_document",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface IAsset {
  _id: ObjectId;
  ownerId: ObjectId;
  landlordId: ObjectId;
  tenancyId?: ObjectId | null;
  propertyId?: ObjectId | null;
  kind: AssetKind;
  access: "public" | "private";
  storageProvider: "cloudinary" | "local";
  storageKey: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  displayName: string;
  /** Agreements/documents are versioned: same group, increasing version. */
  documentGroupId?: ObjectId | null;
  version: number;
  /** tenant-visible for tenancy docs; landlord-only for e.g. expense receipts. */
  sharedWithTenant: boolean;
  status: "pending" | "active" | "deleted";
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const assetSchema = new Schema<IAsset>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", default: null },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", default: null },
    kind: { type: String, enum: ASSET_KINDS, required: true },
    access: { type: String, enum: ["public", "private"], required: true },
    storageProvider: { type: String, enum: ["cloudinary", "local"], required: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    extension: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true },
    displayName: { type: String, required: true, maxlength: 120 },
    documentGroupId: { type: Schema.Types.ObjectId, default: null },
    version: { type: Number, default: 1 },
    sharedWithTenant: { type: Boolean, default: true },
    status: { type: String, enum: ["pending", "active", "deleted"], default: "active" },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
assetSchema.index({ landlordId: 1, kind: 1, createdAt: -1 });
assetSchema.index({ tenancyId: 1, kind: 1, createdAt: -1 });
assetSchema.index({ documentGroupId: 1, version: -1 });
assetSchema.index({ storageKey: 1 }, { unique: true });
export const Asset = defineModel<IAsset>("Asset", assetSchema);

/* ---------------- Persistent jobs ---------------- */

export interface IJob {
  _id: ObjectId;
  type: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedUntil?: Date | null;
  lastError?: string | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const jobSchema = new Schema<IJob>(
  {
    type: { type: String, required: true, maxlength: 60 },
    dedupeKey: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["queued", "running", "succeeded", "failed", "dead"], default: "queued" },
    runAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
jobSchema.index({ dedupeKey: 1 }, { unique: true });
jobSchema.index({ status: 1, runAt: 1 });
// Completed jobs are purged after 30 days.
jobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 30 * 86400, partialFilterExpression: { status: "succeeded" } });
export const Job = defineModel<IJob>("Job", jobSchema);

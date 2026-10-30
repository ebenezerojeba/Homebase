import { Schema } from "mongoose";
import { defineModel, type ObjectId } from "./_shared";

const kobo = { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: "Amount must be integer kobo" } };

export interface IChargeAdjustment {
  _id: ObjectId;
  /** Signed: negative = credit/discount, positive = additional charge. */
  amountKobo: number;
  reason: string;
  actorId: ObjectId;
  createdAt: Date;
  /** When this adjustment corrects an earlier one, link it rather than editing it. */
  correctsAdjustmentId?: ObjectId | null;
}

export const CHARGE_STATUSES = ["open", "partially_paid", "paid", "waived", "cancelled"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export interface IRentCharge {
  _id: ObjectId;
  tenancyId: ObjectId;
  landlordId: ObjectId;
  propertyId: ObjectId;
  periodIndex: number;
  kind: "rent" | "agreed_charge";
  label: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  baseAmountKobo: number;
  adjustments: IChargeAdjustment[];
  /** base + adjustments. Maintained in the same write as adjustments. */
  amountKobo: number;
  /** Sum of active allocations. Maintained in the same transaction as allocations; verified by reconciliation. */
  allocatedKobo: number;
  status: ChargeStatus;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const adjustmentSchema = new Schema<IChargeAdjustment>(
  {
    amountKobo: kobo,
    reason: { type: String, required: true, maxlength: 500 },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, required: true },
    correctsAdjustmentId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: true },
);

const rentChargeSchema = new Schema<IRentCharge>(
  {
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    periodIndex: { type: Number, required: true, immutable: true },
    kind: { type: String, enum: ["rent", "agreed_charge"], required: true, immutable: true },
    label: { type: String, required: true, maxlength: 100 },
    periodStart: { type: Date, required: true, immutable: true },
    periodEnd: { type: Date, required: true, immutable: true },
    dueDate: { type: Date, required: true, immutable: true },
    baseAmountKobo: { ...kobo, min: 0, immutable: true },
    adjustments: { type: [adjustmentSchema], default: [] },
    amountKobo: { ...kobo, min: 0 },
    allocatedKobo: { ...kobo, min: 0, default: 0 },
    status: { type: String, enum: CHARGE_STATUSES, default: "open" },
    idempotencyKey: { type: String, required: true, immutable: true },
  },
  { timestamps: true },
);
rentChargeSchema.index({ idempotencyKey: 1 }, { unique: true });
rentChargeSchema.index({ tenancyId: 1, dueDate: 1 });
rentChargeSchema.index({ landlordId: 1, status: 1, dueDate: 1 });
rentChargeSchema.index({ status: 1, dueDate: 1 });
export const RentCharge = defineModel<IRentCharge>("RentCharge", rentChargeSchema);

export const PAYMENT_STATUSES = [
  "initiated", // online: created on our side, tenant not yet at provider
  "pending", // online: provider reports pending/ongoing
  "pending_verification", // external claim awaiting landlord review
  "confirmed",
  "rejected",
  "failed",
  "abandoned",
  "reversed",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["online", "bank_transfer", "cash", "pos", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Who vouches for the payment — shown everywhere a payment appears. */
export const PAYMENT_SOURCES = ["provider", "tenant_claim", "landlord_record"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export interface IPaymentStatusEntry {
  status: PaymentStatus;
  at: Date;
  actorId?: ObjectId | null;
  source: "tenant" | "landlord" | "provider" | "system" | "admin";
  note?: string | null;
}

export interface IPayment {
  _id: ObjectId;
  tenancyId: ObjectId;
  landlordId: ObjectId;
  propertyId: ObjectId;
  tenantId?: ObjectId | null;
  purpose: "rent" | "deposit";
  method: PaymentMethod;
  source: PaymentSource;
  status: PaymentStatus;
  amountKobo: number;
  currency: "NGN";
  paidOn: Date;
  /** Charges the payer intended to cover; allocation still follows ledger rules. */
  intendedChargeIds: ObjectId[];
  provider?: "paystack" | "mock" | null;
  providerReference?: string | null;
  providerData?: { channel?: string | null; paidAt?: Date | null; gatewayResponse?: string | null; authorizationUrl?: string | null } | null;
  externalReference?: string | null;
  externalReferenceNormalized?: string | null;
  bankName?: string | null;
  proofAssetId?: ObjectId | null;
  note?: string | null;
  submittedBy: ObjectId;
  submittedAt: Date;
  verifiedBy?: ObjectId | null;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
  reversalReason?: string | null;
  /** Confirmed amount not yet applied to charges (advance payment / overpayment credit). */
  unallocatedKobo: number;
  receiptId?: ObjectId | null;
  /** Reconciliation warnings (never accusations): amount_mismatch, currency_mismatch, possible_duplicate, no_open_charge. */
  flags: string[];
  statusHistory: IPaymentStatusEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    purpose: { type: String, enum: ["rent", "deposit"], default: "rent", immutable: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true, immutable: true },
    source: { type: String, enum: PAYMENT_SOURCES, required: true, immutable: true },
    status: { type: String, enum: PAYMENT_STATUSES, required: true },
    amountKobo: { ...kobo, min: 1, immutable: true },
    currency: { type: String, enum: ["NGN"], default: "NGN", immutable: true },
    paidOn: { type: Date, required: true },
    intendedChargeIds: [{ type: Schema.Types.ObjectId, ref: "RentCharge" }],
    provider: { type: String, enum: ["paystack", "mock", null], default: null },
    providerReference: { type: String, default: null },
    providerData: {
      channel: { type: String, default: null },
      paidAt: { type: Date, default: null },
      gatewayResponse: { type: String, default: null, maxlength: 200 },
      authorizationUrl: { type: String, default: null },
    },
    externalReference: { type: String, default: null, maxlength: 100 },
    externalReferenceNormalized: { type: String, default: null },
    bankName: { type: String, default: null, maxlength: 80 },
    proofAssetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
    note: { type: String, default: null, maxlength: 1000 },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedAt: { type: Date, required: true },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 1000 },
    reversalReason: { type: String, default: null, maxlength: 1000 },
    unallocatedKobo: { ...kobo, min: 0, default: 0 },
    receiptId: { type: Schema.Types.ObjectId, ref: "Receipt", default: null },
    flags: { type: [String], default: [] },
    statusHistory: {
      type: [
        {
          _id: false,
          status: { type: String, enum: PAYMENT_STATUSES, required: true },
          at: { type: Date, required: true },
          actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
          source: { type: String, enum: ["tenant", "landlord", "provider", "system", "admin"], required: true },
          note: { type: String, default: null, maxlength: 500 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
paymentSchema.index({ providerReference: 1 }, { unique: true, partialFilterExpression: { providerReference: { $type: "string" } } });
paymentSchema.index({ tenancyId: 1, createdAt: -1 });
paymentSchema.index({ landlordId: 1, status: 1, createdAt: -1 });
paymentSchema.index({ landlordId: 1, externalReferenceNormalized: 1 });
paymentSchema.index({ tenancyId: 1, status: 1, unallocatedKobo: 1 });
// At most one confirmed payment per landlord per external reference.
paymentSchema.index(
  { landlordId: 1, externalReferenceNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "confirmed", externalReferenceNormalized: { $type: "string" } },
    name: "unique_confirmed_external_reference",
  },
);
export const Payment = defineModel<IPayment>("Payment", paymentSchema);

export interface IPaymentAllocation {
  _id: ObjectId;
  paymentId: ObjectId;
  rentChargeId: ObjectId;
  tenancyId: ObjectId;
  amountKobo: number;
  status: "active" | "reversed";
  reversedAt?: Date | null;
  reversalReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
const allocationSchema = new Schema<IPaymentAllocation>(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, immutable: true },
    rentChargeId: { type: Schema.Types.ObjectId, ref: "RentCharge", required: true, immutable: true },
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true, immutable: true },
    amountKobo: { ...kobo, min: 1 },
    status: { type: String, enum: ["active", "reversed"], default: "active" },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);
allocationSchema.index({ paymentId: 1, rentChargeId: 1 }, { unique: true });
allocationSchema.index({ rentChargeId: 1, status: 1 });
allocationSchema.index({ tenancyId: 1, status: 1 });
export const PaymentAllocation = defineModel<IPaymentAllocation>("PaymentAllocation", allocationSchema);

export interface IReceipt {
  _id: ObjectId;
  receiptNumber: string;
  paymentId: ObjectId;
  tenancyId: ObjectId;
  landlordId: ObjectId;
  tenantId?: ObjectId | null;
  propertyId: ObjectId;
  amountKobo: number;
  currency: "NGN";
  purpose: "rent" | "deposit";
  method: PaymentMethod;
  paidOn: Date;
  issuedAt: Date;
  confirmedBy: "provider" | "landlord";
  confirmedByUserId?: ObjectId | null;
  lines: { rentChargeId: ObjectId; label: string; periodStart: Date; periodEnd: Date; amountKobo: number }[];
  creditKobo: number;
  status: "valid" | "voided";
  voidedAt?: Date | null;
  voidReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
const receiptSchema = new Schema<IReceipt>(
  {
    receiptNumber: { type: String, required: true, immutable: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, immutable: true },
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    amountKobo: { ...kobo, immutable: true },
    currency: { type: String, enum: ["NGN"], default: "NGN" },
    purpose: { type: String, enum: ["rent", "deposit"], required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    paidOn: { type: Date, required: true },
    issuedAt: { type: Date, required: true, immutable: true },
    confirmedBy: { type: String, enum: ["provider", "landlord"], required: true },
    confirmedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lines: [
      {
        _id: false,
        rentChargeId: { type: Schema.Types.ObjectId, ref: "RentCharge", required: true },
        label: { type: String, required: true },
        periodStart: { type: Date, required: true },
        periodEnd: { type: Date, required: true },
        amountKobo: kobo,
      },
    ],
    creditKobo: { ...kobo, default: 0 },
    status: { type: String, enum: ["valid", "voided"], default: "valid" },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);
receiptSchema.index({ receiptNumber: 1 }, { unique: true });
receiptSchema.index({ paymentId: 1 }, { unique: true });
receiptSchema.index({ tenancyId: 1, issuedAt: -1 });
export const Receipt = defineModel<IReceipt>("Receipt", receiptSchema);

export interface ICounter {
  _id: string;
  seq: number;
}
const counterSchema = new Schema<ICounter>({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });
export const Counter = defineModel<ICounter>("Counter", counterSchema);

export interface IWebhookEvent {
  _id: ObjectId;
  provider: "paystack" | "mock";
  /** Stable idempotency key: provider event identity (or body hash when the provider has no event id). */
  eventKey: string;
  eventType: string;
  reference?: string | null;
  status: "received" | "processed" | "ignored" | "failed";
  attempts: number;
  lastError?: string | null;
  receivedAt: Date;
  processedAt?: Date | null;
  summary?: Record<string, unknown> | null;
}
const webhookEventSchema = new Schema<IWebhookEvent>(
  {
    provider: { type: String, enum: ["paystack", "mock"], required: true },
    eventKey: { type: String, required: true },
    eventType: { type: String, required: true, maxlength: 80 },
    reference: { type: String, default: null },
    status: { type: String, enum: ["received", "processed", "ignored", "failed"], default: "received" },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null, maxlength: 500 },
    receivedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    summary: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: false },
);
webhookEventSchema.index({ provider: 1, eventKey: 1 }, { unique: true });
webhookEventSchema.index({ reference: 1 });
webhookEventSchema.index({ status: 1, receivedAt: 1 });
export const WebhookEvent = defineModel<IWebhookEvent>("WebhookEvent", webhookEventSchema);

export const EXPENSE_CATEGORIES = [
  "repairs", "plumbing", "electrical", "cleaning", "security", "waste", "utilities", "insurance",
  "legal", "agency", "tax_levy", "renovation", "other",
] as const;

export interface IExpense {
  _id: ObjectId;
  landlordId: ObjectId;
  propertyId: ObjectId;
  unitId?: ObjectId | null;
  maintenanceRequestId?: ObjectId | null;
  category: (typeof EXPENSE_CATEGORIES)[number];
  description: string;
  amountKobo: number;
  incurredOn: Date;
  vendor?: string | null;
  receiptAssetId?: ObjectId | null;
  recordedBy: ObjectId;
  status: "recorded" | "voided";
  voidReason?: string | null;
  voidedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const expenseSchema = new Schema<IExpense>(
  {
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true },
    unitId: { type: Schema.Types.ObjectId, ref: "Unit", default: null },
    maintenanceRequestId: { type: Schema.Types.ObjectId, ref: "MaintenanceRequest", default: null },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    description: { type: String, required: true, maxlength: 500 },
    amountKobo: { ...kobo, min: 1, immutable: true },
    incurredOn: { type: Date, required: true },
    vendor: { type: String, default: null, maxlength: 120 },
    receiptAssetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["recorded", "voided"], default: "recorded" },
    voidReason: { type: String, default: null, maxlength: 500 },
    voidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
expenseSchema.index({ landlordId: 1, incurredOn: -1 });
expenseSchema.index({ propertyId: 1, incurredOn: -1 });
expenseSchema.index({ maintenanceRequestId: 1 }, { unique: true, partialFilterExpression: { maintenanceRequestId: { $type: "objectId" }, status: "recorded" } });
export const Expense = defineModel<IExpense>("Expense", expenseSchema);

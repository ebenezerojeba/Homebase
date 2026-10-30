import { Schema } from "mongoose";
import { NIGERIAN_STATES, PROPERTY_TYPES, UNIT_TYPES } from "@/lib/nigeria";
import { defineModel, type ObjectId } from "./_shared";

export interface IProperty {
  _id: ObjectId;
  landlordId: ObjectId;
  name: string;
  propertyType: (typeof PROPERTY_TYPES)[number];
  address: { line1: string; line2?: string | null; city: string; lga: string; state: (typeof NIGERIAN_STATES)[number] };
  description?: string | null;
  imageAssetIds: ObjectId[];
  status: "active" | "archived";
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const propertySchema = new Schema<IProperty>(
  {
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    propertyType: { type: String, enum: PROPERTY_TYPES, required: true },
    address: {
      line1: { type: String, required: true, trim: true, maxlength: 200 },
      line2: { type: String, default: null, trim: true, maxlength: 200 },
      city: { type: String, required: true, trim: true, maxlength: 100 },
      lga: { type: String, required: true, trim: true, maxlength: 100 },
      state: { type: String, enum: NIGERIAN_STATES, required: true },
    },
    description: { type: String, default: null, maxlength: 2000 },
    imageAssetIds: [{ type: Schema.Types.ObjectId, ref: "Asset" }],
    status: { type: String, enum: ["active", "archived"], default: "active" },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
propertySchema.index({ landlordId: 1, status: 1, createdAt: -1 });
export const Property = defineModel<IProperty>("Property", propertySchema);

export interface IUnit {
  _id: ObjectId;
  propertyId: ObjectId;
  landlordId: ObjectId;
  unitNumber: string;
  unitType: (typeof UNIT_TYPES)[number];
  bedrooms?: number | null;
  bathrooms?: number | null;
  features: string[];
  occupancy: "vacant" | "occupied" | "unavailable";
  /** Claimed atomically by the one live tenancy, preventing overlapping occupancy. */
  currentTenancyId?: ObjectId | null;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}
const unitSchema = new Schema<IUnit>(
  {
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    unitNumber: { type: String, required: true, trim: true, maxlength: 40 },
    unitType: { type: String, enum: UNIT_TYPES, required: true },
    bedrooms: { type: Number, default: null, min: 0, max: 50 },
    bathrooms: { type: Number, default: null, min: 0, max: 50 },
    features: { type: [String], default: [] },
    occupancy: { type: String, enum: ["vacant", "occupied", "unavailable"], default: "vacant" },
    currentTenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", default: null },
    status: { type: String, enum: ["active", "archived"], default: "active" },
  },
  { timestamps: true },
);
unitSchema.index(
  { propertyId: 1, unitNumber: 1 },
  { unique: true, partialFilterExpression: { status: "active" }, collation: { locale: "en", strength: 2 } },
);
unitSchema.index({ landlordId: 1, occupancy: 1 });
export const Unit = defineModel<IUnit>("Unit", unitSchema);

export const FREQUENCIES = ["monthly", "quarterly", "half_yearly", "annual"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

export interface IRentScheduleEntry {
  _id: ObjectId;
  /** Applies to billing periods whose start date is on/after this date. */
  effectiveFrom: Date;
  amountKobo: number;
  recordedBy: ObjectId;
  recordedAt: Date;
  note?: string | null;
}

export interface IAgreedCharge {
  _id: ObjectId;
  label: string;
  amountKobo: number;
  /** recurring = billed every period alongside rent; once = billed with the first period. */
  recurrence: "recurring" | "once";
}

export const TENANCY_STATUSES = ["active", "ended", "terminated", "cancelled"] as const;
export type TenancyStatus = (typeof TENANCY_STATUSES)[number];

export interface ITenancy {
  _id: ObjectId;
  landlordId: ObjectId;
  propertyId: ObjectId;
  unitId: ObjectId;
  tenantId?: ObjectId | null;
  /** Name/email the landlord entered; kept for display before the tenant joins. */
  tenantName: string;
  tenantEmail: string;
  startDate: Date;
  endDate: Date;
  frequency: Frequency;
  /** Historical rent terms. Never edited in place; new entries apply to future periods only. */
  rentSchedule: IRentScheduleEntry[];
  agreedCharges: IAgreedCharge[];
  gracePeriodDays: number;
  depositAmountKobo: number;
  prorateFinalPeriod: boolean;
  status: TenancyStatus;
  /** Highest billing-period index for which charges exist (-1 = none yet). */
  generatedThroughIndex: number;
  nextDueDate?: Date | null;
  termsAcknowledgedAt?: Date | null;
  endedAt?: Date | null;
  endReason?: string | null;
  renewedFromId?: ObjectId | null;
  renewedToId?: ObjectId | null;
  agreementAssetIds: ObjectId[];
  notes?: string | null;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const tenancySchema = new Schema<ITenancy>(
  {
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    unitId: { type: Schema.Types.ObjectId, ref: "Unit", required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    tenantName: { type: String, required: true, trim: true, maxlength: 120 },
    tenantEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    startDate: { type: Date, required: true, immutable: true },
    endDate: { type: Date, required: true },
    frequency: { type: String, enum: FREQUENCIES, required: true, immutable: true },
    rentSchedule: {
      type: [
        new Schema<IRentScheduleEntry>({
          effectiveFrom: { type: Date, required: true },
          amountKobo: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
          recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
          recordedAt: { type: Date, required: true },
          note: { type: String, default: null, maxlength: 500 },
        }),
      ],
      validate: (v: unknown[]) => v.length >= 1 && v.length <= 100,
    },
    agreedCharges: {
      type: [
        new Schema<IAgreedCharge>({
          label: { type: String, required: true, trim: true, maxlength: 80 },
          amountKobo: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
          recurrence: { type: String, enum: ["recurring", "once"], required: true },
        }),
      ],
      default: [],
      validate: (v: unknown[]) => v.length <= 10,
    },
    gracePeriodDays: { type: Number, default: 0, min: 0, max: 90 },
    depositAmountKobo: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    prorateFinalPeriod: { type: Boolean, default: false },
    status: { type: String, enum: TENANCY_STATUSES, default: "active" },
    generatedThroughIndex: { type: Number, default: -1 },
    nextDueDate: { type: Date, default: null },
    termsAcknowledgedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endReason: { type: String, default: null, maxlength: 1000 },
    renewedFromId: { type: Schema.Types.ObjectId, ref: "Tenancy", default: null },
    renewedToId: { type: Schema.Types.ObjectId, ref: "Tenancy", default: null },
    agreementAssetIds: [{ type: Schema.Types.ObjectId, ref: "Asset" }],
    notes: { type: String, default: null, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
tenancySchema.index({ landlordId: 1, status: 1, createdAt: -1 });
tenancySchema.index({ tenantId: 1, status: 1 });
tenancySchema.index({ unitId: 1, startDate: -1 });
tenancySchema.index({ status: 1, endDate: 1 });
tenancySchema.index({ status: 1, nextDueDate: 1 });
export const Tenancy = defineModel<ITenancy>("Tenancy", tenancySchema);

export interface IInspectionItem {
  _id: ObjectId;
  area: string;
  condition: "good" | "fair" | "poor" | "damaged" | "missing";
  notes?: string | null;
  assetIds: ObjectId[];
}
export interface IInspection {
  _id: ObjectId;
  tenancyId: ObjectId;
  landlordId: ObjectId;
  tenantId?: ObjectId | null;
  type: "move_in" | "move_out";
  inspectedOn: Date;
  conductedBy: ObjectId;
  items: IInspectionItem[];
  summary?: string | null;
  status: "draft" | "finalized";
  finalizedAt?: Date | null;
  tenantResponse: { status: "pending" | "acknowledged" | "disputed"; at?: Date | null; comment?: string | null };
  createdAt: Date;
  updatedAt: Date;
}
const inspectionSchema = new Schema<IInspection>(
  {
    tenancyId: { type: Schema.Types.ObjectId, ref: "Tenancy", required: true, immutable: true },
    landlordId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    type: { type: String, enum: ["move_in", "move_out"], required: true },
    inspectedOn: { type: Date, required: true },
    conductedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    items: {
      type: [
        new Schema<IInspectionItem>({
          area: { type: String, required: true, trim: true, maxlength: 80 },
          condition: { type: String, enum: ["good", "fair", "poor", "damaged", "missing"], required: true },
          notes: { type: String, default: null, maxlength: 1000 },
          assetIds: [{ type: Schema.Types.ObjectId, ref: "Asset" }],
        }),
      ],
      validate: (v: unknown[]) => v.length <= 60,
    },
    summary: { type: String, default: null, maxlength: 2000 },
    status: { type: String, enum: ["draft", "finalized"], default: "draft" },
    finalizedAt: { type: Date, default: null },
    tenantResponse: {
      status: { type: String, enum: ["pending", "acknowledged", "disputed"], default: "pending" },
      at: { type: Date, default: null },
      comment: { type: String, default: null, maxlength: 1000 },
    },
  },
  { timestamps: true },
);
inspectionSchema.index({ tenancyId: 1, type: 1, createdAt: -1 });
export const Inspection = defineModel<IInspection>("Inspection", inspectionSchema);

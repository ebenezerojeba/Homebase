/** Nigerian states (plus FCT). LGAs are free text validated for length, since the official list changes. */
export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River",
  "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano",
  "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
] as const;
export type NigerianState = (typeof NIGERIAN_STATES)[number];

export const PROPERTY_TYPES = [
  "apartment_block", "detached_house", "semi_detached", "terrace", "duplex", "bungalow",
  "self_contained", "boys_quarters", "mixed_use", "shop", "office", "other",
] as const;

export const UNIT_TYPES = [
  "self_contain", "mini_flat", "one_bedroom", "two_bedroom", "three_bedroom", "four_plus_bedroom",
  "room", "shop", "office", "whole_property", "other",
] as const;

export const labels: Record<string, string> = {
  apartment_block: "Apartment block",
  detached_house: "Detached house",
  semi_detached: "Semi-detached house",
  terrace: "Terrace",
  duplex: "Duplex",
  bungalow: "Bungalow",
  self_contained: "Self-contained",
  boys_quarters: "Boys' quarters",
  mixed_use: "Mixed use",
  shop: "Shop",
  office: "Office",
  other: "Other",
  self_contain: "Self contain",
  mini_flat: "Mini flat",
  one_bedroom: "1 bedroom",
  two_bedroom: "2 bedroom",
  three_bedroom: "3 bedroom",
  four_plus_bedroom: "4+ bedroom",
  room: "Room",
  whole_property: "Whole property",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  annual: "Annual",
};

export function label(key: string | null | undefined): string {
  if (!key) return "—";
  return labels[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Accepts Nigerian numbers in local (080...) or international (+234...) form. */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+234[789][01]\d{8}$/.test(digits)) return digits;
  if (/^234[789][01]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0[789][01]\d{8}$/.test(digits)) return `+234${digits.slice(1)}`;
  return null;
}

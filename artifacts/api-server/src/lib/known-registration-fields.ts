// Static catalog of CORE registration fields the admin can toggle required/optional
// in a registration template. The admin UI fetches this list (or imports it) so it
// knows what knobs exist; admins cannot rename/retype these — they can only mark
// them required or hide them. Custom fields are added separately and stored in
// farmer_custom_field_values.
//
// `source = core_farmer` means the value lives as a column on farmersTable.
// `source = core_livelihood` is functionally identical (also a farmers column) but
// rendered under the "Livelihood" group in the form. The split is purely UX.
//
// Keep `key` matching the farmersTable column name exactly — the stage-computation
// helper reads farmer[key] directly.

export type FieldType = "text" | "number" | "date" | "choice" | "multichoice" | "yesno";

export type CoreFieldDef = {
  key: string;
  label: string;
  source: "core_farmer" | "core_livelihood";
  fieldType: FieldType;
  options?: { value: string; label: string }[];
  // Bedrock fields the admin cannot mark optional (system always requires them).
  // The admin UI shows them as locked-required.
  alwaysRequired?: boolean;
};

export const KNOWN_CORE_FIELDS: CoreFieldDef[] = [
  // --- Identity (KYC) ---
  { key: "firstName", label: "First name", source: "core_farmer", fieldType: "text", alwaysRequired: true },
  { key: "lastName", label: "Last name", source: "core_farmer", fieldType: "text", alwaysRequired: true },
  { key: "nationalId", label: "National ID", source: "core_farmer", fieldType: "text" },
  { key: "dateOfBirth", label: "Date of birth", source: "core_farmer", fieldType: "date" },
  {
    key: "sex",
    label: "Sex",
    source: "core_farmer",
    fieldType: "choice",
    options: [
      { value: "male", label: "Male" },
      { value: "female", label: "Female" },
      { value: "other", label: "Other" },
    ],
  },
  { key: "phoneNumber", label: "Phone number", source: "core_farmer", fieldType: "text" },
  // --- Household ---
  { key: "householdSize", label: "Household size", source: "core_farmer", fieldType: "number" },
  { key: "dependants", label: "Dependants", source: "core_farmer", fieldType: "number" },
  { key: "headOfHousehold", label: "Head of household", source: "core_farmer", fieldType: "text" },
  {
    key: "landTenure",
    label: "Land tenure",
    source: "core_farmer",
    fieldType: "choice",
    options: [
      { value: "Owned", label: "Owned" },
      { value: "Rented", label: "Rented" },
      { value: "Inherited", label: "Inherited" },
      { value: "Other", label: "Other" },
    ],
  },
  // --- Livelihood (living-income tracking) ---
  { key: "cultivatedLandHa", label: "Cultivated land (hectares)", source: "core_livelihood", fieldType: "number" },
  {
    key: "offFarmIncomeSource",
    label: "Main off-farm income source",
    source: "core_livelihood",
    fieldType: "choice",
    options: [
      { value: "none", label: "None" },
      { value: "trading", label: "Trading" },
      { value: "wage_labour", label: "Wage labour" },
      { value: "remittance", label: "Remittance" },
      { value: "other", label: "Other" },
    ],
  },
  { key: "offFarmIncomeMonthlyUgx", label: "Off-farm income (UGX/month)", source: "core_livelihood", fieldType: "number" },
  { key: "monthsOfFoodShortage", label: "Months of food shortage per year (0–12)", source: "core_livelihood", fieldType: "number" },
  {
    key: "educationLevelHead",
    label: "Education of head of household",
    source: "core_livelihood",
    fieldType: "choice",
    options: [
      { value: "none", label: "None" },
      { value: "primary", label: "Primary" },
      { value: "secondary", label: "Secondary" },
      { value: "tertiary", label: "Tertiary" },
    ],
  },
  { key: "accessCleanWater", label: "Access to clean water", source: "core_livelihood", fieldType: "yesno" },
  { key: "accessElectricity", label: "Access to electricity", source: "core_livelihood", fieldType: "yesno" },
  {
    key: "primaryCookingFuel",
    label: "Primary cooking fuel",
    source: "core_livelihood",
    fieldType: "choice",
    options: [
      { value: "firewood", label: "Firewood" },
      { value: "charcoal", label: "Charcoal" },
      { value: "lpg", label: "LPG" },
      { value: "electricity", label: "Electricity" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "otherActivities",
    label: "Other on-farm activities",
    source: "core_livelihood",
    fieldType: "multichoice",
    options: [
      { value: "Livestock", label: "Livestock" },
      { value: "Fishing", label: "Fishing" },
      { value: "Beekeeping", label: "Beekeeping" },
      { value: "Trading", label: "Trading" },
      { value: "Carpentry", label: "Carpentry" },
      { value: "Other", label: "Other" },
    ],
  },
  // Special composite — crops live in farmer_crops, not on farmersTable. The stage
  // helper detects this key by name and checks the joined crops array instead.
  {
    key: "crops",
    label: "Crops grown",
    source: "core_livelihood",
    fieldType: "multichoice",
  },
];

export const KNOWN_CORE_FIELD_KEYS = new Set(KNOWN_CORE_FIELDS.map((f) => f.key));

export function getCoreFieldDef(key: string): CoreFieldDef | undefined {
  return KNOWN_CORE_FIELDS.find((f) => f.key === key);
}

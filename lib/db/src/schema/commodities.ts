import { pgTable, text, uuid, timestamp, date, numeric, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// =================================================================================================
// Commodity Master — what is being traded (Coffee, Maize, Cocoa…).
// =================================================================================================
export const commoditiesTable = pgTable("commodities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  scientificName: text("scientific_name"),
  defaultUnit: text("default_unit").notNull().default("kg"),
  description: text("description"),
  // 'active' | 'inactive'
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("commodities_code_uniq").on(t.code),
]);

// =================================================================================================
// Commodity Type — variant + processing stage. Hierarchy via parentCommodityTypeId enables
// transformations: Robusta Cherry (RAW) → Robusta Parchment (INTERMEDIATE) → Robusta Green Bean
// (FINISHED). Each stage can have its own price, conversion, and quality spec.
// =================================================================================================
export const commodityTypesTable = pgTable("commodity_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityId: uuid("commodity_id").notNull().references(() => commoditiesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  // 'raw' | 'intermediate' | 'finished'
  stage: text("stage").notNull().default("raw"),
  parentCommodityTypeId: uuid("parent_commodity_type_id").references((): any => commodityTypesTable.id, { onDelete: "set null" }),
  isTradable: boolean("is_tradable").notNull().default(true),
  defaultUnit: text("default_unit").notNull().default("kg"),
  defaultMoistureMin: numeric("default_moisture_min", { precision: 5, scale: 2 }),
  defaultMoistureMax: numeric("default_moisture_max", { precision: 5, scale: 2 }),
  // 'active' | 'inactive'
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_types_commodity_idx").on(t.commodityId),
  index("commodity_types_parent_idx").on(t.parentCommodityTypeId),
  uniqueIndex("commodity_types_commodity_code_uniq").on(t.commodityId, t.code),
]);

// =================================================================================================
// Commodity Seasons — explicit date-range windows per commodity type, optionally region-scoped.
// Replaces simple "month-of-year" representation; supports overlapping or wrap-year-end windows.
// =================================================================================================
export const commoditySeasonsTable = pgTable("commodity_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityTypeId: uuid("commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "cascade" }),
  seasonName: text("season_name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  regionId: uuid("region_id"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_seasons_type_idx").on(t.commodityTypeId),
  index("commodity_seasons_dates_idx").on(t.commodityTypeId, t.startDate, t.endDate),
]);

// =================================================================================================
// Daily Pricing — append-only price-per-kg per commodity type, optionally region-scoped.
// Latest effectiveDate ≤ today wins. Source enumerates origin: manual | market | contract.
// =================================================================================================
export const commodityPricesTable = pgTable("commodity_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityTypeId: uuid("commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  regionId: uuid("region_id"),
  pricePerKg: numeric("price_per_kg", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("UGX"),
  effectiveDate: date("effective_date").notNull(),
  // 'manual' | 'market' | 'contract'
  source: text("source").notNull().default("manual"),
  notes: text("notes"),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_prices_type_date_idx").on(t.commodityTypeId, t.effectiveDate),
  index("commodity_prices_type_region_date_idx").on(t.commodityTypeId, t.regionId, t.effectiveDate),
  uniqueIndex("commodity_prices_scope_day_uniq").on(
    t.commodityTypeId,
    sql`coalesce(${t.regionId}::text, '')`,
    t.currency,
    t.effectiveDate,
  ),
]);

// =================================================================================================
// Conversion Ratios — type → type (Cherry → Parchment, Parchment → Green Bean). Carries an
// expected ratio plus min/max tolerance; outside tolerance triggers warnings during processing.
// processType labels the operation (Pulping, Drying, Hulling). Versioned by effectiveDate so old
// batches can audit against the rate that was active at the time.
// =================================================================================================
export const commodityConversionsTable = pgTable("commodity_conversions", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromCommodityTypeId: uuid("from_commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  toCommodityTypeId: uuid("to_commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  expectedRate: numeric("expected_rate", { precision: 18, scale: 8 }).notNull(),
  minRate: numeric("min_rate", { precision: 18, scale: 8 }),
  maxRate: numeric("max_rate", { precision: 18, scale: 8 }),
  processType: text("process_type"),
  effectiveDate: date("effective_date").notNull(),
  version: integer("version").notNull().default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_conversions_from_idx").on(t.fromCommodityTypeId),
  index("commodity_conversions_to_idx").on(t.toCommodityTypeId),
  // (from, to, effectiveDate, version) — allows multiple versions issued on the same effective date
  // (e.g. v1 superseded by v2 mid-day after a recalibration). Latest-version wins per pair+date.
  uniqueIndex("commodity_conversions_pair_effective_version_uniq").on(
    t.fromCommodityTypeId, t.toCommodityTypeId, t.effectiveDate, t.version,
  ),
]);

// =================================================================================================
// Commodity Quality Specs — per-CommodityType QC parameters that the Sampling Module auto-loads
// when a sample is created. Each spec defines a measurable parameter (Moisture %, Defects %,
// Screen Size, Bean Density, Aflatoxin, etc.) with an acceptable range, unit, and the test method
// to use. `mandatory` means sampling MUST capture this parameter at the configured stages;
// `affectsPrice` means out-of-range values feed the QC pricing-adjustment formula.
//
// `appliesAtStages` is a JSON array of sample stage codes (field|pre_offload|post_offload|
// warehouse|processing|export) — null/empty means applies at every stage. This lets, for example,
// "Aflatoxin" only be required at the export stage while "Moisture" is required at every stage.
// =================================================================================================
export const commodityQualitySpecsTable = pgTable("commodity_quality_specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityTypeId: uuid("commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "cascade" }),
  parameterName: text("parameter_name").notNull(),
  parameterCode: text("parameter_code").notNull(),
  unit: text("unit"),
  minValue: numeric("min_value", { precision: 18, scale: 6 }),
  maxValue: numeric("max_value", { precision: 18, scale: 6 }),
  // Optional preferred / target value within the range (e.g. moisture target 12.5% with band 11–13).
  targetValue: numeric("target_value", { precision: 18, scale: 6 }),
  methodUsed: text("method_used"),
  affectsPrice: boolean("affects_price").notNull().default(false),
  mandatory: boolean("mandatory").notNull().default(true),
  appliesAtStages: jsonb("applies_at_stages"),
  effectiveDate: date("effective_date").notNull(),
  version: integer("version").notNull().default(1),
  // 'active' | 'inactive' — inactive specs are kept for audit but no longer loaded by sampling.
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_quality_specs_type_idx").on(t.commodityTypeId),
  index("commodity_quality_specs_type_status_idx").on(t.commodityTypeId, t.status),
  // One active version of a parameter per type per effective date — supports re-versioning by
  // adding a new row with a higher `version` on the same date when a spec is corrected mid-day.
  uniqueIndex("commodity_quality_specs_type_param_effective_version_uniq").on(
    t.commodityTypeId, t.parameterCode, t.effectiveDate, t.version,
  ),
]);

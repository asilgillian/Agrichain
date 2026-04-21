import { pgTable, text, uuid, timestamp, date, numeric, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Master catalog of commodities traded by Mtandeo (e.g. Coffee, Maize, Beans, Cocoa).
export const commoditiesTable = pgTable("commodities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  // 'active' | 'inactive'
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("commodities_code_uniq").on(t.code),
]);

// Variants of a commodity (e.g. Coffee → Robusta / Arabica; Maize → Yellow / White).
// Harvest season is captured as month-of-year integers (1-12); a season may wrap across the year-end
// (e.g. start=10, end=2 means Oct..Feb).
export const commodityTypesTable = pgTable("commodity_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityId: uuid("commodity_id").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  defaultUnit: text("default_unit").notNull().default("kg"),
  // Form sold/received in (e.g. 'cherry', 'green_bean', 'parchment', 'whole_grain').
  // Used as the canonical/default form for prices unless overridden in the price row.
  defaultForm: text("default_form"),
  harvestSeasonStartMonth: integer("harvest_season_start_month"),
  harvestSeasonEndMonth: integer("harvest_season_end_month"),
  // 'active' | 'inactive'
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_types_commodity_idx").on(t.commodityId),
  uniqueIndex("commodity_types_commodity_code_uniq").on(t.commodityId, t.code),
]);

// Daily purchase price per kg per commodity type. Append-only: the "current" price is the row with
// the latest effectiveDate <= today (optionally scoped by region). Region NULL = national default.
// Form lets the same type carry distinct prices for different processing forms (cherry vs parchment).
export const commodityPricesTable = pgTable("commodity_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityTypeId: uuid("commodity_type_id").notNull(),
  regionId: uuid("region_id"),
  form: text("form"),
  pricePerKg: numeric("price_per_kg", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("UGX"),
  effectiveDate: date("effective_date").notNull(),
  source: text("source"),
  notes: text("notes"),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_prices_type_date_idx").on(t.commodityTypeId, t.effectiveDate),
  index("commodity_prices_type_region_date_idx").on(t.commodityTypeId, t.regionId, t.effectiveDate),
  // One canonical price per scope per day. NULL coalesced so national (regionId=NULL) and a missing
  // form still collide with each other and not silently duplicate.
  uniqueIndex("commodity_prices_scope_day_uniq").on(
    t.commodityTypeId,
    sql`coalesce(${t.regionId}::text, '')`,
    sql`coalesce(${t.form}, '')`,
    t.currency,
    t.effectiveDate,
  ),
]);

// Conversion ratios between two forms of the same commodity type.
// ratio = (toForm units) / (fromForm units). Example: 5 kg cherry → 1 kg green bean ⇒ ratio = 0.2.
export const commodityConversionsTable = pgTable("commodity_conversions", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityTypeId: uuid("commodity_type_id").notNull(),
  fromForm: text("from_form").notNull(),
  toForm: text("to_form").notNull(),
  ratio: numeric("ratio", { precision: 18, scale: 8 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_conversions_type_idx").on(t.commodityTypeId),
  uniqueIndex("commodity_conversions_type_from_to_uniq").on(t.commodityTypeId, t.fromForm, t.toForm),
]);

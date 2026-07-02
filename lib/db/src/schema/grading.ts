import { pgTable, text, uuid, timestamp, date, numeric, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { commodityTypesTable } from "./commodities";

// =================================================================================================
// Grading Profiles — multi-output transformation setup that the 1:1 `commodity_conversions` model
// cannot express. A single input commodity type (e.g. Coffee FAQ green) splits in ONE grading
// operation into several graded output products (Screen 18 / 15 / 12 / Undergrades) plus process
// loss / byproducts (dust, husks, sweepings). Kept entirely separate from `commodity_conversions`
// so the pulping/drying/hulling 1:1 path is untouched.
//
// A profile names the input type and carries a list of output rows (see grading_profile_outputs),
// each with an expected yield %. Versioned by effectiveDate; status toggles active/inactive.
// =================================================================================================
export const gradingProfilesTable = pgTable("grading_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  inputCommodityTypeId: uuid("input_commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  // 'active' | 'inactive' — inactive profiles are retained for audit but hidden from run pickers.
  status: text("status").notNull().default("active"),
  effectiveDate: date("effective_date").notNull(),
  notes: text("notes"),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("grading_profiles_input_idx").on(t.inputCommodityTypeId),
  index("grading_profiles_input_status_idx").on(t.inputCommodityTypeId, t.status),
]);

// =================================================================================================
// Grading Profile Outputs — one row per output of a grading profile. Sellable grades reference a
// finished commodity type (Screen 18/15/12/Undergrades); loss/byproduct rows carry isSellable=false
// and may have a null commodity type (loss is not a sellable product) with a free-text `label`.
// `expectedYieldPct` is the planned share of input mass; optional min/max give a tolerance band.
// =================================================================================================
export const gradingProfileOutputsTable = pgTable("grading_profile_outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  gradingProfileId: uuid("grading_profile_id").notNull().references(() => gradingProfilesTable.id, { onDelete: "cascade" }),
  // Null for loss/byproduct rows (loss is not a sellable commodity type).
  outputCommodityTypeId: uuid("output_commodity_type_id").references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  // Display label — required for loss/byproduct rows, optional for sellable rows (falls back to the
  // commodity type name in the UI).
  label: text("label"),
  expectedYieldPct: numeric("expected_yield_pct", { precision: 6, scale: 3 }).notNull(),
  minYieldPct: numeric("min_yield_pct", { precision: 6, scale: 3 }),
  maxYieldPct: numeric("max_yield_pct", { precision: 6, scale: 3 }),
  // false => loss / byproduct line (not booked into sellable inventory).
  isSellable: boolean("is_sellable").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("grading_profile_outputs_profile_idx").on(t.gradingProfileId),
]);

// =================================================================================================
// Grading Runs — an actual execution of a grading profile against a quantity of input. Captures the
// input weight and, per output, the actual kg recovered. The reconciliation remainder
// (input − sum(actual outputs)) is recorded as process loss so input mass always balances:
//   sum(graded outputs) + lossKg = inputWeightKg.
// Optionally tied to a silo batch (siloBatchId) when grading is run on warehouse stock.
// =================================================================================================
export const gradingRunsTable = pgTable("grading_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runNumber: text("run_number").notNull().unique(),
  gradingProfileId: uuid("grading_profile_id").notNull().references(() => gradingProfilesTable.id, { onDelete: "restrict" }),
  // Optional link to the silo batch whose stock was graded. Nullable so ad-hoc grading runs that
  // are not tied to a tracked silo batch are still valid.
  siloBatchId: uuid("silo_batch_id"),
  // Snapshot of the profile's input type at run time (profile may be re-pointed later).
  inputCommodityTypeId: uuid("input_commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  inputWeightKg: numeric("input_weight_kg", { precision: 14, scale: 2 }).notNull(),
  totalOutputKg: numeric("total_output_kg", { precision: 14, scale: 2 }).notNull(),
  lossKg: numeric("loss_kg", { precision: 14, scale: 2 }).notNull(),
  lossPct: numeric("loss_pct", { precision: 6, scale: 3 }).notNull(),
  status: text("status").notNull().default("completed"),
  notes: text("notes"),
  runById: uuid("run_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("grading_runs_profile_idx").on(t.gradingProfileId),
  index("grading_runs_silo_batch_idx").on(t.siloBatchId),
  uniqueIndex("grading_runs_run_number_uniq").on(t.runNumber),
]);

// =================================================================================================
// Grading Run Outputs — per-grade result of a grading run. Each sellable row is booked graded
// inventory of `outputCommodityTypeId` weighing `actualWeightKg`. Stores expected vs actual yield
// and the signed variance (actual − expected) for at-a-glance QC against the profile.
// =================================================================================================
export const gradingRunOutputsTable = pgTable("grading_run_outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  gradingRunId: uuid("grading_run_id").notNull().references(() => gradingRunsTable.id, { onDelete: "cascade" }),
  // Snapshot link to the profile output row this result came from (nullable for safety).
  gradingProfileOutputId: uuid("grading_profile_output_id"),
  outputCommodityTypeId: uuid("output_commodity_type_id").references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  label: text("label"),
  isSellable: boolean("is_sellable").notNull().default(true),
  expectedYieldPct: numeric("expected_yield_pct", { precision: 6, scale: 3 }).notNull(),
  actualWeightKg: numeric("actual_weight_kg", { precision: 14, scale: 2 }).notNull(),
  actualYieldPct: numeric("actual_yield_pct", { precision: 6, scale: 3 }).notNull(),
  variancePct: numeric("variance_pct", { precision: 7, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("grading_run_outputs_run_idx").on(t.gradingRunId),
]);

// =================================================================================================
// Commodity Stock Movements — the warehouse stock ledger keyed by commodity type. Completing a
// grading run books REAL inventory rows here so graded coffee becomes tracked, sellable stock and
// the consumed input is drawn down. Weights are SIGNED: positive = booked into stock, negative =
// drawn down / consumed. The net balance per commodity type (sum of weightKg) is the current
// warehouse stock of that type, surfaced on the warehouse mass-balance report.
//   - 'grading_input'  : one negative row per run for the input commodity type (input consumed)
//   - 'grading_output' : one positive row per sellable graded output (loss/byproduct excluded)
// =================================================================================================
export const commodityStockMovementsTable = pgTable("commodity_stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityTypeId: uuid("commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "restrict" }),
  // Signed: positive books stock in, negative draws it down.
  weightKg: numeric("weight_kg", { precision: 14, scale: 2 }).notNull(),
  // 'grading_input' | 'grading_output'
  movementType: text("movement_type").notNull(),
  // Provenance links. gradingRunId cascades so removing a run reverses its stock movements.
  gradingRunId: uuid("grading_run_id").references(() => gradingRunsTable.id, { onDelete: "cascade" }),
  gradingRunOutputId: uuid("grading_run_output_id"),
  // Optional link to the source silo batch whose stock was graded.
  siloBatchId: uuid("silo_batch_id"),
  notes: text("notes"),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commodity_stock_movements_type_idx").on(t.commodityTypeId),
  index("commodity_stock_movements_run_idx").on(t.gradingRunId),
]);

export type GradingProfile = typeof gradingProfilesTable.$inferSelect;
export type GradingProfileOutput = typeof gradingProfileOutputsTable.$inferSelect;
export type GradingRun = typeof gradingRunsTable.$inferSelect;
export type GradingRunOutput = typeof gradingRunOutputsTable.$inferSelect;
export type CommodityStockMovement = typeof commodityStockMovementsTable.$inferSelect;

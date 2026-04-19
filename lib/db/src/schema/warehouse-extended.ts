import { pgTable, text, uuid, timestamp, numeric, boolean, doublePrecision, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const silosTable = pgTable("silos", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  facilityId: text("facility_id"),
  stream: text("stream").notNull(),
  commodityType: text("commodity_type"),
  capacityKg: numeric("capacity_kg", { precision: 14, scale: 2 }),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | IDLE | CLEANING | MAINTENANCE
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siloAssignmentsTable = pgTable("silo_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull().unique(),
  siloId: uuid("silo_id").notNull(),
  receivedWeightKg: numeric("received_weight_kg", { precision: 14, scale: 2 }),
  assignedById: uuid("assigned_by_id"),
  overrideReason: text("override_reason"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siloBatchesTable = pgTable("silo_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchNumber: text("batch_number").notNull().unique(),
  siloId: uuid("silo_id").notNull(),
  streams: text("streams").array(),
  status: text("status").notNull().default("OPEN"), // OPEN | PROCESSING | CLOSED
  inputWeightKg: numeric("input_weight_kg", { precision: 14, scale: 2 }).notNull().default("0"),
  outputWeightKg: numeric("output_weight_kg", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const siloBatchProcessesTable = pgTable("silo_batch_processes", {
  id: uuid("id").primaryKey().defaultRandom(),
  siloBatchId: uuid("silo_batch_id").notNull(),
  processName: text("process_name").notNull(),
  inputWeightKg: numeric("input_weight_kg", { precision: 14, scale: 2 }).notNull(),
  outputWeightKg: numeric("output_weight_kg", { precision: 14, scale: 2 }),
  expectedOuturnPct: numeric("expected_outturn_pct", { precision: 6, scale: 3 }),
  actualOuturnPct: numeric("actual_outturn_pct", { precision: 6, scale: 3 }),
  parameters: jsonb("parameters"),
  qualitySignoff: text("quality_signoff").notNull().default("PENDING"),
  qualitySignedById: uuid("quality_signed_by_id"),
  qualitySignedAt: timestamp("quality_signed_at", { withTimezone: true }),
  warehouseSignoff: text("warehouse_signoff").notNull().default("PENDING"),
  warehouseSignedById: uuid("warehouse_signed_by_id"),
  warehouseSignedAt: timestamp("warehouse_signed_at", { withTimezone: true }),
  photoUrls: text("photo_urls").array(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storageBinsTable = pgTable("storage_bins", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  facilityId: text("facility_id"),
  stream: text("stream").notNull(),
  commodityType: text("commodity_type"),
  capacityKg: numeric("capacity_kg", { precision: 14, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const warehouseAssignmentsTable = pgTable("warehouse_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull().unique(),
  binId: uuid("bin_id").notNull(),
  bagCount: integer("bag_count"),
  receivedWeightKg: numeric("received_weight_kg", { precision: 14, scale: 2 }),
  currentWeightKg: numeric("current_weight_kg", { precision: 14, scale: 2 }),
  condition: text("condition"),
  photoUrls: text("photo_urls").array(),
  assignedById: uuid("assigned_by_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockMovementsTable = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  warehouseAssignmentId: uuid("warehouse_assignment_id").notNull(),
  fromBinId: uuid("from_bin_id"),
  toBinId: uuid("to_bin_id"),
  movementType: text("movement_type").notNull(), // INTERNAL_TRANSFER | DISPATCH | WRITE_OFF | ADJUSTMENT
  weightKg: numeric("weight_kg", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  reference: text("reference"),
  performedById: uuid("performed_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const preprocessingStepsTable = pgTable("preprocessing_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  cropType: text("crop_type"),
  defaultDeductionPct: numeric("default_deduction_pct", { precision: 6, scale: 3 }).notNull(),
  minDeductionPct: numeric("min_deduction_pct", { precision: 6, scale: 3 }).notNull(),
  maxDeductionPct: numeric("max_deduction_pct", { precision: 6, scale: 3 }).notNull(),
  isFixed: boolean("is_fixed").notNull().default(false),
  isMandatory: boolean("is_mandatory").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSiloSchema = createInsertSchema(silosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSilo = z.infer<typeof insertSiloSchema>;
export type Silo = typeof silosTable.$inferSelect;

export const insertStorageBinSchema = createInsertSchema(storageBinsTable).omit({ id: true, createdAt: true });
export type InsertStorageBin = z.infer<typeof insertStorageBinSchema>;
export type StorageBin = typeof storageBinsTable.$inferSelect;

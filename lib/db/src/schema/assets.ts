import { pgTable, text, uuid, timestamp, date, numeric, integer, boolean, doublePrecision, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetCategoriesTable = pgTable("asset_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  depreciationMethod: text("depreciation_method").notNull().default("STRAIGHT_LINE"),
  usefulLifeYears: doublePrecision("useful_life_years"),
  residualValuePct: doublePrecision("residual_value_pct"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assetsTable = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetCode: text("asset_code").notNull().unique(),
  categoryId: uuid("category_id"),
  type: text("type").notNull(),
  serialNumber: text("serial_number"),
  make: text("make"),
  model: text("model"),
  purchaseDate: date("purchase_date").notNull(),
  purchaseValue: numeric("purchase_value", { precision: 12, scale: 2 }).notNull(),
  currentBookValue: numeric("current_book_value", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("available"),
  assignedToUserId: uuid("assigned_to_user_id"),
  photoUrl: text("photo_url"),
  qrCode: text("qr_code"),
  notes: text("notes"),
  maintenanceDueDate: date("maintenance_due_date"),
  assignmentHistory: jsonb("assignment_history").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assetAssignmentsTable = pgTable("asset_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull(),
  staffUserId: uuid("staff_user_id").notNull(),
  conditionAtHandover: text("condition_at_handover"),
  conditionAtReturn: text("condition_at_return"),
  photoAtHandoverUrl: text("photo_at_handover_url"),
  photoAtReturnUrl: text("photo_at_return_url"),
  assignedById: uuid("assigned_by_id").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  returnedById: uuid("returned_by_id"),
  damageNote: text("damage_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const maintenanceSchedulesTable = pgTable("maintenance_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull(),
  intervalDays: integer("interval_days").notNull(),
  lastServiceDate: date("last_service_date"),
  nextServiceDate: date("next_service_date"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const maintenanceLogsTable = pgTable("maintenance_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull(),
  serviceDate: date("service_date").notNull(),
  description: text("description"),
  technicianName: text("technician_name"),
  cost: numeric("cost", { precision: 12, scale: 2 }),
  nextServiceDate: date("next_service_date"),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetCategorySchema = createInsertSchema(assetCategoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssetCategory = z.infer<typeof insertAssetCategorySchema>;
export type AssetCategory = typeof assetCategoriesTable.$inferSelect;

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, assetCode: true, createdAt: true, updatedAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;

export const insertAssetAssignmentSchema = createInsertSchema(assetAssignmentsTable).omit({ id: true, createdAt: true });
export type InsertAssetAssignment = z.infer<typeof insertAssetAssignmentSchema>;
export type AssetAssignment = typeof assetAssignmentsTable.$inferSelect;

export const insertMaintenanceLogSchema = createInsertSchema(maintenanceLogsTable).omit({ id: true, createdAt: true });
export type InsertMaintenanceLog = z.infer<typeof insertMaintenanceLogSchema>;
export type MaintenanceLog = typeof maintenanceLogsTable.$inferSelect;

import { pgTable, text, uuid, timestamp, date, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetsTable = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetCode: text("asset_code").notNull().unique(),
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
  maintenanceDueDate: date("maintenance_due_date"),
  assignmentHistory: jsonb("assignment_history").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, assetCode: true, createdAt: true, updatedAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;

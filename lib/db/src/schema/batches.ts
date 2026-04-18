import { pgTable, text, uuid, timestamp, date, numeric, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const batchesTable = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchTag: text("batch_tag").notNull().unique(),
  agentId: uuid("agent_id").notNull(),
  cropType: text("crop_type").notNull(),
  totalWeightKg: numeric("total_weight_kg", { precision: 12, scale: 3 }).notNull().default("0"),
  farmerCount: integer("farmer_count").notNull().default(0),
  qualifyingStreams: text("qualifying_streams").array().notNull().default([]),
  status: text("status").notNull().default("open"),
  harvestDate: date("harvest_date").notNull(),
  farmerContributions: jsonb("farmer_contributions").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBatchSchema = createInsertSchema(batchesTable).omit({ id: true, batchTag: true, createdAt: true, updatedAt: true });
export type InsertBatch = z.infer<typeof insertBatchSchema>;
export type Batch = typeof batchesTable.$inferSelect;

import { pgTable, text, uuid, timestamp, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const deliveriesTable = pgTable("deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotTag: text("lot_tag").notNull().unique(),
  batchId: uuid("batch_id").notNull(),
  stationId: uuid("station_id"),
  grossWeightKg: numeric("gross_weight_kg", { precision: 12, scale: 3 }),
  tareWeightKg: numeric("tare_weight_kg", { precision: 12, scale: 3 }),
  netWeightKg: numeric("net_weight_kg", { precision: 12, scale: 3 }),
  weightVarianceKg: numeric("weight_variance_kg", { precision: 12, scale: 3 }),
  moistureContent: numeric("moisture_content", { precision: 5, scale: 2 }),
  defectCount: numeric("defect_count", { precision: 6, scale: 1 }),
  cupScore: numeric("cup_score", { precision: 5, scale: 2 }),
  grade: text("grade"),
  pricePerKg: numeric("price_per_kg", { precision: 10, scale: 4 }),
  totalValue: numeric("total_value", { precision: 14, scale: 2 }),
  qualifyingStreams: text("qualifying_streams").array().notNull().default([]),
  weightApproved: boolean("weight_approved").notNull().default(false),
  qcApproved: boolean("qc_approved").notNull().default(false),
  status: text("status").notNull().default("pending_weight"),
  rejectionType: text("rejection_type"),
  rejectionReason: text("rejection_reason"),
  pricingDeductions: jsonb("pricing_deductions"),
  pricingIncentives: jsonb("pricing_incentives"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDeliverySchema = createInsertSchema(deliveriesTable).omit({ id: true, lotTag: true, createdAt: true, updatedAt: true });
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type Delivery = typeof deliveriesTable.$inferSelect;

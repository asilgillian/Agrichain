import { pgTable, text, uuid, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const lotsTable = pgTable("lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotTag: text("lot_tag").notNull().unique(),
  deliveryId: uuid("delivery_id").notNull(),
  weightKg: numeric("weight_kg", { precision: 12, scale: 3 }).notNull().default("0"),
  certificationStreams: text("certification_streams").array().notNull().default([]),
  siloId: text("silo_id"),
  status: text("status").notNull().default("received"),
  chainOfCustody: text("chain_of_custody").array().notNull().default([]),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLotSchema = createInsertSchema(lotsTable).omit({ id: true, receivedAt: true, updatedAt: true });
export type InsertLot = z.infer<typeof insertLotSchema>;
export type Lot = typeof lotsTable.$inferSelect;

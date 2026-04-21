import { pgTable, text, uuid, timestamp, date, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Pre-season / per-delivery contracts between MTANDEO and a farmer group.
// Pre-season contracts carry a floor price that procurement pricing must respect.
export const procurementContractsTable = pgTable("procurement_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractNumber: text("contract_number").notNull().unique(),
  contractType: text("contract_type").notNull(), // PRE_SEASON | PER_DELIVERY
  groupId: uuid("group_id").notNull(),
  commodityType: text("commodity_type").notNull(),
  seasonStart: date("season_start"),
  seasonEnd: date("season_end"),
  floorPricePerKg: numeric("floor_price_per_kg", { precision: 10, scale: 4 }),
  currency: text("currency").notNull().default("UGX"),
  notes: text("notes"),
  status: text("status").notNull().default("DRAFT"), // DRAFT | ACTIVE | EXPIRED | SUSPENDED
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProcurementContractSchema = createInsertSchema(procurementContractsTable).omit({
  id: true,
  contractNumber: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProcurementContract = z.infer<typeof insertProcurementContractSchema>;
export type ProcurementContract = typeof procurementContractsTable.$inferSelect;

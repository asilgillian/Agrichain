import { pgTable, uuid, numeric, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { commoditiesTable } from "./commodities";
import { farmersTable } from "./farmers";

// =================================================================================================
// Farmer Crops — what each farmer grows. M:N between farmers and commodities, with the most
// recent harvest amount/date captured at registration time. The harvest fields are nullable
// because some farmers register before their first season and have no production yet.
// Replaces / complements the free-text plot.cropType field by linking to the commodity master.
// =================================================================================================
export const farmerCropsTable = pgTable("farmer_crops", {
  id: uuid("id").primaryKey().defaultRandom(),
  farmerId: uuid("farmer_id").notNull().references(() => farmersTable.id, { onDelete: "cascade" }),
  commodityId: uuid("commodity_id").notNull().references(() => commoditiesTable.id, { onDelete: "restrict" }),
  lastHarvestKg: numeric("last_harvest_kg", { precision: 12, scale: 2 }),
  lastHarvestDate: date("last_harvest_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("farmer_crops_farmer_commodity_uniq").on(t.farmerId, t.commodityId),
]);

export const insertFarmerCropSchema = createInsertSchema(farmerCropsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFarmerCrop = z.infer<typeof insertFarmerCropSchema>;
export type FarmerCrop = typeof farmerCropsTable.$inferSelect;

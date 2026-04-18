import { pgTable, text, uuid, timestamp, date, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plotsTable = pgTable("plots", {
  id: uuid("id").primaryKey().defaultRandom(),
  farmerId: uuid("farmer_id").notNull(),
  name: text("name"),
  cropType: text("crop_type").notNull(),
  areaHectares: numeric("area_hectares", { precision: 10, scale: 4 }).notNull().default("0"),
  polygon: jsonb("polygon"),
  harvestDate: date("harvest_date"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlotSchema = createInsertSchema(plotsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlot = z.infer<typeof insertPlotSchema>;
export type Plot = typeof plotsTable.$inferSelect;

import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type HierarchyLevel = { level: number; name: string };

export const countryHierarchiesTable = pgTable("country_hierarchies", {
  countryCode: text("country_code").primaryKey(),
  countryName: text("country_name").notNull(),
  levels: jsonb("levels").$type<HierarchyLevel[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const HierarchyLevelSchema = z.object({
  level: z.number().int().min(1).max(10),
  name: z.string().min(1).max(60),
});

export const UpsertCountryHierarchyBody = z.object({
  countryCode: z.string().min(2).max(3).regex(/^[A-Z]+$/),
  countryName: z.string().min(2).max(80),
  levels: z.array(HierarchyLevelSchema).min(1).max(10),
});

export type CountryHierarchy = typeof countryHierarchiesTable.$inferSelect;

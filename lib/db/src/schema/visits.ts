import { pgTable, text, uuid, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const visitsTable = pgTable("visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  farmerId: uuid("farmer_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("scheduled"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVisitSchema = createInsertSchema(visitsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVisit = z.infer<typeof insertVisitSchema>;
export type Visit = typeof visitsTable.$inferSelect;

import { pgTable, text, uuid, timestamp, date, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityFundsTable = pgTable("activity_funds", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull(),
  activityType: text("activity_type").notNull(),
  plannedDate: date("planned_date").notNull(),
  destination: text("destination"),
  estimatedAmount: numeric("estimated_amount", { precision: 12, scale: 2 }).notNull(),
  approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
  actualAmount: numeric("actual_amount", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("KES"),
  status: text("status").notNull().default("pending"),
  approverComment: text("approver_comment"),
  lineItems: jsonb("line_items").notNull().default([]),
  disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivityFundSchema = createInsertSchema(activityFundsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertActivityFund = z.infer<typeof insertActivityFundSchema>;
export type ActivityFund = typeof activityFundsTable.$inferSelect;

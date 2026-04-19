import { pgTable, text, uuid, timestamp, date, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityTypesTable = pgTable("activity_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  maxAmount: numeric("max_amount", { precision: 12, scale: 2 }),
  isActive: text("is_active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityFundsTable = pgTable("activity_funds", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull(),
  activityTypeId: uuid("activity_type_id"),
  activityType: text("activity_type").notNull(),
  plannedDate: date("planned_date").notNull(),
  destination: text("destination"),
  estimatedAmount: numeric("estimated_amount", { precision: 12, scale: 2 }).notNull(),
  approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
  actualAmount: numeric("actual_amount", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("KES"),
  status: text("status").notNull().default("pending"), // DRAFT | PENDING_MANAGER | PENDING_FINANCE | APPROVED | DISBURSED | RECONCILED | REJECTED
  managerApprovedById: uuid("manager_approved_by_id"),
  managerApprovedAt: timestamp("manager_approved_at", { withTimezone: true }),
  financeApprovedById: uuid("finance_approved_by_id"),
  financeApprovedAt: timestamp("finance_approved_at", { withTimezone: true }),
  approverComment: text("approver_comment"),
  mobileMoneyRef: text("mobile_money_ref"),
  lineItems: jsonb("line_items").notNull().default([]),
  disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityReconciliationsTable = pgTable("activity_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  fundId: uuid("fund_id").notNull().unique(),
  actualSpend: jsonb("actual_spend").notNull().default([]),
  totalActual: numeric("total_actual", { precision: 12, scale: 2 }).notNull(),
  unspentBalance: numeric("unspent_balance", { precision: 12, scale: 2 }).notNull(),
  submittedById: uuid("submitted_by_id").notNull(),
  reviewedById: uuid("reviewed_by_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivityFundSchema = createInsertSchema(activityFundsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertActivityFund = z.infer<typeof insertActivityFundSchema>;
export type ActivityFund = typeof activityFundsTable.$inferSelect;

export const insertActivityTypeSchema = createInsertSchema(activityTypesTable).omit({ id: true, createdAt: true });
export type InsertActivityType = z.infer<typeof insertActivityTypeSchema>;
export type ActivityType = typeof activityTypesTable.$inferSelect;

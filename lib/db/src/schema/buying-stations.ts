import { pgTable, text, uuid, timestamp, numeric, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const buyingStationsTable = pgTable("buying_stations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  location: text("location"),
  gpsLat: doublePrecision("gps_lat"),
  gpsLng: doublePrecision("gps_lng"),
  managerUserId: uuid("manager_user_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentCashFloatsTable = pgTable("agent_cash_floats", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().unique(),
  currentBalance: numeric("current_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("KES"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cashFloatTransactionsTable = pgTable("cash_float_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  floatId: uuid("float_id").notNull(),
  type: text("type").notNull(), // DISBURSE | TOP_UP | RECONCILE | DEDUCTION
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }),
  reference: text("reference"),
  note: text("note"),
  performedById: uuid("performed_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBuyingStationSchema = createInsertSchema(buyingStationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBuyingStation = z.infer<typeof insertBuyingStationSchema>;
export type BuyingStation = typeof buyingStationsTable.$inferSelect;

export const insertCashFloatTransactionSchema = createInsertSchema(cashFloatTransactionsTable).omit({ id: true, createdAt: true });
export type InsertCashFloatTransaction = z.infer<typeof insertCashFloatTransactionSchema>;
export type CashFloatTransaction = typeof cashFloatTransactionsTable.$inferSelect;

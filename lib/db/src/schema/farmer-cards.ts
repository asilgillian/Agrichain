import { pgTable, text, uuid, timestamp, date, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const farmerCardsTable = pgTable("farmer_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  farmerId: uuid("farmer_id").notNull().unique(),
  registrationNumber: text("registration_number").notNull().unique(),
  qrCode: text("qr_code").notNull().unique(),
  barcode: text("barcode").notNull().unique(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | LOST | REPLACED | EXPIRED
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupLeadershipTable = pgTable("group_leadership", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  farmerId: uuid("farmer_id").notNull(),
  role: text("role").notNull(), // Chairperson | Secretary | Treasurer
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rejectionLogsTable = pgTable("rejection_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull(),
  step: text("step").notNull(), // WEIGHT_APPROVAL | QUALITY_APPROVAL | TRADE_DESK | PROCUREMENT_HEAD | FINANCE
  rejectionType: text("rejection_type").notNull(), // REJECT_FOR_CORRECTION | REJECT_COMMODITY | REJECT_AND_ESCALATE | PARTIAL_REJECTION | SUSPEND
  reason: text("reason").notNull(),
  rejectedById: uuid("rejected_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFarmerCardSchema = createInsertSchema(farmerCardsTable).omit({ id: true, createdAt: true });
export type InsertFarmerCard = z.infer<typeof insertFarmerCardSchema>;
export type FarmerCard = typeof farmerCardsTable.$inferSelect;

export const insertGroupLeadershipSchema = createInsertSchema(groupLeadershipTable).omit({ id: true, createdAt: true });
export type InsertGroupLeadership = z.infer<typeof insertGroupLeadershipSchema>;
export type GroupLeadership = typeof groupLeadershipTable.$inferSelect;

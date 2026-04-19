import { pgTable, text, uuid, timestamp, date, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const loansTable = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanNumber: text("loan_number").notNull().unique(),
  farmerId: uuid("farmer_id"),
  groupId: uuid("group_id"),
  loanType: text("loan_type").notNull(), // CASH_ADVANCE | INPUT_LOAN | EMERGENCY_WELFARE | STAFF_ADVANCE | GROUP_LOAN
  principalAmount: numeric("principal_amount", { precision: 14, scale: 2 }).notNull(),
  interestRatePct: numeric("interest_rate_pct", { precision: 6, scale: 3 }).default("0"),
  totalRepayable: numeric("total_repayable", { precision: 14, scale: 2 }),
  disbursedAmount: numeric("disbursed_amount", { precision: 14, scale: 2 }),
  outstandingBalance: numeric("outstanding_balance", { precision: 14, scale: 2 }),
  currency: text("currency").notNull().default("KES"),
  status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | DISBURSED | REPAYING | CLOSED | DEFAULTED | WRITTEN_OFF
  disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
  dueDate: date("due_date"),
  approvedById: uuid("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  disbursedById: uuid("disbursed_by_id"),
  purpose: text("purpose"),
  collateral: text("collateral"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loanRepaymentsTable = pgTable("loan_repayments", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method"),
  reference: text("reference"),
  collectedById: uuid("collected_by_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loanGuarantorsTable = pgTable("loan_guarantors", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull(),
  guarantorFarmerId: uuid("guarantor_farmer_id").notNull(),
  agreedAt: timestamp("agreed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLoanSchema = createInsertSchema(loansTable).omit({ id: true, loanNumber: true, createdAt: true, updatedAt: true });
export type InsertLoan = z.infer<typeof insertLoanSchema>;
export type Loan = typeof loansTable.$inferSelect;

export const insertLoanRepaymentSchema = createInsertSchema(loanRepaymentsTable).omit({ id: true, createdAt: true });
export type InsertLoanRepayment = z.infer<typeof insertLoanRepaymentSchema>;
export type LoanRepayment = typeof loanRepaymentsTable.$inferSelect;

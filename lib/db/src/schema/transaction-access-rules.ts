import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Admin-controlled rules that gate which farmer registration stage is required
// to participate in each downstream transaction type. Exactly one row per
// txn_type. Stage rank: pre_registered < partially_registered < fully_registered.
// A farmer's current stage must be >= the rule's required_stage or the
// transaction is rejected with code REGISTRATION_INSUFFICIENT.
export const transactionAccessRulesTable = pgTable(
  "transaction_access_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // `delivery` | `payment` | `loan` | `certification`
    txnType: text("txn_type").notNull(),
    // `pre_registered` | `partially_registered` | `fully_registered`
    requiredStage: text("required_stage").notNull().default("fully_registered"),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedById: uuid("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => ({
    txnTypeUniqueIdx: uniqueIndex("transaction_access_rules_txn_type_idx").on(t.txnType),
  }),
);

export type TransactionAccessRule = typeof transactionAccessRulesTable.$inferSelect;
export type NewTransactionAccessRule = typeof transactionAccessRulesTable.$inferInsert;

// Numeric rank used for stage comparisons across the codebase. Keep in sync
// with the registrationStage values written by the farmers routes.
export const STAGE_RANK: Record<string, number> = {
  pre_registered: 0,
  partially_registered: 1,
  fully_registered: 2,
};

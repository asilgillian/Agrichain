import { pgTable, text, uuid, timestamp, numeric, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Polymorphic payee: a payment settles a delivery that belongs to either a
  // farmer (farmerId) or a third-party supplier (supplierId). Exactly one is
  // set, mirroring the delivery's seller. Both are nullable at the column level;
  // the application layer derives which from the delivery being paid.
  farmerId: uuid("farmer_id"),
  supplierId: uuid("supplier_id"),
  deliveryId: uuid("delivery_id").notNull(),
  amountDue: numeric("amount_due", { precision: 14, scale: 2 }).notNull(),
  amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }),
  currency: text("currency").notNull().default("KES"),
  paymentMethod: text("payment_method").notNull(), // cash | mtn_momo | airtel_money
  status: text("status").notNull().default("pending"), // pending | paid | failed | pending_external
  paymentReference: text("payment_reference"),
  // Mobile-money fields. msisdn is the recipient phone in +256… format; momoProvider
  // records which gateway ('mtn_momo' | 'airtel_money'); providerTxnId holds the
  // gateway reference used to query authoritative status / reconcile callbacks.
  msisdn: text("msisdn"),
  momoProvider: text("momo_provider"),
  providerTxnId: text("provider_txn_id"),
  failureReason: text("failure_reason"),
  // How many times a failed mobile-money disbursement has been retried.
  retryCount: integer("retry_count").notNull().default(0),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // DB-authoritative duplicate-payment guard: at most one ACTIVE payment per
  // (delivery, farmer). Failed/cancelled rows are excluded so a retry after a
  // genuine failure remains possible. The application layer also pre-checks,
  // but this index is the race-safe last word.
  activePerDeliveryFarmer: uniqueIndex("payments_active_delivery_farmer_uniq")
    .on(t.deliveryId, t.farmerId)
    .where(sql`${t.status} in ('paid','pending','pending_external')`),
  // Same guard for supplier payouts: at most one ACTIVE payment per
  // (delivery, supplier).
  activePerDeliverySupplier: uniqueIndex("payments_active_delivery_supplier_uniq")
    .on(t.deliveryId, t.supplierId)
    .where(sql`${t.status} in ('paid','pending','pending_external')`),
}));

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;

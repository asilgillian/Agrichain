import { pgTable, text, uuid, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { farmersTable } from "./farmers";

// =================================================================================================
// Suppliers — Third-Party Sellers.
// Non-farmer entities we buy coffee from. A supplier is either a BUSINESS
// (trading name + business registration number) or an INDIVIDUAL (name +
// national id). They are tracked for compliance/traceability like farmers and
// sell coffee through the SAME delivery → batch → payment procurement pipeline.
// `loanEligible` is a default-off foundation flag for possible future
// third-party lending — no lending flow is wired to it yet.
// =================================================================================================
export const suppliersTable = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Human-readable system-generated reference (e.g. SUP-XXXXXX).
  referenceNumber: text("reference_number").notNull().unique(),
  // 'business' | 'individual'
  sellerType: text("seller_type").notNull(),

  // ----- Business fields (sellerType = 'business') -----
  businessName: text("business_name"),
  businessRegNo: text("business_reg_no"),

  // ----- Individual fields (sellerType = 'individual') -----
  firstName: text("first_name"),
  lastName: text("last_name"),
  nationalId: text("national_id"),

  // ----- Contact -----
  phoneNumber: text("phone_number"),
  email: text("email"),

  // ----- Location (loose — third parties may not map to the admin hierarchy) -----
  regionId: uuid("region_id"),
  village: text("village"),
  address: text("address"),

  // ----- Payment details -----
  // 'cash' | 'mobile_money' | 'bank_transfer'
  paymentMethod: text("payment_method"),
  momoProvider: text("momo_provider"), // 'mtn_momo' | 'airtel_money'
  momoMsisdn: text("momo_msisdn"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),

  // ----- Status + eligibility -----
  // 'pending' | 'active' | 'inactive'
  status: text("status").notNull().default("pending"),
  // Foundation flag for future third-party loans. No lending flow uses it yet.
  loanEligible: boolean("loan_eligible").notNull().default(false),

  // Optional link to a registered farmer. Set when this third-party supplier
  // is the SAME real-world person as a farmer in the registry (e.g. an
  // entrepreneur farmer who also sells under a separate supplier record). Lets
  // reports recognize the two records as one identity. NULL = no known farmer
  // counterpart. ON DELETE SET NULL so deleting the farmer just clears the link.
  farmerId: uuid("farmer_id").references(() => farmersTable.id, { onDelete: "set null" }),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("suppliers_seller_type_idx").on(t.sellerType),
  index("suppliers_status_idx").on(t.status),
  uniqueIndex("suppliers_national_id_uniq").on(t.nationalId),
  uniqueIndex("suppliers_business_reg_no_uniq").on(t.businessRegNo),
  // A farmer maps to at most one supplier record (multiple NULLs allowed).
  uniqueIndex("suppliers_farmer_id_uniq").on(t.farmerId),
]);

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({ id: true, referenceNumber: true, createdAt: true, updatedAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;

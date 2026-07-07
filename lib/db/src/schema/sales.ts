import { pgTable, text, uuid, timestamp, date, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const buyersTable = pgTable("buyers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  country: text("country"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  acceptedStreams: text("accepted_streams").array(),
  gradeRequirements: text("grade_requirements"),
  originRequirements: text("origin_requirements"),
  creditTermsDays: integer("credit_terms_days"),
  paymentMethod: text("payment_method"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesContractsTable = pgTable("sales_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractNumber: text("contract_number").notNull().unique(),
  buyerId: uuid("buyer_id").notNull(),
  contractType: text("contract_type").notNull(), // FORWARD | LOCAL_SALE | INTERCOMPANY_TRANSFER | PRE_SEASON | PER_DELIVERY
  commodityType: text("commodity_type"),
  grade: text("grade"),
  targetQuantityKg: numeric("target_quantity_kg", { precision: 14, scale: 2 }),
  agreedPricePerKg: numeric("agreed_price_per_kg", { precision: 10, scale: 4 }),
  currency: text("currency").notNull().default("USD"),
  deliveryWindowStart: date("delivery_window_start"),
  deliveryWindowEnd: date("delivery_window_end"),
  incoterms: text("incoterms"),
  certificationRequired: text("certification_required"),
  status: text("status").notNull().default("DRAFT"), // DRAFT | APPROVED | STOCK_ALLOCATED | PARTIALLY_FULFILLED | FULLY_FULFILLED | CLOSED | CANCELLED
  approvedById: uuid("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractAllocationsTable = pgTable("contract_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull(),
  lotId: uuid("lot_id").notNull(),
  allocatedWeightKg: numeric("allocated_weight_kg", { precision: 14, scale: 2 }).notNull(),
  allocatedById: uuid("allocated_by_id"),
  allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
  deallocatedAt: timestamp("deallocated_at", { withTimezone: true }),
  deallocatedById: uuid("deallocated_by_id"),
  deallocateReason: text("deallocate_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dispatchesTable = pgTable("dispatches", {
  id: uuid("id").primaryKey().defaultRandom(),
  dispatchNumber: text("dispatch_number").notNull().unique(),
  contractId: uuid("contract_id"),
  // Optional link to a graded commodity type. When set, creating the dispatch draws the dispatch
  // weight down from the commodity stock ledger (commodity_stock_movements, 'sale_dispatch').
  commodityTypeId: uuid("commodity_type_id"),
  containerNumber: text("container_number"),
  sealNumber: text("seal_number"),
  truckReg: text("truck_reg"),
  driverName: text("driver_name"),
  dispatchWeightKg: numeric("dispatch_weight_kg", { precision: 14, scale: 2 }),
  isManualWeight: boolean("is_manual_weight").notNull().default(false),
  weightOverrideReason: text("weight_override_reason"),
  status: text("status").notNull().default("PENDING"), // PENDING | LOADED | IN_TRANSIT | DELIVERED | CANCELLED
  loadedAt: timestamp("loaded_at", { withTimezone: true }),
  loadedById: uuid("loaded_by_id"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoicesTable = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  contractId: uuid("contract_id").notNull(),
  dispatchId: uuid("dispatch_id"),
  dispatchWeightKg: numeric("dispatch_weight_kg", { precision: 14, scale: 2 }),
  pricePerKg: numeric("price_per_kg", { precision: 10, scale: 4 }),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("DRAFT"), // DRAFT | SENT | PARTIALLY_PAID | PAID | OVERDUE | CANCELLED
  sentAt: timestamp("sent_at", { withTimezone: true }),
  dueDate: date("due_date"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  approvedById: uuid("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBuyerSchema = createInsertSchema(buyersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBuyer = z.infer<typeof insertBuyerSchema>;
export type Buyer = typeof buyersTable.$inferSelect;

export const insertSalesContractSchema = createInsertSchema(salesContractsTable).omit({ id: true, contractNumber: true, createdAt: true, updatedAt: true });
export type InsertSalesContract = z.infer<typeof insertSalesContractSchema>;
export type SalesContract = typeof salesContractsTable.$inferSelect;

export const insertDispatchSchema = createInsertSchema(dispatchesTable).omit({ id: true, dispatchNumber: true, createdAt: true, updatedAt: true });
export type InsertDispatch = z.infer<typeof insertDispatchSchema>;
export type Dispatch = typeof dispatchesTable.$inferSelect;

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, invoiceNumber: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

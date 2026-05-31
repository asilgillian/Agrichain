import { pgTable, text, uuid, timestamp, numeric, boolean, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { commodityTypesTable } from "./commodities";

// =================================================================================================
// Loan Catalog — Phase 1 of the Loan Management Module.
// Categories group products (e.g. Input Loans → NPK Fertiliser, Urea Fertiliser, Coffee Seedlings).
// Products carry the rate, recovery, and behavioural rules; ProductItems list the in-kind
// inventory line items for input loans (Fertiliser 50kg, Fertiliser 25kg, …).
// The actual Loan / Repayment / Restructure / WriteOff tables are added in Phase 2 once the
// catalog UX is approved.
// =================================================================================================
export const loanCategoriesTable = pgTable("loan_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  // Rate defaults live on the category — products inherit unless they override.
  // 'flat' | 'reducing' | 'none'
  interestType: text("interest_type").notNull().default("flat"),
  interestRate: numeric("interest_rate", { precision: 6, scale: 3 }).notNull().default("0"),
  penaltyRate: numeric("penalty_rate", { precision: 6, scale: 3 }).notNull().default("0"),
  gracePeriodDays: integer("grace_period_days").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("loan_categories_name_uniq").on(t.name),
]);

export const loanProductsTable = pgTable("loan_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanCategoryId: uuid("loan_category_id").notNull().references(() => loanCategoriesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  // Optional: products that recover from a specific commodity (e.g. coffee delivery).
  commodityTypeId: uuid("commodity_type_id").references(() => commodityTypesTable.id, { onDelete: "set null" }),
  // 'INPUT' (in-kind: principal = unitPrice × quantity at issuance time)
  // | 'CASH' (operator-entered principal; credit-limit gated later).
  productType: text("product_type").notNull().default("CASH"),
  // INPUT: price per unit (UGX). Required by API for INPUT products; ignored for CASH.
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }),
  // Human-readable unit label (e.g. "50kg bag", "kg", "litre"). Inventory link comes later.
  unit: text("unit"),
  // Rate fields below are NULLABLE — null means "inherit the category default".
  // A non-null value is an explicit per-product override.
  interestType: text("interest_type"),
  interestRate: numeric("interest_rate", { precision: 6, scale: 3 }),
  penaltyRate: numeric("penalty_rate", { precision: 6, scale: 3 }),
  gracePeriodDays: integer("grace_period_days"),
  maxAmount: numeric("max_amount", { precision: 14, scale: 2 }),
  maxRestructures: integer("max_restructures").notNull().default(0),
  // 'auto_deduct' | 'manual' | 'hybrid'
  repaymentMethod: text("repayment_method").notNull().default("auto_deduct"),
  recoveryPriority: integer("recovery_priority").notNull().default(100),
  allowPartialRepayment: boolean("allow_partial_repayment").notNull().default(true),
  allowFinanceOverride: boolean("allow_finance_override").notNull().default(true),
  seasonBased: boolean("season_based").notNull().default(false),
  // When true, this product may only be issued to farmers flagged as
  // entrepreneurs (farmers.isEntrepreneur). Default off — existing products
  // remain available to all farmers.
  entrepreneursOnly: boolean("entrepreneurs_only").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("loan_products_category_idx").on(t.loanCategoryId),
  index("loan_products_commodity_idx").on(t.commodityTypeId),
  uniqueIndex("loan_products_category_name_uniq").on(t.loanCategoryId, t.name),
]);

export const loanProductItemsTable = pgTable("loan_product_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanProductId: uuid("loan_product_id").notNull().references(() => loanProductsTable.id, { onDelete: "cascade" }),
  itemName: text("item_name").notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  // Optional links (no FK yet — inventory & suppliers modules don't exist in Phase 1).
  inventoryItemId: uuid("inventory_item_id"),
  supplierId: uuid("supplier_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("loan_product_items_product_idx").on(t.loanProductId),
]);

export type LoanCategory = typeof loanCategoriesTable.$inferSelect;
export type LoanProduct = typeof loanProductsTable.$inferSelect;
export type LoanProductItem = typeof loanProductItemsTable.$inferSelect;

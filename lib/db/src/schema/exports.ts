import { pgTable, text, uuid, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const exportContractsTable = pgTable("export_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractNumber: text("contract_number").notNull().unique(),
  buyer: text("buyer").notNull(),
  destination: text("destination").notNull(),
  cropType: text("crop_type").notNull(),
  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 }).notNull(),
  pricePerKg: numeric("price_per_kg", { precision: 10, scale: 4 }).notNull(),
  certificationRequired: text("certification_required"),
  deliveryDate: date("delivery_date"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentsTable = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull(),
  // Optional link to a graded commodity type. When set, creating the shipment draws the shipment
  // weight down from the commodity stock ledger (commodity_stock_movements, 'export_shipment').
  commodityTypeId: uuid("commodity_type_id"),
  containerNumber: text("container_number"),
  vesselName: text("vessel_name"),
  portOfLoading: text("port_of_loading"),
  portOfDestination: text("port_of_destination"),
  shipmentDate: date("shipment_date"),
  totalWeightKg: numeric("total_weight_kg", { precision: 12, scale: 3 }),
  status: text("status").notNull().default("preparing"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exportDocumentsTable = pgTable("export_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  fileUrl: text("file_url"),
  status: text("status").notNull().default("draft"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExportContractSchema = createInsertSchema(exportContractsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExportContract = z.infer<typeof insertExportContractSchema>;
export type ExportContract = typeof exportContractsTable.$inferSelect;

export const insertShipmentSchema = createInsertSchema(shipmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipmentsTable.$inferSelect;

import { pgTable, text, uuid, timestamp, numeric, boolean, jsonb, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const deliveriesTable = pgTable("deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotTag: text("lot_tag").notNull().unique(),
  // Human-readable system-generated delivery number issued at capture time
  // (e.g. DLV-20260513-0007). Used by the field UI and printed receipts.
  deliveryNumber: text("delivery_number").notNull().unique(),
  // Polymorphic seller model: every delivery belongs to exactly one seller —
  // either a farmer (farmerId) OR a third-party supplier (supplierId), enforced
  // by the `delivery_seller_exactly_one` CHECK below. It carries an explicit
  // cropType chosen from the master commodity catalog. `batchId` is nullable —
  // a delivery starts life "captured" and is attached to a batch later (only
  // with other same-crop deliveries).
  farmerId: uuid("farmer_id"),
  supplierId: uuid("supplier_id"),
  cropType: text("crop_type").notNull(),
  // Captured weight at intake (kg). Stays distinct from grossWeightKg /
  // netWeightKg, which are recorded later by the station scale.
  capturedWeightKg: numeric("captured_weight_kg", { precision: 12, scale: 3 }).notNull(),
  // Audit trail: who captured this delivery in the field, and when. Used
  // to scope the mobile "my captured deliveries" list and to filter the
  // batch-grouping picker by agent.
  capturedById: uuid("captured_by_id"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow(),
  batchId: uuid("batch_id"),
  stationId: uuid("station_id"),
  truckPlate: text("truck_plate"),
  driverName: text("driver_name"),

  grossWeightKg: numeric("gross_weight_kg", { precision: 12, scale: 3 }),
  tareWeightKg: numeric("tare_weight_kg", { precision: 12, scale: 3 }),
  netWeightKg: numeric("net_weight_kg", { precision: 12, scale: 3 }),
  weightVarianceKg: numeric("weight_variance_kg", { precision: 12, scale: 3 }),

  weightSubmittedById: uuid("weight_submitted_by_id"),
  weightSubmittedAt: timestamp("weight_submitted_at", { withTimezone: true }),
  weightApprovedById: uuid("weight_approved_by_id"),
  weightApprovedAt: timestamp("weight_approved_at", { withTimezone: true }),
  weightApproved: boolean("weight_approved").notNull().default(false),

  moistureContent: numeric("moisture_content", { precision: 5, scale: 2 }),
  defectCount: numeric("defect_count", { precision: 6, scale: 1 }),
  cupScore: numeric("cup_score", { precision: 5, scale: 2 }),
  grade: text("grade"),

  qcSampleId: uuid("qc_sample_id"), // populated when QC values come from a Sampling Module sample
  qcSubmittedById: uuid("qc_submitted_by_id"),
  qcSubmittedAt: timestamp("qc_submitted_at", { withTimezone: true }),
  qcApprovedById: uuid("qc_approved_by_id"),
  qcApprovedAt: timestamp("qc_approved_at", { withTimezone: true }),
  qcApproved: boolean("qc_approved").notNull().default(false),

  pricePerKg: numeric("price_per_kg", { precision: 10, scale: 4 }),
  totalValue: numeric("total_value", { precision: 14, scale: 2 }),
  pricingDeductions: jsonb("pricing_deductions"),
  pricingIncentives: jsonb("pricing_incentives"),
  pricingProposedById: uuid("pricing_proposed_by_id"),
  pricingProposedAt: timestamp("pricing_proposed_at", { withTimezone: true }),
  pricingApprovedById: uuid("pricing_approved_by_id"),
  pricingApprovedAt: timestamp("pricing_approved_at", { withTimezone: true }),
  contractId: uuid("contract_id"),
  floorPricePerKg: numeric("floor_price_per_kg", { precision: 10, scale: 4 }),

  qualifyingStreams: text("qualifying_streams").array().notNull().default([]),

  // Workflow binding — pinned at delivery creation. currentStageOrder mirrors
  // `procurement_workflow_stages.orderIdx`; the engine reads the row at that index to determine
  // what kind of action is expected next.
  workflowId: uuid("workflow_id"),
  currentStageOrder: integer("current_stage_order").notNull().default(0),

  // status state machine. Adds `captured` (unbatched, freshly recorded by the
  // field agent) as the new initial state; once attached to a batch and that
  // batch is sent to a station, the existing weight/QC/pricing/approval flow
  // takes over.
  // captured, pending_weight_submit, pending_weight_approve, pending_qc_submit,
  // pending_qc_approve, pending_pricing_propose, pending_pricing_approve, approved,
  // rejected_correction, rejected_commodity, rejected_escalate, partial_rejection, suspended
  status: text("status").notNull().default("captured"),
  rejectionType: text("rejection_type"), // CORRECTION | COMMODITY | ESCALATE | PARTIAL | SUSPEND
  rejectionStage: text("rejection_stage"), // weight | qc | pricing | final
  rejectionReason: text("rejection_reason"),
  rejectionById: uuid("rejection_by_id"),
  rejectionAt: timestamp("rejection_at", { withTimezone: true }),

  preOffloadSampleTaken: boolean("pre_offload_sample_taken").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // A delivery must reference EXACTLY ONE seller: a farmer or a third-party
  // supplier, never both, never neither. Enforced at the database level.
  check(
    "delivery_seller_exactly_one",
    sql`((${t.farmerId} IS NOT NULL)::int + (${t.supplierId} IS NOT NULL)::int) = 1`,
  ),
]);

export const insertDeliverySchema = createInsertSchema(deliveriesTable).omit({ id: true, lotTag: true, createdAt: true, updatedAt: true });
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type Delivery = typeof deliveriesTable.$inferSelect;

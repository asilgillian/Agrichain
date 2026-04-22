import { pgTable, text, uuid, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Procurement workflow master.
// Each workflow defines an ordered list of stages a delivery must pass through.
// At delivery creation the engine resolves a workflow (commodity-specific active OR default active)
// and pins it on the delivery; stage progression is then driven from `procurement_workflow_stages`
// at runtime.
export const procurementWorkflowsTable = pgTable("procurement_workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // short slug e.g. DEFAULT, COFFEE_EXPRESS
  name: text("name").notNull(),
  description: text("description"),
  commodityType: text("commodity_type"), // null = applies to any commodity (default fallback)
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // exactly one ACTIVE row should be default per commodityType bucket
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Stage kinds the engine knows how to handle. The 6 canonical kinds map to the existing handlers
// (weight/qc/pricing submit + approve). INFO_CHECKPOINT is a manual sign-off step (free-text note).
// Admins choose which kinds are present, in what order, and customize display name + permission.
export const STAGE_KINDS = [
  "WEIGHT_SUBMIT",
  "WEIGHT_APPROVE",
  "QC_SUBMIT",
  "QC_APPROVE",
  "PRICING_PROPOSE",
  "PRICING_APPROVE",
  "INFO_CHECKPOINT",
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const procurementWorkflowStagesTable = pgTable(
  "procurement_workflow_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").notNull(),
    stageKind: text("stage_kind").notNull(), // one of STAGE_KINDS
    orderIdx: integer("order_idx").notNull(), // 0-based position; engine advances by next-active-orderIdx
    displayName: text("display_name").notNull(),
    description: text("description"),
    requiredPermission: text("required_permission"), // null = use the engine's built-in default for that kind
    slaHours: integer("sla_hours"), // soft target; surfaced in UI; not enforced by engine yet
    isActive: boolean("is_active").notNull().default(true),
    isOptional: boolean("is_optional").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqOrder: uniqueIndex("procurement_workflow_stages_workflow_order_uniq").on(t.workflowId, t.orderIdx),
  }),
);

export const insertProcurementWorkflowSchema = createInsertSchema(procurementWorkflowsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProcurementWorkflow = z.infer<typeof insertProcurementWorkflowSchema>;
export type ProcurementWorkflow = typeof procurementWorkflowsTable.$inferSelect;

export const insertProcurementWorkflowStageSchema = createInsertSchema(procurementWorkflowStagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProcurementWorkflowStage = z.infer<typeof insertProcurementWorkflowStageSchema>;
export type ProcurementWorkflowStage = typeof procurementWorkflowStagesTable.$inferSelect;

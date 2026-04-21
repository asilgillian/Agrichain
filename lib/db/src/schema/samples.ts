import { pgTable, text, uuid, timestamp, integer, numeric, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { commodityTypesTable, samplingConfigsTable } from "./commodities";
import { usersTable } from "./users";

// =================================================================================================
// Samples — physical samples drawn at any operational stage. Each sample is linked to ONE
// upstream entity (farmer at field stage, batch at bulking, lot at warehouse, silo batch at
// processing, container at export). The samplingConfigId + samplingConfigVersion fields are a
// SNAPSHOT of the rule active at capture time, so historical samples remain interpretable even
// after the underlying configuration is re-versioned. clientGeneratedId enables idempotent
// offline-first capture: mobile devices generate a UUID locally and replay it on sync; the
// server uses it as a dedup key.
// =================================================================================================
export const samplesTable = pgTable("samples", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Auto-generated human-friendly code, e.g. "SMP-2026-000001". Used for QR/barcode printing.
  sampleCode: text("sample_code").notNull(),

  commodityTypeId: uuid("commodity_type_id").notNull().references(() => commodityTypesTable.id, { onDelete: "restrict" }),

  // Snapshot of the sampling-config row that was active when this sample was captured. Nullable
  // because samples may be drawn ad-hoc with no governing rule (override flow).
  samplingConfigId: uuid("sampling_config_id").references(() => samplingConfigsTable.id, { onDelete: "set null" }),
  samplingConfigVersion: integer("sampling_config_version"),
  // Full immutable snapshot of the sampling-config row at capture time. Survives subsequent
  // edits or deletion of the source config so historical interpretability is durable.
  samplingConfigSnapshot: jsonb("sampling_config_snapshot"),

  // 'field' | 'pre_offload' | 'post_offload' | 'warehouse' | 'processing' | 'export'
  stage: text("stage").notNull(),

  // Polymorphic link to the upstream entity. linkedEntityType determines which table linkedEntityId
  // points at: 'farmer' | 'batch' | 'lot' | 'silo_batch' | 'container'.
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: text("linked_entity_id").notNull(),

  // 'grab' | 'composite' | 'incremental'
  samplingMethod: text("sampling_method").notNull(),

  // When the sample was physically collected (NOT when it was synced). For offline captures this
  // is the device-local time at the moment of collection.
  collectionDate: timestamp("collection_date", { withTimezone: true }).notNull(),

  // GPS at point of collection. Stored at high precision; accuracyM is the device-reported radius.
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  gpsAccuracyM: numeric("gps_accuracy_m", { precision: 10, scale: 2 }),

  collectorId: uuid("collector_id").references(() => usersTable.id, { onDelete: "set null" }),

  // Physical sample details.
  sampleWeightKg: numeric("sample_weight_kg", { precision: 12, scale: 4 }),
  subSampleCount: integer("sub_sample_count").notNull().default(1),
  containerType: text("container_type"),
  sealNumber: text("seal_number"),

  // jsonb array of photo URLs (object-storage refs or external URLs). Empty array = no evidence.
  photoUrls: jsonb("photo_urls").notNull().default([]),

  // 'collected' | 'lab_pending' | 'completed' | 'rejected' | 'voided'
  status: text("status").notNull().default("collected"),

  notes: text("notes"),

  // Offline-first sync fields. clientGeneratedId is the dedup key — same id replayed = same row.
  clientGeneratedId: text("client_generated_id"),
  clientCreatedAt: timestamp("client_created_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("samples_code_uniq").on(t.sampleCode),
  uniqueIndex("samples_client_id_uniq").on(t.clientGeneratedId),
  index("samples_type_idx").on(t.commodityTypeId),
  index("samples_stage_idx").on(t.stage),
  index("samples_linked_idx").on(t.linkedEntityType, t.linkedEntityId),
  index("samples_collector_idx").on(t.collectorId),
  index("samples_collected_idx").on(t.collectionDate),
  index("samples_status_idx").on(t.status),
]);

export type Sample = typeof samplesTable.$inferSelect;
export type InsertSample = typeof samplesTable.$inferInsert;

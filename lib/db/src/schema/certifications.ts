import { pgTable, text, uuid, timestamp, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const certificationStreamsTable = pgTable("certification_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  requiresGpsPolygon: boolean("requires_gps_polygon").notNull().default(false),
  eligibilityCriteria: text("eligibility_criteria").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const certificationEnrolmentsTable = pgTable("certification_enrolments", {
  id: uuid("id").primaryKey().defaultRandom(),
  farmerId: uuid("farmer_id").notNull(),
  streamId: uuid("stream_id").notNull(),
  enrolmentDate: date("enrolment_date").notNull(),
  expiryDate: date("expiry_date"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCertStreamSchema = createInsertSchema(certificationStreamsTable).omit({ id: true, createdAt: true });
export type InsertCertStream = z.infer<typeof insertCertStreamSchema>;
export type CertStream = typeof certificationStreamsTable.$inferSelect;

export const insertEnrolmentSchema = createInsertSchema(certificationEnrolmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnrolment = z.infer<typeof insertEnrolmentSchema>;
export type Enrolment = typeof certificationEnrolmentsTable.$inferSelect;

import { pgTable, text, uuid, timestamp, numeric, jsonb, date, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gapAssessmentsTable = pgTable("gap_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  farmerId: uuid("farmer_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  overallScore: numeric("overall_score", { precision: 6, scale: 2 }).notNull().default("0"),
  maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull().default("0"),
  criteria: jsonb("criteria").notNull().default([]),
  status: text("status").notNull().default("pending_review"),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainingSessionsTable = pgTable("training_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  location: text("location"),
  facilitatorId: uuid("facilitator_id").notNull(),
  attendeeCount: integer("attendee_count").notNull().default(0),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGapAssessmentSchema = createInsertSchema(gapAssessmentsTable).omit({ id: true, assessedAt: true, updatedAt: true });
export type InsertGapAssessment = z.infer<typeof insertGapAssessmentSchema>;
export type GapAssessment = typeof gapAssessmentsTable.$inferSelect;

export const insertTrainingSessionSchema = createInsertSchema(trainingSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrainingSession = z.infer<typeof insertTrainingSessionSchema>;
export type TrainingSession = typeof trainingSessionsTable.$inferSelect;

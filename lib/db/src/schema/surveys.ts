import { pgTable, text, uuid, timestamp, boolean, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const surveyTemplatesTable = pgTable("survey_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  fields: jsonb("fields").notNull().default([]),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const surveySubmissionsTable = pgTable("survey_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull(),
  farmerId: uuid("farmer_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  responses: jsonb("responses").notNull().default({}),
  gpsLat: numeric("gps_lat", { precision: 10, scale: 7 }),
  gpsLng: numeric("gps_lng", { precision: 10, scale: 7 }),
  status: text("status").notNull().default("pending"),
  reviewComment: text("review_comment"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const insertSurveyTemplateSchema = createInsertSchema(surveyTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSurveyTemplate = z.infer<typeof insertSurveyTemplateSchema>;
export type SurveyTemplate = typeof surveyTemplatesTable.$inferSelect;

export const insertSurveySubmissionSchema = createInsertSchema(surveySubmissionsTable).omit({ id: true, submittedAt: true, reviewedAt: true });
export type InsertSurveySubmission = z.infer<typeof insertSurveySubmissionSchema>;
export type SurveySubmission = typeof surveySubmissionsTable.$inferSelect;

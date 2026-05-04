import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// A registration "survey template" — admin-editable definition of which fields
// the mobile registration / completion flow asks for, which are mandatory, and
// which are optional. Per-country (countryCode = 'UG') with a global fallback
// (countryCode = null). Only one template per scope can be `is_active` at a
// time; we enforce that with the partial unique indexes below so the database
// itself rejects ambiguous activations.
export const registrationTemplatesTable = pgTable(
  "registration_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    // Null means the template is a global fallback used when no country-specific
    // template is active. Otherwise scoped to a 2-letter country code (UG/KE/…)
    countryCode: text("country_code"),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // At most one active template per country.
    activePerCountryIdx: uniqueIndex("registration_templates_active_per_country_idx")
      .on(t.countryCode)
      .where(sql`is_active = true AND country_code IS NOT NULL`),
    // At most one active global (countryCode = null) template.
    activeGlobalIdx: uniqueIndex("registration_templates_active_global_idx")
      .on(t.isActive)
      .where(sql`is_active = true AND country_code IS NULL`),
  }),
);

// Field-level definition for a template: identifies a known core field (by
// `field_key` matching the catalog in api-server/src/lib/known-registration-fields.ts)
// or a custom field added by the admin. `source` tells the mobile/web renderer
// which surface owns the value: `core_farmer` and `core_livelihood` map to
// columns on the farmers table; `custom` values land in farmer_custom_field_values.
export const registrationTemplateFieldsTable = pgTable(
  "registration_template_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => registrationTemplatesTable.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    // `text` | `number` | `date` | `choice` | `multichoice` | `yesno`
    fieldType: text("field_type").notNull(),
    required: boolean("required").notNull().default(false),
    // For `choice`/`multichoice`: array of {value,label}. Null otherwise.
    options: jsonb("options"),
    // Sort order within the template (ascending). Ties broken by created_at.
    sortOrder: integer("sort_order").notNull().default(0),
    // `core_farmer` | `core_livelihood` | `custom`
    source: text("source").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyPerTemplateIdx: uniqueIndex("registration_template_fields_key_per_template_idx")
      .on(t.templateId, t.fieldKey),
    templateOrderIdx: index("registration_template_fields_template_order_idx")
      .on(t.templateId, t.sortOrder),
  }),
);

export type RegistrationTemplate = typeof registrationTemplatesTable.$inferSelect;
export type NewRegistrationTemplate = typeof registrationTemplatesTable.$inferInsert;
export type RegistrationTemplateField = typeof registrationTemplateFieldsTable.$inferSelect;
export type NewRegistrationTemplateField = typeof registrationTemplateFieldsTable.$inferInsert;

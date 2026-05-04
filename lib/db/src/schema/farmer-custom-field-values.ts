import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { farmersTable } from "./farmers";

// Per-farmer values for admin-defined CUSTOM fields (source='custom' on the
// active registration template). Core fields live as columns on farmersTable;
// only custom fields land here. Stored as text and parsed/cast at read time
// according to the field_type recorded on the template field. We deliberately
// do NOT FK field_key to registration_template_fields — admins can deactivate
// a field without losing the historic captured values.
export const farmerCustomFieldValuesTable = pgTable(
  "farmer_custom_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    farmerId: uuid("farmer_id")
      .notNull()
      .references(() => farmersTable.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    value: text("value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perFarmerKeyIdx: uniqueIndex("farmer_custom_field_values_per_farmer_key_idx")
      .on(t.farmerId, t.fieldKey),
  }),
);

export type FarmerCustomFieldValue = typeof farmerCustomFieldValuesTable.$inferSelect;
export type NewFarmerCustomFieldValue = typeof farmerCustomFieldValuesTable.$inferInsert;

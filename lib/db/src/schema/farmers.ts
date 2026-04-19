import { pgTable, text, uuid, timestamp, date, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const farmersTable = pgTable("farmers", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceNumber: text("reference_number").notNull().unique(),
  preRegRef: text("pre_reg_ref"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  nationalId: text("national_id"),
  dateOfBirth: date("date_of_birth"),
  phoneNumber: text("phone_number"),
  sex: text("sex"),
  groupId: uuid("group_id").notNull(),
  regionId: uuid("region_id").notNull(),
  village: text("village"),
  status: text("status").notNull().default("active"),
  photoUrl: text("photo_url"),
  biometricPhotoUrl: text("biometric_photo_url"),
  householdSize: integer("household_size"),
  dependants: integer("dependants"),
  headOfHousehold: text("head_of_household"),
  landTenure: text("land_tenure"),
  registrationDate: date("registration_date"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedById: uuid("approved_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFarmerSchema = createInsertSchema(farmersTable).omit({ id: true, referenceNumber: true, createdAt: true, updatedAt: true });
export type InsertFarmer = z.infer<typeof insertFarmerSchema>;
export type Farmer = typeof farmersTable.$inferSelect;

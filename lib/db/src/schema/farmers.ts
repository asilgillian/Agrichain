import { pgTable, text, uuid, timestamp, date, integer, boolean, numeric } from "drizzle-orm/pg-core";
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
  // 'pre_registered' (light/initial capture) or 'fully_registered' (KYC + group + region complete).
  // Defaults to 'fully_registered' so existing rows keep working without backfill.
  registrationStage: text("registration_stage").notNull().default("fully_registered"),
  preRegisteredAt: timestamp("pre_registered_at", { withTimezone: true }),
  fullyRegisteredAt: timestamp("fully_registered_at", { withTimezone: true }),
  photoUrl: text("photo_url"),
  biometricPhotoUrl: text("biometric_photo_url"),
  householdSize: integer("household_size"),
  dependants: integer("dependants"),
  headOfHousehold: text("head_of_household"),
  landTenure: text("land_tenure"),
  registrationDate: date("registration_date"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedById: uuid("approved_by_id"),
  // ----- Entrepreneur upgrade -----
  // An existing farmer can be upgraded to a "farmer entrepreneur" (a coffee-
  // bulking agent), which makes them eligible for entrepreneur-only bulking
  // loans. This is a status on top of the existing farmer record — they keep
  // their plots, group, and history. Default off for back-compat.
  isEntrepreneur: boolean("is_entrepreneur").notNull().default(false),
  entrepreneurSince: timestamp("entrepreneur_since", { withTimezone: true }),
  // ----- Farm activities + livelihood (captured at full registration; nullable for back-compat) -----
  // otherActivities is a Postgres text[] of free chips (Livestock, Fishing, Beekeeping, ...).
  // text[] is preferred over jsonb here because (a) values are short scalars, (b) it lets us
  // GIN-index later for "farmers who do livestock" queries without parsing JSON.
  otherActivities: text("other_activities").array(),
  cultivatedLandHa: numeric("cultivated_land_ha", { precision: 8, scale: 3 }),
  // Free text but front-end uses fixed chips. Kept as text so we can add new sources without a migration.
  offFarmIncomeSource: text("off_farm_income_source"),
  offFarmIncomeMonthlyUgx: integer("off_farm_income_monthly_ugx"),
  monthsOfFoodShortage: integer("months_of_food_shortage"),
  educationLevelHead: text("education_level_head"),
  accessCleanWater: boolean("access_clean_water"),
  accessElectricity: boolean("access_electricity"),
  primaryCookingFuel: text("primary_cooking_fuel"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFarmerSchema = createInsertSchema(farmersTable).omit({ id: true, referenceNumber: true, createdAt: true, updatedAt: true });
export type InsertFarmer = z.infer<typeof insertFarmerSchema>;
export type Farmer = typeof farmersTable.$inferSelect;

import { pgTable, text, uuid, timestamp, boolean, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { regionsTable } from "./regions";

export const orgRegionsTable = pgTable(
  "org_regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    countryCode: text("country_code").notNull().default("UG"),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUniquePerCountry: uniqueIndex("org_regions_country_lower_name_uq").on(
      t.countryCode,
      sql`lower(${t.name})`,
    ),
  }),
);

export const orgRegionDistrictsTable = pgTable(
  "org_region_districts",
  {
    orgRegionId: uuid("org_region_id")
      .notNull()
      .references(() => orgRegionsTable.id, { onDelete: "cascade" }),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regionsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgRegionId, t.regionId] }),
  }),
);

export type OrgRegion = typeof orgRegionsTable.$inferSelect;
export type OrgRegionDistrict = typeof orgRegionDistrictsTable.$inferSelect;

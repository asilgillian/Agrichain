import { pgTable, text, uuid, timestamp, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const groupsTable = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  regionId: uuid("region_id").notNull(),
  village: text("village"),
  parish: text("parish"),
  subCounty: text("sub_county"),
  district: text("district"),
  // Hierarchy: a group (producer group) may be linked to a parent cooperative / association.
  parentGroupId: uuid("parent_group_id"),
  // 'cooperative' | 'association' | 'producer_group'
  groupType: text("group_type").notNull().default("producer_group"),
  // 'active' | 'archived'
  status: text("status").notNull().default("active"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedById: uuid("archived_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Group leadership positions with term dates.
// E.g. chairperson, secretary, treasurer, extension_lead, gender_lead.
export const groupLeadersTable = pgTable("group_leaders", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  farmerId: uuid("farmer_id").notNull(),
  position: text("position").notNull(),
  termStart: date("term_start").notNull(),
  termEnd: date("term_end"),
  // 'active' | 'ended'
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("group_leaders_group_idx").on(t.groupId),
  index("group_leaders_farmer_idx").on(t.farmerId),
]);

// Append-only audit of every farmer group change — required for transfer traceability.
export const groupTransfersTable = pgTable("group_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  farmerId: uuid("farmer_id").notNull(),
  fromGroupId: uuid("from_group_id"),
  toGroupId: uuid("to_group_id").notNull(),
  reason: text("reason").notNull(),
  actorId: uuid("actor_id"),
  actorName: text("actor_name"),
  // 'transfer' | 'bulk_reassign' | 'archive_redistribute'
  kind: text("kind").notNull().default("transfer"),
  transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("group_transfers_farmer_idx").on(t.farmerId),
  index("group_transfers_to_group_idx").on(t.toGroupId),
]);

export const insertGroupSchema = createInsertSchema(groupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groupsTable.$inferSelect;
export type GroupLeader = typeof groupLeadersTable.$inferSelect;
export type GroupTransfer = typeof groupTransfersTable.$inferSelect;

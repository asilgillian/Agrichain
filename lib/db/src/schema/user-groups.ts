import { pgTable, uuid, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Many-to-many assignment between system users (field staff) and farmer groups.
// A user with the `groups.assigned_only` permission only sees groups (and the
// farmers in those groups) listed here. Users without that permission see
// everything (back-office default).
export const userGroupsTable = pgTable("user_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  assignedById: uuid("assigned_by_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_groups_user_group_unique").on(t.userId, t.groupId),
  index("user_groups_user_idx").on(t.userId),
  index("user_groups_group_idx").on(t.groupId),
]);

export const insertUserGroupSchema = createInsertSchema(userGroupsTable).omit({
  id: true,
  assignedAt: true,
});
export type InsertUserGroup = z.infer<typeof insertUserGroupSchema>;
export type UserGroup = typeof userGroupsTable.$inferSelect;

import { pgTable, uuid, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { rolesTable } from "./roles";

// Many-to-many extra roles for a user. The user's primary role lives on
// users.role; this table holds ADDITIONAL roles whose permissions are unioned
// into the effective permission set at request time. FK cascades keep the
// join table clean when a user or role is deleted.
export const userRolesTable = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  assignedById: uuid("assigned_by_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index("user_roles_user_idx").on(t.userId),
  index("user_roles_role_idx").on(t.roleId),
]);

export const insertUserRoleSchema = createInsertSchema(userRolesTable).omit({
  assignedAt: true,
});
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRole = typeof userRolesTable.$inferSelect;

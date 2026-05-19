import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db, usersTable, userGroupsTable, groupsTable, userRolesTable, rolesTable } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, ListUsersQueryParams } from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/users", requirePermission("users.read"), async (req, res): Promise<void> => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { role, regionId, status } = parsed.data;
  const conditions: any[] = [];
  if (role) conditions.push(eq(usersTable.role, role));
  if (regionId) conditions.push(eq(usersTable.regionId, regionId));
  if (status) conditions.push(eq(usersTable.status, status));

  const users = conditions.length > 0
    ? await db.select().from(usersTable).where(and(...conditions)).orderBy(desc(usersTable.createdAt))
    : await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(users);
});

router.post("/users", requirePermission("users.write"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.insert(usersTable).values(parsed.data).returning();
  res.status(201).json(user);
});

router.get("/users/:userId", requirePermission("users.read"), async (req, res): Promise<void> => {
  const { userId } = req.params;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId as string));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:userId", requirePermission("users.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { userId } = req.params;
  const raw = (req.body ?? {}) as Record<string, unknown>;
  // `extraRoleIds` is an optional sibling to the user fields. When supplied,
  // it replaces the full set of additional roles atomically alongside the
  // profile update (single transaction → no partial-update window).
  const extraRoleIdsRaw = raw.extraRoleIds;
  delete raw.extraRoleIds;

  const nullable: Record<string, null> = {};
  const stripped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null && (k === "managerId" || k === "regionId" || k === "phoneNumber")) {
      nullable[k] = null;
    } else {
      stripped[k] = v;
    }
  }
  const parsed = UpdateUserBody.safeParse(stripped);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let desiredExtras: string[] | undefined;
  if (extraRoleIdsRaw !== undefined) {
    if (!Array.isArray(extraRoleIdsRaw) || !extraRoleIdsRaw.every((g: unknown) => typeof g === "string" && UUID_RE.test(g))) {
      res.status(400).json({ error: "extraRoleIds must be an array of valid UUIDs" });
      return;
    }
    desiredExtras = Array.from(new Set(extraRoleIdsRaw as string[]));
  }

  const hasProfileUpdate = Object.keys(parsed.data).length > 0 || Object.keys(nullable).length > 0;
  const updateValues = { ...parsed.data, ...nullable, updatedAt: new Date() };

  try {
    const user = await db.transaction(async (tx) => {
      let updated: typeof usersTable.$inferSelect | undefined;
      if (hasProfileUpdate) {
        [updated] = await tx.update(usersTable).set(updateValues).where(eq(usersTable.id, userId as string)).returning();
      } else {
        [updated] = await tx.select().from(usersTable).where(eq(usersTable.id, userId as string));
      }
      if (!updated) return undefined;

      if (desiredExtras !== undefined) {
        let resolved: { id: string; name: string }[] = [];
        if (desiredExtras.length > 0) {
          resolved = await tx
            .select({ id: rolesTable.id, name: rolesTable.name })
            .from(rolesTable)
            .where(inArray(rolesTable.id, desiredExtras));
          if (resolved.length !== desiredExtras.length) {
            throw new Error("INVALID_ROLE_ID");
          }
        }
        const filtered = resolved.filter(r => r.name !== updated!.role).map(r => r.id);
        await tx.delete(userRolesTable).where(eq(userRolesTable.userId, userId as string));
        if (filtered.length > 0) {
          await tx.insert(userRolesTable).values(
            filtered.map(roleId => ({
              userId: userId as string,
              roleId,
              assignedById: req.authedUser?.id ?? null,
            })),
          );
        }
      }
      return updated;
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (err: any) {
    if (err?.message === "INVALID_ROLE_ID") {
      res.status(400).json({ error: "One or more extraRoleIds are invalid" });
      return;
    }
    throw err;
  }
});

// ------------- USER ↔ GROUP ASSIGNMENT -------------
// Many-to-many: a user can be assigned to N groups; mobile field staff with the
// `groups.assigned_only` permission only see groups (and farmers in those
// groups) listed in user_groups.

// Aggregate counts of group assignments per user, used by the Users table to
// show how many groups each user owns without firing N requests.
router.get("/users-group-counts", requirePermission("users.read"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      userId: userGroupsTable.userId,
      count: sql<number>`count(*)::int`,
    })
    .from(userGroupsTable)
    .groupBy(userGroupsTable.userId);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.userId] = Number(r.count);
  res.json(out);
});

router.get("/users/:userId/groups", requirePermission("users.read"), async (req, res): Promise<void> => {
  const { userId } = req.params;
  if (!UUID_RE.test(userId as string)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const rows = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      regionId: groupsTable.regionId,
      groupType: groupsTable.groupType,
      status: groupsTable.status,
      assignedAt: userGroupsTable.assignedAt,
    })
    .from(userGroupsTable)
    .innerJoin(groupsTable, eq(groupsTable.id, userGroupsTable.groupId))
    .where(eq(userGroupsTable.userId, userId as string))
    .orderBy(desc(userGroupsTable.assignedAt));
  res.json(rows);
});

// Replace-set semantics: PUT body {groupIds: string[]} becomes the new full
// assignment for the user. Idempotent — call with the same payload twice and
// the result is identical.
router.put("/users/:userId/groups", requirePermission("users.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { userId } = req.params;
  if (!UUID_RE.test(userId as string)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const body = req.body as { groupIds?: unknown };
  if (!Array.isArray(body.groupIds) || !body.groupIds.every(g => typeof g === "string" && UUID_RE.test(g))) {
    res.status(400).json({ error: "groupIds must be an array of valid UUIDs" });
    return;
  }
  const desired = Array.from(new Set(body.groupIds as string[]));

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId as string));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Verify every group exists.
  if (desired.length > 0) {
    const found = await db.select({ id: groupsTable.id }).from(groupsTable).where(inArray(groupsTable.id, desired));
    if (found.length !== desired.length) {
      res.status(400).json({ error: "One or more groupIds are invalid" });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(userGroupsTable).where(eq(userGroupsTable.userId, userId as string));
    if (desired.length > 0) {
      await tx.insert(userGroupsTable).values(
        desired.map(groupId => ({
          userId: userId as string,
          groupId,
          assignedById: req.authedUser?.id ?? null,
        })),
      );
    }
  });

  const result = await db
    .select({ id: groupsTable.id, name: groupsTable.name })
    .from(userGroupsTable)
    .innerJoin(groupsTable, eq(groupsTable.id, userGroupsTable.groupId))
    .where(eq(userGroupsTable.userId, userId as string));
  res.json({ userId, count: result.length, groups: result });
});

// ------------- USER ↔ EXTRA ROLES -------------
// A user has one primary role (users.role) plus zero or more additional roles
// here. Effective permissions = union(primary.permissions, extras[*].permissions).

router.get("/users/:userId/roles", requirePermission("users.read"), async (req, res): Promise<void> => {
  const { userId } = req.params;
  if (!UUID_RE.test(userId as string)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const rows = await db
    .select({ id: rolesTable.id, name: rolesTable.name, assignedAt: userRolesTable.assignedAt })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
    .where(eq(userRolesTable.userId, userId as string))
    .orderBy(desc(userRolesTable.assignedAt));
  res.json(rows);
});

// Replace-set semantics: PUT { roleIds: uuid[] } becomes the new full set of
// EXTRA roles (the primary role on users.role is unaffected and is silently
// removed from the payload if included).
router.put("/users/:userId/roles", requirePermission("users.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { userId } = req.params;
  if (!UUID_RE.test(userId as string)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const body = req.body as { roleIds?: unknown };
  if (!Array.isArray(body.roleIds) || !body.roleIds.every(g => typeof g === "string" && UUID_RE.test(g))) {
    res.status(400).json({ error: "roleIds must be an array of valid UUIDs" });
    return;
  }
  const desired = Array.from(new Set(body.roleIds as string[]));

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId as string));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Verify every role exists & strip the primary if it slipped in.
  let resolved: { id: string; name: string }[] = [];
  if (desired.length > 0) {
    resolved = await db
      .select({ id: rolesTable.id, name: rolesTable.name })
      .from(rolesTable)
      .where(inArray(rolesTable.id, desired));
    if (resolved.length !== desired.length) {
      res.status(400).json({ error: "One or more roleIds are invalid" });
      return;
    }
  }
  const filtered = resolved.filter(r => r.name !== target.role).map(r => r.id);

  await db.transaction(async (tx) => {
    await tx.delete(userRolesTable).where(eq(userRolesTable.userId, userId as string));
    if (filtered.length > 0) {
      await tx.insert(userRolesTable).values(
        filtered.map(roleId => ({
          userId: userId as string,
          roleId,
          assignedById: req.authedUser?.id ?? null,
        })),
      );
    }
  });

  const result = await db
    .select({ id: rolesTable.id, name: rolesTable.name })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
    .where(eq(userRolesTable.userId, userId as string));
  res.json({ userId, count: result.length, roles: result });
});

router.delete("/users/:userId/groups/:groupId", requirePermission("users.write"), async (req, res): Promise<void> => {
  const { userId, groupId } = req.params;
  if (!UUID_RE.test(userId as string) || !UUID_RE.test(groupId as string)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(userGroupsTable)
    .where(and(eq(userGroupsTable.userId, userId as string), eq(userGroupsTable.groupId, groupId as string)));
  res.status(204).end();
});

export default router;

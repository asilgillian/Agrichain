import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, sql, inArray } from "drizzle-orm";
import { db, usersTable, rolesTable, userRolesTable } from "@workspace/db";

export interface AuthedRequest extends Request {
  authedUser?: {
    id: string;
    clerkUserId: string;
    email: string;
    role: string;
    roles: string[]; // primary + extras, deduped
    permissions: string[];
  };
}

async function loadOrCreateUser(clerkUserId: string) {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
  if (existing) return existing;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    `${clerkUserId}@unknown.local`;
  const firstName = clerkUser.firstName ?? "";
  const lastName = clerkUser.lastName ?? "";

  const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (byEmail) {
    const [updated] = await db.update(usersTable).set({ clerkUserId }).where(eq(usersTable.id, byEmail.id)).returning();
    return updated;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);
  const isFirstUser = Number(count) === 0;

  const [created] = await db.insert(usersTable).values({
    firstName: firstName || email.split("@")[0],
    lastName: lastName || "",
    email,
    clerkUserId,
    role: isFirstUser ? "SystemAdministrator" : "Pending",
    status: "active",
  }).returning();
  return created;
}

async function loadEffectiveRolesAndPermissions(
  userId: string,
  primaryRoleName: string,
): Promise<{ roles: string[]; permissions: string[] }> {
  // Primary role row (may not exist for ad-hoc names like "Pending")
  const [primaryRole] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.name, primaryRoleName));

  // Additional roles via the join table
  const extraRoleIds = await db
    .select({ roleId: userRolesTable.roleId })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));

  const extraRoles = extraRoleIds.length > 0
    ? await db
        .select()
        .from(rolesTable)
        .where(inArray(rolesTable.id, extraRoleIds.map(r => r.roleId)))
    : [];

  const roleNames = new Set<string>();
  roleNames.add(primaryRoleName);
  extraRoles.forEach(r => roleNames.add(r.name));

  const perms = new Set<string>();
  (primaryRole?.permissions ?? []).forEach(p => perms.add(p));
  extraRoles.forEach(r => (r.permissions ?? []).forEach(p => perms.add(p)));

  return { roles: Array.from(roleNames), permissions: Array.from(perms) };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const user = await loadOrCreateUser(clerkUserId);
    const { roles, permissions } = await loadEffectiveRolesAndPermissions(user.id, user.role);
    req.authedUser = {
      id: user.id,
      clerkUserId,
      email: user.email,
      role: user.role,
      roles,
      permissions,
    };
    next();
  } catch (err) {
    req.log?.error({ err }, "auth middleware failed");
    res.status(500).json({ error: "Auth failed" });
  }
}

export function requirePermission(permission: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const u = req.authedUser;
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (u.permissions.includes("*") || u.permissions.includes(permission)) {
      next();
      return;
    }
    res.status(403).json({ error: `Forbidden — requires ${permission}` });
  };
}

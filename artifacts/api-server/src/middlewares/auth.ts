import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable, rolesTable } from "@workspace/db";

export interface AuthedRequest extends Request {
  authedUser?: {
    id: string;
    clerkUserId: string;
    email: string;
    role: string;
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

  const [created] = await db.insert(usersTable).values({
    firstName: firstName || email.split("@")[0],
    lastName: lastName || "",
    email,
    clerkUserId,
    role: "Pending",
    status: "active",
  }).returning();
  return created;
}

async function permissionsForRole(roleName: string): Promise<string[]> {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.name, roleName));
  return role?.permissions ?? [];
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
    const permissions = await permissionsForRole(user.role);
    req.authedUser = {
      id: user.id,
      clerkUserId,
      email: user.email,
      role: user.role,
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

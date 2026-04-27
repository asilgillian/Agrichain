import { eq } from "drizzle-orm";
import { db, userGroupsTable, farmersTable } from "@workspace/db";

type AuthedUser = { id: string; permissions: string[] };

/**
 * A user is "scoped" if they hold the per-group restriction permission
 * `groups.assigned_only` AND they are NOT a wildcard admin (perms includes "*").
 * Wildcard admins always see/act on everything.
 */
export function isUserScoped(authedUser: AuthedUser | undefined | null): boolean {
  if (!authedUser) return false;
  const perms = authedUser.permissions ?? [];
  if (perms.includes("*")) return false;
  return perms.includes("groups.assigned_only");
}

/**
 * Returns the set of group ids assigned to the given user. Used by both list
 * filters and per-record access checks.
 */
export async function getAssignedGroupIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ groupId: userGroupsTable.groupId })
    .from(userGroupsTable)
    .where(eq(userGroupsTable.userId, userId));
  return new Set(rows.map(r => r.groupId));
}

/**
 * Returns null if the caller is allowed to see/touch the given group, otherwise
 * an `{ status, error }` payload the route can hand straight to res.status().json().
 *
 * - Wildcard admins and users without `groups.assigned_only` → always allowed.
 * - Scoped users → allowed iff the group is in their `user_groups` set.
 */
export async function checkGroupAccess(
  groupId: string,
  authedUser: AuthedUser | undefined | null
): Promise<{ status: number; error: string } | null> {
  if (!isUserScoped(authedUser)) return null;
  const assigned = await getAssignedGroupIds(authedUser!.id);
  if (assigned.has(groupId)) return null;
  return { status: 403, error: "You are not assigned to this group" };
}

/**
 * Same as checkGroupAccess, but starts from a farmer id. The farmer's
 * `groupId` is what we check against the caller's assignment set. If the
 * farmer doesn't exist, returns 404 so callers don't have to repeat the
 * lookup.
 */
export async function checkFarmerAccess(
  farmerId: string,
  authedUser: AuthedUser | undefined | null
): Promise<{ status: number; error: string } | null> {
  if (!isUserScoped(authedUser)) return null;
  const [farmer] = await db
    .select({ groupId: farmersTable.groupId })
    .from(farmersTable)
    .where(eq(farmersTable.id, farmerId));
  if (!farmer) return { status: 404, error: "Farmer not found" };
  if (!farmer.groupId) {
    // A farmer without a group can only be touched by unscoped users.
    return { status: 403, error: "Farmer has no group; not visible to scoped users" };
  }
  const assigned = await getAssignedGroupIds(authedUser!.id);
  if (assigned.has(farmer.groupId)) return null;
  return { status: 403, error: "You are not assigned to this farmer's group" };
}

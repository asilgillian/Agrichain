import { eq } from "drizzle-orm";
import { db, regionsTable, countryHierarchiesTable } from "@workspace/db";

/**
 * Validate that a region id points to the deepest configured admin level for
 * its country (e.g. UG → Village, KE → Village). Returns null on success or an
 * error message string on failure.
 *
 * Used by group create/update to enforce the rule that every farmer group must
 * be anchored to a real "leaf" admin unit (the village a farmer actually lives
 * in), not a higher node like a District.
 */
export async function validateGroupRegionIsLeaf(regionId: string): Promise<string | null> {
  const [region] = await db.select().from(regionsTable).where(eq(regionsTable.id, regionId));
  if (!region) return "Region not found";
  if (region.isActive === false) return "Region is inactive";

  const [hier] = await db
    .select()
    .from(countryHierarchiesTable)
    .where(eq(countryHierarchiesTable.countryCode, region.countryCode));

  if (!hier) {
    return `No administrative hierarchy is configured for country ${region.countryCode}`;
  }

  const levels = (hier.levels ?? []) as Array<{ level: number; name: string }>;
  if (levels.length === 0) {
    return `No administrative levels defined for country ${region.countryCode}`;
  }
  const maxLevel = levels.reduce((m, l) => Math.max(m, l.level), 0);
  const leafName = levels.find(l => l.level === maxLevel)?.name ?? `level ${maxLevel}`;

  if (region.level !== maxLevel) {
    return `Group must be anchored to a ${leafName} (deepest admin level for ${region.countryCode}); got level ${region.level}`;
  }
  return null;
}

import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  regionsTable,
  orgRegionsTable,
  orgRegionDistrictsTable,
  countryHierarchiesTable,
  groupRegionsTable,
} from "@workspace/db";

/**
 * Determine the "District" level number for the given country code by reading
 * the country_hierarchies row. Convention: the first level whose name matches
 * /^district$/i, or level 1 (top of the country tree) as a sane fallback.
 */
export async function getDistrictLevelForCountry(countryCode: string): Promise<number> {
  const [hier] = await db
    .select()
    .from(countryHierarchiesTable)
    .where(eq(countryHierarchiesTable.countryCode, countryCode));
  const levels = (hier?.levels ?? []) as Array<{ level: number; name: string }>;
  const match = levels.find((l) => /^district$/i.test(l.name));
  if (match) return match.level;
  // Fallback: level 1 (top-of-country) if "district" isn't named explicitly.
  return 1;
}

/**
 * Walk up the regions tree from a leaf (e.g. Village) until we land on the
 * row whose `level` equals the given target level (typically the "district"
 * level for the row's country). Returns null if we run out of ancestors
 * before reaching that level.
 */
export async function findAncestorRegionAtLevel(
  startRegionId: string,
  targetLevel: number,
): Promise<{ id: string; level: number; countryCode: string } | null> {
  let currentId: string | null = startRegionId;
  // Hard cap to defend against accidental cycles in legacy data.
  for (let i = 0; i < 16 && currentId; i++) {
    const [row] = await db
      .select({
        id: regionsTable.id,
        level: regionsTable.level,
        parentId: regionsTable.parentId,
        countryCode: regionsTable.countryCode,
      })
      .from(regionsTable)
      .where(eq(regionsTable.id, currentId));
    if (!row) return null;
    const cc = row.countryCode ?? "UG";
    if (row.level === targetLevel) return { id: row.id, level: row.level, countryCode: cc };
    if (row.level < targetLevel) return null;
    currentId = row.parentId;
  }
  return null;
}

/**
 * Returns the set of district region ids that belong to the given org region.
 * Empty set means no districts mapped (and therefore no groups/villages).
 */
export async function getOrgRegionDistrictIds(orgRegionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ regionId: orgRegionDistrictsTable.regionId })
    .from(orgRegionDistrictsTable)
    .where(eq(orgRegionDistrictsTable.orgRegionId, orgRegionId));
  return new Set(rows.map((r) => r.regionId));
}

/**
 * Returns the set of district region ids that this group covers. A group always
 * has at least one row in group_regions (enforced at create/update time).
 */
export async function getGroupDistrictIds(groupId: string): Promise<Set<string>> {
  const rows = await db
    .select({ regionId: groupRegionsTable.regionId })
    .from(groupRegionsTable)
    .where(eq(groupRegionsTable.groupId, groupId));
  return new Set(rows.map((r) => r.regionId));
}

/**
 * Batch variant of getGroupDistrictIds. Returns a Map<groupId, Set<regionId>>.
 * Used by the groups list endpoint and scoping checks that span many groups.
 */
export async function getGroupDistrictIdsBatch(groupIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (groupIds.length === 0) return out;
  const rows = await db
    .select({ groupId: groupRegionsTable.groupId, regionId: groupRegionsTable.regionId })
    .from(groupRegionsTable)
    .where(inArray(groupRegionsTable.groupId, groupIds));
  for (const r of rows) {
    let s = out.get(r.groupId);
    if (!s) { s = new Set<string>(); out.set(r.groupId, s); }
    s.add(r.regionId);
  }
  return out;
}

/**
 * True iff the given village (leaf region) sits underneath one of the
 * org region's mapped districts.
 */
export async function isLeafInsideOrgRegion(
  villageRegionId: string,
  orgRegionId: string,
): Promise<boolean> {
  const [orgRegion] = await db
    .select()
    .from(orgRegionsTable)
    .where(eq(orgRegionsTable.id, orgRegionId));
  if (!orgRegion) return false;
  const districtLevel = await getDistrictLevelForCountry(orgRegion.countryCode);
  const ancestor = await findAncestorRegionAtLevel(villageRegionId, districtLevel);
  if (!ancestor) return false;
  const districtIds = await getOrgRegionDistrictIds(orgRegionId);
  return districtIds.has(ancestor.id);
}

/**
 * True iff ANY district covered by the group is also mapped to the org region.
 * Replaces the old single-anchor `isLeafInsideOrgRegion(group.regionId, ...)`
 * check now that groups can cover multiple districts.
 */
export async function isGroupInsideOrgRegion(
  groupId: string,
  orgRegionId: string,
): Promise<boolean> {
  const [groupDistricts, orgDistricts] = await Promise.all([
    getGroupDistrictIds(groupId),
    getOrgRegionDistrictIds(orgRegionId),
  ]);
  for (const d of groupDistricts) if (orgDistricts.has(d)) return true;
  return false;
}

/**
 * Find the District-level ancestor (or the node itself if it IS a district) for
 * a given region. Returns null if the region doesn't exist or has no district
 * ancestor in its country's hierarchy.
 */
export async function getDistrictAncestorId(regionId: string): Promise<string | null> {
  const [region] = await db
    .select({ id: regionsTable.id, countryCode: regionsTable.countryCode })
    .from(regionsTable)
    .where(eq(regionsTable.id, regionId));
  if (!region) return null;
  const districtLevel = await getDistrictLevelForCountry(region.countryCode ?? "UG");
  const ancestor = await findAncestorRegionAtLevel(regionId, districtLevel);
  return ancestor?.id ?? null;
}

/**
 * Batch variant of getDistrictAncestorId. Returns a Map<regionId, districtId>.
 * Skips any region that can't be resolved to a district.
 */
export async function getDistrictAncestorIdsBatch(regionIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (regionIds.length === 0) return out;
  const unique = Array.from(new Set(regionIds));
  for (const id of unique) {
    const d = await getDistrictAncestorId(id);
    if (d) out.set(id, d);
  }
  return out;
}

/** True iff two regions share the same District-level ancestor. */
export async function regionsShareDistrict(aId: string, bId: string): Promise<boolean> {
  if (aId === bId) return true;
  const [a, b] = await Promise.all([getDistrictAncestorId(aId), getDistrictAncestorId(bId)]);
  return !!a && !!b && a === b;
}

/**
 * Build a denormalised acc of region rows for a country (used by group create
 * to build a quick lookup table of district names).
 */
export async function listRegionsByIds(ids: string[]): Promise<Map<string, { id: string; name: string; level: number; countryCode: string }>> {
  const acc = new Map<string, { id: string; name: string; level: number; countryCode: string }>();
  if (ids.length === 0) return acc;
  const rows = await db
    .select({ id: regionsTable.id, name: regionsTable.name, level: regionsTable.level, countryCode: regionsTable.countryCode })
    .from(regionsTable)
    .where(inArray(regionsTable.id, ids));
  for (const r of rows) {
    acc.set(r.id, { id: r.id, name: r.name, level: r.level, countryCode: r.countryCode ?? "UG" });
  }
  return acc;
}

/** True iff the region is at its country's deepest (leaf) level. */
export async function isLeafRegion(regionId: string): Promise<boolean> {
  const [region] = await db
    .select()
    .from(regionsTable)
    .where(eq(regionsTable.id, regionId));
  if (!region) return false;
  const [hier] = await db
    .select()
    .from(countryHierarchiesTable)
    .where(eq(countryHierarchiesTable.countryCode, region.countryCode ?? "UG"));
  const levels = (hier?.levels ?? []) as Array<{ level: number; name: string }>;
  if (levels.length === 0) return false;
  const maxLevel = levels.reduce((m, l) => Math.max(m, l.level), 0);
  return region.level === maxLevel;
}

/**
 * Recursively collect all descendant region ids (any level) under the given
 * set of district ids. Used to build the village picker for an org region.
 */
export async function collectDescendantRegionIds(
  rootRegionIds: string[],
): Promise<Set<string>> {
  const acc = new Set<string>(rootRegionIds);
  let frontier: string[] = [...rootRegionIds];
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const children = await db
      .select({ id: regionsTable.id, parentId: regionsTable.parentId })
      .from(regionsTable)
      .where(inArray(regionsTable.parentId, frontier));
    const next: string[] = [];
    for (const c of children) {
      if (!acc.has(c.id)) {
        acc.add(c.id);
        next.push(c.id);
      }
    }
    frontier = next;
  }
  return acc;
}

/**
 * Validate that a region id is a District-level row for its country. Returns
 * null on success, or a string message on failure.
 */
export async function validateRegionIsDistrict(regionId: string): Promise<string | null> {
  const [region] = await db
    .select()
    .from(regionsTable)
    .where(eq(regionsTable.id, regionId));
  if (!region) return "Region not found";
  if (region.isActive === false) return "Region is inactive";
  const districtLevel = await getDistrictLevelForCountry(region.countryCode ?? "UG");
  if (region.level !== districtLevel) {
    return `Region must be at District level (${districtLevel}); got level ${region.level}`;
  }
  return null;
}

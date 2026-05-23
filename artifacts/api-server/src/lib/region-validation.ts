import { eq } from "drizzle-orm";
import { db, regionsTable, countryHierarchiesTable } from "@workspace/db";
import { getDistrictLevelForCountry, findAncestorRegionAtLevel } from "./org-region-scope";

/**
 * Validate that a region id is acceptable as a group's anchor admin unit.
 *
 * Rule: the anchor may sit anywhere from the country's District level down to
 * the leaf level (e.g. UG: District / Sub-County / Parish / Village). Anchors
 * ABOVE district level are rejected because the farmer-transfer / archive
 * invariant in groups.ts relies on `getDistrictAncestorId(group.regionId)`
 * returning a real district id; a Region-level (or higher) anchor would break
 * that invariant and silently allow cross-district drift.
 *
 * Returns null on success or an error message string on failure.
 */
export async function validateGroupRegionAnchor(regionId: string): Promise<string | null> {
  const [region] = await db.select().from(regionsTable).where(eq(regionsTable.id, regionId));
  if (!region) return "Region not found";
  if (region.isActive === false) return "Region is inactive";

  const [hier] = await db
    .select()
    .from(countryHierarchiesTable)
    .where(eq(countryHierarchiesTable.countryCode, region.countryCode));
  if (!hier) return `No administrative hierarchy is configured for country ${region.countryCode}`;

  const levels = (hier.levels ?? []) as Array<{ level: number; name: string }>;
  if (levels.length === 0) return `No administrative levels defined for country ${region.countryCode}`;

  const districtLevel = await getDistrictLevelForCountry(region.countryCode);
  const districtName = levels.find(l => l.level === districtLevel)?.name ?? `level ${districtLevel}`;
  if ((region.level ?? 0) < districtLevel) {
    return `Group must be anchored at ${districtName} or a more specific level (got level ${region.level}). Anchoring higher than ${districtName} would break farmer-transfer district checks.`;
  }
  return null;
}

/**
 * Resolve the denormalised admin-unit columns for a group (village, parish,
 * subCounty, district) by walking up from the anchor region. Any column whose
 * level is deeper than the anchor is set to null — e.g. if a group is anchored
 * at a Sub-County, parish and village come back null.
 *
 * Returns the four columns ready to spread into a groups.insert/update payload.
 * Returns all-nulls if the region or its hierarchy can't be resolved (caller
 * should already have validated the regionId via validateGroupRegionAnchor).
 */
export async function deriveGroupAdminColumnsFromRegion(regionId: string): Promise<{
  village: string | null;
  parish: string | null;
  subCounty: string | null;
  district: string | null;
}> {
  const empty = { village: null, parish: null, subCounty: null, district: null };
  const [region] = await db.select().from(regionsTable).where(eq(regionsTable.id, regionId));
  if (!region) return empty;

  const [hier] = await db
    .select()
    .from(countryHierarchiesTable)
    .where(eq(countryHierarchiesTable.countryCode, region.countryCode));
  const levels = ((hier?.levels ?? []) as Array<{ level: number; name: string }>);
  if (levels.length === 0) return empty;

  const nameToLevel = (n: string): number | null => {
    const norm = n.toLowerCase().replace(/[\s_-]/g, "");
    const hit = levels.find(l => l.name.toLowerCase().replace(/[\s_-]/g, "") === norm);
    return hit?.level ?? null;
  };
  const want = {
    district: nameToLevel("district"),
    subCounty: nameToLevel("subcounty"),
    parish: nameToLevel("parish"),
    village: nameToLevel("village"),
  } as const;

  const out = { ...empty };
  for (const [key, lvl] of Object.entries(want) as Array<[keyof typeof out, number | null]>) {
    if (lvl == null) continue;
    if ((region.level ?? 0) < lvl) continue; // anchor is above this level — leave null
    if (region.level === lvl) { out[key] = region.name; continue; }
    const ancestor = await findAncestorRegionAtLevel(regionId, lvl);
    if (ancestor) {
      const [r] = await db.select({ name: regionsTable.name }).from(regionsTable).where(eq(regionsTable.id, ancestor.id));
      out[key] = r?.name ?? null;
    }
  }
  return out;
}

/** @deprecated use validateGroupRegionAnchor — kept temporarily for any out-of-tree callers. */
export const validateGroupRegionIsLeaf = validateGroupRegionAnchor;

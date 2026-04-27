import { Router, type IRouter } from "express";
import { eq, and, inArray, sql, asc } from "drizzle-orm";
import {
  db,
  orgRegionsTable,
  orgRegionDistrictsTable,
  regionsTable,
  groupsTable,
  farmersTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import {
  isUserScoped,
  getAssignedGroupIds,
} from "../lib/assignment-scope";
import {
  getOrgRegionDistrictIds,
  collectDescendantRegionIds,
  validateRegionIsDistrict,
} from "../lib/org-region-scope";

/**
 * For a scoped user, return the set of org region ids they have at least one
 * assigned group in. Used to filter the org region picker (and to gate detail
 * endpoints) so scoped users never see metadata for regions they have no
 * presence in.
 */
async function getOrgRegionIdsContainingAssignedGroups(
  assignedGroupIds: Set<string>,
): Promise<Set<string>> {
  if (assignedGroupIds.size === 0) return new Set();
  // Walk: assigned groups -> their anchor regionId -> ancestor district -> joined org region.
  // Done in JS rather than SQL because the regions tree is small and the join is opaque
  // across countries with different depths.
  const groupRows = await db
    .select({ id: groupsTable.id, regionId: groupsTable.regionId })
    .from(groupsTable)
    .where(inArray(groupsTable.id, Array.from(assignedGroupIds)));
  const districtIds = new Set<string>();
  for (const g of groupRows) {
    const [region] = await db
      .select({ id: regionsTable.id, countryCode: regionsTable.countryCode })
      .from(regionsTable)
      .where(eq(regionsTable.id, g.regionId));
    if (!region) continue;
    const districtLevel = await (await import("../lib/org-region-scope")).getDistrictLevelForCountry(
      region.countryCode ?? "UG",
    );
    const ancestor = await (await import("../lib/org-region-scope")).findAncestorRegionAtLevel(
      g.regionId,
      districtLevel,
    );
    if (ancestor) districtIds.add(ancestor.id);
  }
  if (districtIds.size === 0) return new Set();
  const joins = await db
    .select({ orgRegionId: orgRegionDistrictsTable.orgRegionId })
    .from(orgRegionDistrictsTable)
    .where(inArray(orgRegionDistrictsTable.regionId, Array.from(districtIds)));
  return new Set(joins.map((j) => j.orgRegionId));
}

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- GET /api/org-regions ----------
// Picker-friendly list. Returns active org regions with their district counts.
// For scoped users (groups.assigned_only without wildcard), filters to only the
// org regions they have at least one assigned group in - so the picker can't
// be used to enumerate org regions outside the user's reach.
router.get("/org-regions", async (req: AuthedRequest, res): Promise<void> => {
  let rows = await db
    .select({
      id: orgRegionsTable.id,
      name: orgRegionsTable.name,
      description: orgRegionsTable.description,
      countryCode: orgRegionsTable.countryCode,
      isActive: orgRegionsTable.isActive,
    })
    .from(orgRegionsTable)
    .where(eq(orgRegionsTable.isActive, true))
    .orderBy(asc(orgRegionsTable.name));

  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    const allowedOrgRegionIds = await getOrgRegionIdsContainingAssignedGroups(assigned);
    rows = rows.filter((r) => allowedOrgRegionIds.has(r.id));
  }

  const counts = await db
    .select({
      orgRegionId: orgRegionDistrictsTable.orgRegionId,
      count: sql<number>`count(*)::int`,
    })
    .from(orgRegionDistrictsTable)
    .groupBy(orgRegionDistrictsTable.orgRegionId);
  const countMap = new Map(counts.map((c) => [c.orgRegionId, c.count]));

  res.json(rows.map((r) => ({ ...r, districtCount: countMap.get(r.id) ?? 0 })));
});

// ---------- GET /api/org-regions/:id ----------
router.get("/org-regions/:id", async (req: AuthedRequest, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [orgRegion] = await db
    .select()
    .from(orgRegionsTable)
    .where(eq(orgRegionsTable.id, id));
  if (!orgRegion) { res.status(404).json({ error: "Org region not found" }); return; }
  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    const allowed = await getOrgRegionIdsContainingAssignedGroups(assigned);
    if (!allowed.has(id)) {
      res.status(403).json({ error: "You have no assigned groups in this region" });
      return;
    }
  }
  const districtIds = Array.from(await getOrgRegionDistrictIds(id));
  const districts = districtIds.length
    ? await db
        .select({
          id: regionsTable.id,
          name: regionsTable.name,
          level: regionsTable.level,
          countryCode: regionsTable.countryCode,
          parentId: regionsTable.parentId,
        })
        .from(regionsTable)
        .where(inArray(regionsTable.id, districtIds))
        .orderBy(asc(regionsTable.name))
    : [];
  res.json({ ...orgRegion, districts });
});

// ---------- GET /api/org-regions/:id/groups ----------
// Groups whose anchor village's district is in this org region. Honours per-user
// assignment scoping so scoped users only see their assigned groups.
router.get("/org-regions/:id/groups", async (req: AuthedRequest, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const districtIds = Array.from(await getOrgRegionDistrictIds(id));
  if (districtIds.length === 0) { res.json([]); return; }
  // Walk: districts -> all descendant region ids -> groups whose regionId is in that set.
  const inRegionIds = Array.from(await collectDescendantRegionIds(districtIds));
  if (inRegionIds.length === 0) { res.json([]); return; }

  let groups = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      regionId: groupsTable.regionId,
      status: groupsTable.status,
    })
    .from(groupsTable)
    .where(and(inArray(groupsTable.regionId, inRegionIds), eq(groupsTable.status, "active")))
    .orderBy(asc(groupsTable.name));

  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    groups = groups.filter((g) => assigned.has(g.id));
  }
  res.json(groups);
});

// ---------- GET /api/org-regions/:id/villages ----------
// Returns leaf-level (deepest) regions inside the org region. The picker uses
// this directly without further drill-down. Scoped users are denied unless they
// have at least one assigned group in this org region (so the village list
// can't be used for cross-region enumeration).
router.get("/org-regions/:id/villages", async (req: AuthedRequest, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    const allowed = await getOrgRegionIdsContainingAssignedGroups(assigned);
    if (!allowed.has(id)) {
      res.status(403).json({ error: "You have no assigned groups in this region" });
      return;
    }
  }
  const districtIds = Array.from(await getOrgRegionDistrictIds(id));
  if (districtIds.length === 0) { res.json([]); return; }
  const inRegionIds = Array.from(await collectDescendantRegionIds(districtIds));
  if (inRegionIds.length === 0) { res.json([]); return; }

  // Pick the deepest level present among the candidate region rows. This avoids
  // hard-coding country-specific level numbers in the picker.
  const rows = await db
    .select({
      id: regionsTable.id,
      name: regionsTable.name,
      level: regionsTable.level,
      parentId: regionsTable.parentId,
      countryCode: regionsTable.countryCode,
      isActive: regionsTable.isActive,
    })
    .from(regionsTable)
    .where(inArray(regionsTable.id, inRegionIds));

  const activeRows = rows.filter((r) => r.isActive !== false);
  if (activeRows.length === 0) { res.json([]); return; }
  const maxLevel = activeRows.reduce((m, r) => Math.max(m, r.level), 0);
  const leaves = activeRows
    .filter((r) => r.level === maxLevel)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(leaves);
});

// ---------- POST /api/admin/org-regions ----------
router.post(
  "/admin/org-regions",
  requirePermission("admin.org_regions"),
  async (req: AuthedRequest, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) { res.status(400).json({ error: "name must be at least 2 chars" }); return; }
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const countryCode = typeof body.countryCode === "string" ? body.countryCode.toUpperCase() : "UG";
    const districtIds = Array.isArray(body.districtIds)
      ? (body.districtIds as unknown[]).filter((x): x is string => typeof x === "string" && UUID_RE.test(x))
      : [];

    // Validate every district id BEFORE creating the parent row so we don't leave half-state.
    // Each district must be at District-level AND share the org region's country code.
    for (const rid of districtIds) {
      const err = await validateRegionIsDistrict(rid);
      if (err) { res.status(400).json({ error: `District ${rid}: ${err}` }); return; }
      const [r] = await db
        .select({ countryCode: regionsTable.countryCode })
        .from(regionsTable)
        .where(eq(regionsTable.id, rid));
      if (r && (r.countryCode ?? "UG") !== countryCode) {
        res.status(400).json({ error: `District ${rid}: country mismatch (region is ${r.countryCode}, org region is ${countryCode})` });
        return;
      }
    }

    try {
      const inserted = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(orgRegionsTable)
          .values({
            name,
            description,
            countryCode,
            createdById: req.authedUser?.id ?? null,
          })
          .returning();
        if (districtIds.length) {
          await tx.insert(orgRegionDistrictsTable).values(
            districtIds.map((rid) => ({ orgRegionId: row.id, regionId: rid })),
          );
        }
        return row;
      });
      res.status(201).json({ ...inserted, districtIds });
    } catch (err: any) {
      if (String(err?.message ?? "").includes("org_regions_country_lower_name_uq")) {
        res.status(409).json({ error: "An org region with this name already exists for this country" });
        return;
      }
      res.status(500).json({ error: `Failed to create org region: ${err?.message ?? "unknown"}` });
    }
  },
);

// ---------- PATCH /api/admin/org-regions/:id ----------
router.patch(
  "/admin/org-regions/:id",
  requirePermission("admin.org_regions"),
  async (req, res): Promise<void> => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === "string") {
      const n = body.name.trim();
      if (n.length < 2) { res.status(400).json({ error: "name must be at least 2 chars" }); return; }
      patch.name = n;
    }
    if (body.description !== undefined) {
      patch.description = body.description === null ? null : String(body.description).trim();
    }
    if (typeof body.countryCode === "string") {
      // Block country changes when districts are already assigned to avoid
      // leaving the join in a mixed-country state. Admins must clear districts first.
      const [existing] = await db
        .select({ countryCode: orgRegionsTable.countryCode })
        .from(orgRegionsTable)
        .where(eq(orgRegionsTable.id, id));
      if (existing && existing.countryCode !== body.countryCode.toUpperCase()) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(orgRegionDistrictsTable)
          .where(eq(orgRegionDistrictsTable.orgRegionId, id));
        if (count > 0) {
          res.status(409).json({ error: "Clear assigned districts before changing country" });
          return;
        }
      }
      patch.countryCode = body.countryCode.toUpperCase();
    }
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;

    const [updated] = await db
      .update(orgRegionsTable)
      .set(patch)
      .where(eq(orgRegionsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Org region not found" }); return; }
    res.json(updated);
  },
);

// ---------- DELETE /api/admin/org-regions/:id ----------
router.delete(
  "/admin/org-regions/:id",
  requirePermission("admin.org_regions"),
  async (req, res): Promise<void> => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [deleted] = await db
      .delete(orgRegionsTable)
      .where(eq(orgRegionsTable.id, id))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Org region not found" }); return; }
    res.json({ ok: true, id });
  },
);

// ---------- PUT /api/admin/org-regions/:id/districts ----------
// Replace the entire district set for this org region.
router.put(
  "/admin/org-regions/:id/districts",
  requirePermission("admin.org_regions"),
  async (req, res): Promise<void> => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const districtIds = Array.isArray(body.districtIds)
      ? (body.districtIds as unknown[]).filter((x): x is string => typeof x === "string" && UUID_RE.test(x))
      : null;
    if (!districtIds) { res.status(400).json({ error: "districtIds[] required" }); return; }

    const [orgRegion] = await db
      .select()
      .from(orgRegionsTable)
      .where(eq(orgRegionsTable.id, id));
    if (!orgRegion) { res.status(404).json({ error: "Org region not found" }); return; }

    for (const rid of districtIds) {
      const err = await validateRegionIsDistrict(rid);
      if (err) { res.status(400).json({ error: `District ${rid}: ${err}` }); return; }
      const [r] = await db
        .select({ countryCode: regionsTable.countryCode })
        .from(regionsTable)
        .where(eq(regionsTable.id, rid));
      if (r && (r.countryCode ?? "UG") !== orgRegion.countryCode) {
        res.status(400).json({ error: `District ${rid}: country mismatch (region is ${r.countryCode}, org region is ${orgRegion.countryCode})` });
        return;
      }
    }
    // De-dupe defensively.
    const uniq = Array.from(new Set(districtIds));

    await db.transaction(async (tx) => {
      await tx.delete(orgRegionDistrictsTable).where(eq(orgRegionDistrictsTable.orgRegionId, id));
      if (uniq.length) {
        await tx.insert(orgRegionDistrictsTable).values(
          uniq.map((rid) => ({ orgRegionId: id, regionId: rid })),
        );
      }
      await tx.update(orgRegionsTable).set({ updatedAt: new Date() }).where(eq(orgRegionsTable.id, id));
    });
    res.json({ id, districtIds: uniq });
  },
);

export default router;

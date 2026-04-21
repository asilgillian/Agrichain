import { Router, type IRouter } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, regionsTable, farmersTable, groupsTable, plotsTable } from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import shp from "shpjs";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- PATCH /admin/regions/:id ----------
router.patch("/admin/regions/:id", requirePermission("admin.regions"), async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid region id" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (n.length < 1) { res.status(400).json({ error: "name cannot be empty" }); return; }
    patch.name = n;
  }
  if (body.parentId !== undefined) {
    if (body.parentId === null) patch.parentId = null;
    else if (typeof body.parentId === "string" && UUID_RE.test(body.parentId)) {
      if (body.parentId === id) { res.status(400).json({ error: "A region cannot be its own parent" }); return; }
      patch.parentId = body.parentId;
    } else { res.status(400).json({ error: "Invalid parentId" }); return; }
  }
  if (body.code !== undefined) patch.code = body.code === null ? null : String(body.code);
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
  if (typeof body.level === "number" && Number.isInteger(body.level) && body.level >= 1 && body.level <= 10) patch.level = body.level;
  if (typeof body.countryCode === "string") patch.countryCode = body.countryCode.toUpperCase();

  const [updated] = await db.update(regionsTable).set(patch).where(eq(regionsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Region not found" }); return; }
  res.json(updated);
});

// ---------- POST /admin/regions/:id/merge ----------
// Reassigns farmers, groups, and child regions from :id (source) to body.targetId, then deletes source.
router.post("/admin/regions/:id/merge", requirePermission("admin.regions"), async (req, res): Promise<void> => {
  const sourceId = req.params.id;
  const body = (req.body ?? {}) as { targetId?: string };
  const targetId = body.targetId;
  if (!UUID_RE.test(sourceId) || !targetId || !UUID_RE.test(targetId)) {
    res.status(400).json({ error: "Invalid sourceId or targetId" }); return;
  }
  if (sourceId === targetId) { res.status(400).json({ error: "Cannot merge a region into itself" }); return; }
  const [src] = await db.select().from(regionsTable).where(eq(regionsTable.id, sourceId));
  const [tgt] = await db.select().from(regionsTable).where(eq(regionsTable.id, targetId));
  if (!src || !tgt) { res.status(404).json({ error: "Source or target region not found" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const farmersMoved = await tx.update(farmersTable).set({ regionId: targetId, updatedAt: new Date() }).where(eq(farmersTable.regionId, sourceId)).returning({ id: farmersTable.id });
      const groupsMoved = await tx.update(groupsTable).set({ regionId: targetId }).where(eq(groupsTable.regionId, sourceId)).returning({ id: groupsTable.id });
      const childrenMoved = await tx.update(regionsTable).set({ parentId: targetId, updatedAt: new Date() }).where(eq(regionsTable.parentId, sourceId)).returning({ id: regionsTable.id });
      await tx.delete(regionsTable).where(eq(regionsTable.id, sourceId));
      return { farmersMoved: farmersMoved.length, groupsMoved: groupsMoved.length, childRegionsMoved: childrenMoved.length };
    });
    res.json({ sourceId, targetId, ...result });
  } catch (err: any) {
    res.status(500).json({ error: `Merge failed: ${err?.message ?? "unknown error"}` });
  }
});

// ---------- GET /admin/regions/stats ----------
// Returns farmer + group + plot counts per region (direct, not recursive — UI rolls up via tree).
router.get("/admin/regions/stats", requirePermission("admin.regions"), async (_req, res): Promise<void> => {
  const farmerCounts = await db
    .select({ regionId: farmersTable.regionId, count: sql<number>`count(*)::int` })
    .from(farmersTable)
    .groupBy(farmersTable.regionId);
  const groupCounts = await db
    .select({ regionId: groupsTable.regionId, count: sql<number>`count(*)::int` })
    .from(groupsTable)
    .groupBy(groupsTable.regionId);
  const plotCounts = await db
    .select({ regionId: farmersTable.regionId, count: sql<number>`count(${plotsTable.id})::int` })
    .from(plotsTable)
    .innerJoin(farmersTable, eq(plotsTable.farmerId, farmersTable.id))
    .groupBy(farmersTable.regionId);

  const stats: Record<string, { farmers: number; groups: number; plots: number }> = {};
  for (const r of farmerCounts) if (r.regionId) (stats[r.regionId] ??= { farmers: 0, groups: 0, plots: 0 }).farmers = r.count;
  for (const r of groupCounts) if (r.regionId) (stats[r.regionId] ??= { farmers: 0, groups: 0, plots: 0 }).groups = r.count;
  for (const r of plotCounts) if (r.regionId) (stats[r.regionId] ??= { farmers: 0, groups: 0, plots: 0 }).plots = r.count;
  res.json(stats);
});

// ---------- GET /admin/regions/export.csv ----------
router.get("/admin/regions/export", requirePermission("admin.regions"), async (_req, res): Promise<void> => {
  const all = await db.select().from(regionsTable);
  const byId = new Map(all.map(r => [r.id, r]));
  const namePath = (r: typeof all[number]): string => {
    const parts: string[] = [];
    let cur: typeof all[number] | undefined = r;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      parts.unshift(cur.name);
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" / ");
  };
  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ["id", "name", "level", "countryCode", "code", "isActive", "parentId", "parentName", "namePath"];
  const rows = all
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map(r => [
      r.id, r.name, r.level, r.countryCode ?? "", r.code ?? "", r.isActive ? "true" : "false",
      r.parentId ?? "", r.parentId ? (byId.get(r.parentId)?.name ?? "") : "",
      namePath(r),
    ].map(escape).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="regions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ---------- POST /admin/regions/import-hierarchical ----------
// Accepts: { countryCode, rows: [{ name, level, parentName?, parentPath?, code? }] }
// Resolves parents by name (within same countryCode) or by " / "-delimited path.
router.post("/admin/regions/import-hierarchical", requirePermission("admin.bulk_upload"), async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { countryCode?: string; rows?: any };
  const countryCode = (body.countryCode ?? "").toString().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(countryCode)) { res.status(400).json({ error: "countryCode required (2–3 letters)" }); return; }
  if (!Array.isArray(body.rows) || body.rows.length === 0) { res.status(400).json({ error: "rows required" }); return; }
  if (body.rows.length > 5000) { res.status(400).json({ error: "Maximum 5000 rows per import" }); return; }

  const existing = await db.select().from(regionsTable).where(eq(regionsTable.countryCode, countryCode));
  const byId = new Map(existing.map(r => [r.id, r]));
  // index by case-insensitive name + parentId
  const keyOf = (name: string, parentId: string | null) => `${parentId ?? ""}|${name.toLowerCase()}`;
  const byKey = new Map(existing.map(r => [keyOf(r.name, r.parentId ?? null), r]));

  const created: any[] = [];
  const errors: Array<{ row: number; error: string; data: unknown }> = [];

  // Sort by level so parents are inserted before children
  const sorted = body.rows.map((r: any, i: number) => ({ raw: r, originalIndex: i }))
    .sort((a: any, b: any) => Number(a.raw.level ?? 1) - Number(b.raw.level ?? 1));

  for (const { raw, originalIndex } of sorted) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const level = Number(raw.level);
    if (!name) { errors.push({ row: originalIndex + 1, error: "name required", data: raw }); continue; }
    if (!Number.isInteger(level) || level < 1 || level > 10) { errors.push({ row: originalIndex + 1, error: "level must be 1–10", data: raw }); continue; }

    let parentId: string | null = null;
    if (level > 1) {
      const parentPath = typeof raw.parentPath === "string" ? raw.parentPath.trim() : "";
      const parentName = typeof raw.parentName === "string" ? raw.parentName.trim() : "";
      if (parentPath) {
        const parts = parentPath.split("/").map(p => p.trim()).filter(Boolean);
        let curParent: string | null = null;
        let resolved = true;
        for (const p of parts) {
          const found = byKey.get(keyOf(p, curParent));
          if (!found) { resolved = false; break; }
          curParent = found.id;
        }
        if (!resolved) { errors.push({ row: originalIndex + 1, error: `Could not resolve parentPath "${parentPath}"`, data: raw }); continue; }
        parentId = curParent;
      } else if (parentName) {
        // Find a region with this name that doesn't have multiple matches
        const matches = existing.filter(r => r.name.toLowerCase() === parentName.toLowerCase() && r.level === level - 1);
        if (matches.length === 0) { errors.push({ row: originalIndex + 1, error: `Parent "${parentName}" not found at level ${level - 1}`, data: raw }); continue; }
        if (matches.length > 1) { errors.push({ row: originalIndex + 1, error: `Parent "${parentName}" is ambiguous (${matches.length} matches) — use parentPath`, data: raw }); continue; }
        parentId = matches[0].id;
      } else {
        errors.push({ row: originalIndex + 1, error: "level > 1 requires parentName or parentPath", data: raw }); continue;
      }
    }

    const dupKey = keyOf(name, parentId);
    if (byKey.has(dupKey)) { errors.push({ row: originalIndex + 1, error: `Region "${name}" already exists under this parent`, data: raw }); continue; }

    try {
      const [r] = await db.insert(regionsTable).values({
        name, level, countryCode, parentId,
        code: typeof raw.code === "string" && raw.code.trim() ? raw.code.trim() : null,
      }).returning();
      created.push(r);
      existing.push(r);
      byId.set(r.id, r);
      byKey.set(dupKey, r);
    } catch (err: any) {
      errors.push({ row: originalIndex + 1, error: err?.message ?? "Insert failed", data: raw });
    }
  }

  res.status(201).json({
    countryCode,
    totalSubmitted: body.rows.length,
    createdCount: created.length,
    errorCount: errors.length,
    created,
    errors,
  });
});

// ---------- POST /admin/regions/import-shapefile ----------
// Accepts a base64-encoded .zip (containing .shp/.dbf/.prj) in body { countryCode, level, nameProperty, codeProperty?, fileBase64 }.
router.post("/admin/regions/import-shapefile", requirePermission("admin.bulk_upload"), async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { countryCode?: string; level?: number; nameProperty?: string; codeProperty?: string; parentNameProperty?: string; fileBase64?: string };
  const countryCode = (body.countryCode ?? "").toString().toUpperCase();
  const level = Number(body.level);
  const nameProp = body.nameProperty;
  if (!/^[A-Z]{2,3}$/.test(countryCode)) { res.status(400).json({ error: "countryCode required" }); return; }
  if (!Number.isInteger(level) || level < 1 || level > 10) { res.status(400).json({ error: "level required (1–10)" }); return; }
  if (!nameProp) { res.status(400).json({ error: "nameProperty required (DBF column with admin-unit names)" }); return; }
  if (!body.fileBase64) { res.status(400).json({ error: "fileBase64 required (base64-encoded .zip with .shp/.dbf/.prj)" }); return; }

  let buffer: Buffer;
  try { buffer = Buffer.from(body.fileBase64, "base64"); }
  catch { res.status(400).json({ error: "fileBase64 is not valid base64" }); return; }
  if (buffer.length < 100) { res.status(400).json({ error: "Uploaded file is too small to be a shapefile zip" }); return; }
  if (buffer.length > 50 * 1024 * 1024) { res.status(400).json({ error: "Uploaded file exceeds 50 MB limit" }); return; }

  let parsed: any;
  try {
    parsed = await shp(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  } catch (err: any) {
    res.status(400).json({ error: `Failed to parse shapefile: ${err?.message ?? err}` });
    return;
  }
  const featureCollections = Array.isArray(parsed) ? parsed : [parsed];
  const features: any[] = [];
  for (const fc of featureCollections) {
    if (fc?.type === "FeatureCollection" && Array.isArray(fc.features)) features.push(...fc.features);
    else if (fc?.type === "Feature") features.push(fc);
  }
  if (features.length === 0) { res.status(400).json({ error: "No features found in shapefile" }); return; }
  if (features.length > 5000) { res.status(400).json({ error: `Shapefile has ${features.length} features; max 5000 per import` }); return; }

  const existing = await db.select().from(regionsTable).where(and(eq(regionsTable.countryCode, countryCode), eq(regionsTable.level, level)));
  const existingByName = new Map(existing.map(r => [r.name.toLowerCase(), r]));

  // Prefetch parent-level regions if parentNameProperty is provided
  let parentLookup: Map<string, string> | null = null;
  if (body.parentNameProperty && level > 1) {
    const parents = await db.select().from(regionsTable).where(and(eq(regionsTable.countryCode, countryCode), eq(regionsTable.level, level - 1)));
    parentLookup = new Map(parents.map(p => [p.name.toLowerCase(), p.id]));
  }

  const created: any[] = [];
  const updated: any[] = [];
  const errors: Array<{ feature: number; error: string }> = [];

  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    const props = feat.properties ?? {};
    const name = props[nameProp];
    if (typeof name !== "string" || !name.trim()) { errors.push({ feature: i + 1, error: `Missing or empty "${nameProp}"` }); continue; }
    const cleanName = name.trim();
    const code = body.codeProperty ? (props[body.codeProperty] != null ? String(props[body.codeProperty]) : null) : null;
    let parentId: string | null = null;
    if (parentLookup && body.parentNameProperty) {
      const pn = props[body.parentNameProperty];
      if (typeof pn === "string" && pn.trim()) {
        const found = parentLookup.get(pn.trim().toLowerCase());
        if (!found) { errors.push({ feature: i + 1, error: `Parent "${pn}" not found at level ${level - 1}` }); continue; }
        parentId = found;
      }
    }
    const boundary = feat.geometry ?? null;

    const match = existingByName.get(cleanName.toLowerCase());
    try {
      if (match) {
        const [u] = await db.update(regionsTable)
          .set({ boundary, code: code ?? match.code, parentId: parentId ?? match.parentId, updatedAt: new Date() })
          .where(eq(regionsTable.id, match.id))
          .returning();
        updated.push(u);
      } else {
        const [r] = await db.insert(regionsTable)
          .values({ name: cleanName, level, countryCode, parentId, code, boundary })
          .returning();
        created.push(r);
        existingByName.set(cleanName.toLowerCase(), r);
      }
    } catch (err: any) {
      errors.push({ feature: i + 1, error: err?.message ?? "Insert/update failed" });
    }
  }

  res.status(201).json({
    countryCode, level,
    totalFeatures: features.length,
    createdCount: created.length,
    updatedCount: updated.length,
    errorCount: errors.length,
    created, updated, errors,
  });
});

// ---------- GET /admin/regions/geojson ----------
// Returns a FeatureCollection of regions that have boundary geometry, optionally filtered by country/level.
router.get("/admin/regions/geojson", requirePermission("admin.regions"), async (req, res): Promise<void> => {
  const country = typeof req.query.countryCode === "string" ? req.query.countryCode.toUpperCase() : null;
  const level = req.query.level != null ? Number(req.query.level) : null;
  const filters = [] as any[];
  if (country) filters.push(eq(regionsTable.countryCode, country));
  if (level && Number.isInteger(level)) filters.push(eq(regionsTable.level, level));
  const rows = filters.length > 0
    ? await db.select().from(regionsTable).where(and(...filters))
    : await db.select().from(regionsTable);
  const features = rows
    .filter(r => r.boundary != null)
    .map(r => ({
      type: "Feature" as const,
      geometry: r.boundary,
      properties: { id: r.id, name: r.name, level: r.level, countryCode: r.countryCode, code: r.code, isActive: r.isActive, parentId: r.parentId },
    }));
  res.json({ type: "FeatureCollection", features });
});

// ---------- GET /admin/farmer-locations ----------
// Returns farmer lat/lng pins derived from plot polygon centroids. Filterable by regionId.
router.get("/admin/farmer-locations", requirePermission("farmers.read"), async (req, res): Promise<void> => {
  const regionId = typeof req.query.regionId === "string" && UUID_RE.test(req.query.regionId) ? req.query.regionId : null;

  const farmerWhere = regionId ? eq(farmersTable.regionId, regionId) : undefined;
  const farmers = farmerWhere
    ? await db.select({ id: farmersTable.id, firstName: farmersTable.firstName, lastName: farmersTable.lastName, ref: farmersTable.referenceNumber, regionId: farmersTable.regionId, village: farmersTable.village }).from(farmersTable).where(farmerWhere)
    : await db.select({ id: farmersTable.id, firstName: farmersTable.firstName, lastName: farmersTable.lastName, ref: farmersTable.referenceNumber, regionId: farmersTable.regionId, village: farmersTable.village }).from(farmersTable);

  if (farmers.length === 0) { res.json({ farmers: [] }); return; }
  const farmerIds = farmers.map(f => f.id);
  const plots = await db.select({ farmerId: plotsTable.farmerId, polygon: plotsTable.polygon }).from(plotsTable).where(inArray(plotsTable.farmerId, farmerIds));

  // Compute centroid (average of coordinates) for each farmer's first plot polygon.
  const byFarmer = new Map<string, { lat: number; lng: number }>();
  for (const p of plots) {
    if (byFarmer.has(p.farmerId)) continue;
    const poly: any = p.polygon;
    if (!poly) continue;
    let coords: number[][] = [];
    if (poly.type === "Polygon" && Array.isArray(poly.coordinates?.[0])) coords = poly.coordinates[0];
    else if (poly.type === "MultiPolygon" && Array.isArray(poly.coordinates?.[0]?.[0])) coords = poly.coordinates[0][0];
    else if (Array.isArray(poly) && poly.length > 0 && Array.isArray(poly[0])) coords = poly;
    if (coords.length === 0) continue;
    const valid = coords.filter(c => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number");
    if (valid.length === 0) continue;
    const sumLng = valid.reduce((s, c) => s + c[0], 0);
    const sumLat = valid.reduce((s, c) => s + c[1], 0);
    byFarmer.set(p.farmerId, { lat: sumLat / valid.length, lng: sumLng / valid.length });
  }

  const result = farmers
    .filter(f => byFarmer.has(f.id))
    .map(f => ({
      id: f.id,
      name: `${f.firstName} ${f.lastName}`,
      ref: f.ref,
      regionId: f.regionId,
      village: f.village,
      ...byFarmer.get(f.id)!,
    }));
  res.json({ farmers: result });
});

export default router;

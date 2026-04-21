import { Router, type IRouter } from "express";
import { eq, and, sql, inArray, type SQL } from "drizzle-orm";
import { db, plotsTable, farmersTable, groupsTable, regionsTable } from "@workspace/db";
import { CreatePlotBody, ListPlotsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildPlotFilters(q: any): SQL[] {
  const filters: SQL[] = [];
  if (typeof q.regionId === "string" && UUID_RE.test(q.regionId)) filters.push(eq(farmersTable.regionId, q.regionId));
  if (typeof q.groupId === "string" && UUID_RE.test(q.groupId)) filters.push(eq(farmersTable.groupId, q.groupId));
  if (typeof q.farmerId === "string" && UUID_RE.test(q.farmerId)) filters.push(eq(plotsTable.farmerId, q.farmerId));
  if (typeof q.cropType === "string" && q.cropType.trim()) filters.push(eq(plotsTable.cropType, q.cropType.trim()));
  if (typeof q.status === "string" && q.status.trim()) filters.push(eq(plotsTable.status, q.status.trim()));
  return filters;
}

router.get("/plots", async (req, res): Promise<void> => {
  const parsed = ListPlotsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { farmerId } = parsed.data;
  const plots = farmerId
    ? await db.select().from(plotsTable).where(eq(plotsTable.farmerId, farmerId))
    : await db.select().from(plotsTable);
  res.json(plots.map(p => ({ ...p, areaHectares: parseFloat(p.areaHectares ?? "0") })));
});

router.post("/plots", async (req, res): Promise<void> => {
  const parsed = CreatePlotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [plot] = await db.insert(plotsTable).values(parsed.data).returning();
  res.status(201).json({ ...plot, areaHectares: parseFloat(plot.areaHectares ?? "0") });
});

// ---------- GET /plots/geojson ----------
// Returns plots as a GeoJSON FeatureCollection joined with farmer/group/region info.
// Filters: regionId, groupId, farmerId, cropType, status.
router.get("/plots/geojson", async (req, res): Promise<void> => {
  const filters = buildPlotFilters(req.query);
  const rows = await db
    .select({
      id: plotsTable.id,
      farmerId: plotsTable.farmerId,
      name: plotsTable.name,
      cropType: plotsTable.cropType,
      areaHectares: plotsTable.areaHectares,
      polygon: plotsTable.polygon,
      status: plotsTable.status,
      harvestDate: plotsTable.harvestDate,
      farmerFirst: farmersTable.firstName,
      farmerLast: farmersTable.lastName,
      farmerRef: farmersTable.referenceNumber,
      groupId: farmersTable.groupId,
      regionId: farmersTable.regionId,
      groupName: groupsTable.name,
      regionName: regionsTable.name,
    })
    .from(plotsTable)
    .innerJoin(farmersTable, eq(plotsTable.farmerId, farmersTable.id))
    .leftJoin(groupsTable, eq(farmersTable.groupId, groupsTable.id))
    .leftJoin(regionsTable, eq(farmersTable.regionId, regionsTable.id))
    .where(filters.length > 0 ? and(...filters) : undefined);

  const features = rows
    .filter(r => r.polygon != null)
    .map(r => ({
      type: "Feature" as const,
      geometry: r.polygon,
      properties: {
        id: r.id,
        farmerId: r.farmerId,
        farmerName: `${r.farmerFirst} ${r.farmerLast}`,
        farmerRef: r.farmerRef,
        groupId: r.groupId,
        groupName: r.groupName,
        regionId: r.regionId,
        regionName: r.regionName,
        name: r.name,
        cropType: r.cropType,
        areaHectares: parseFloat(r.areaHectares ?? "0"),
        status: r.status,
        harvestDate: r.harvestDate,
      },
    }));
  res.json({ type: "FeatureCollection", features, totalCount: rows.length, mappedCount: features.length });
});

// ---------- GET /plots/stats ----------
// Aggregates plot count + total mapped area, grouped by one of: region | group | crop | status.
router.get("/plots/stats", async (req, res): Promise<void> => {
  const groupBy = String(req.query.groupBy ?? "region");
  if (!["region", "group", "crop", "status"].includes(groupBy)) {
    res.status(400).json({ error: "groupBy must be one of: region, group, crop, status" });
    return;
  }
  const filters = buildPlotFilters(req.query);

  const baseQuery = db
    .select({
      key:
        groupBy === "region" ? sql<string>`coalesce(${regionsTable.name}, 'Unassigned')`
        : groupBy === "group" ? sql<string>`coalesce(${groupsTable.name}, 'Unassigned')`
        : groupBy === "crop" ? plotsTable.cropType
        : plotsTable.status,
      keyId:
        groupBy === "region" ? sql<string | null>`${farmersTable.regionId}::text`
        : groupBy === "group" ? sql<string | null>`${farmersTable.groupId}::text`
        : sql<string | null>`null`,
      plotCount: sql<number>`count(*)::int`,
      totalAreaHectares: sql<number>`coalesce(sum(${plotsTable.areaHectares}), 0)::float`,
      farmerCount: sql<number>`count(distinct ${plotsTable.farmerId})::int`,
    })
    .from(plotsTable)
    .innerJoin(farmersTable, eq(plotsTable.farmerId, farmersTable.id))
    .leftJoin(groupsTable, eq(farmersTable.groupId, groupsTable.id))
    .leftJoin(regionsTable, eq(farmersTable.regionId, regionsTable.id))
    .where(filters.length > 0 ? and(...filters) : undefined);

  const groupExpr =
    groupBy === "region" ? [regionsTable.name, farmersTable.regionId] as const
    : groupBy === "group" ? [groupsTable.name, farmersTable.groupId] as const
    : groupBy === "crop" ? [plotsTable.cropType] as const
    : [plotsTable.status] as const;

  const rows = await baseQuery.groupBy(...groupExpr).orderBy(sql`2 desc`);
  res.json({ groupBy, rows });
});

// ---------- PATCH /plots/:plotId ----------
router.patch("/plots/:plotId", async (req, res): Promise<void> => {
  const { plotId } = req.params;
  if (!UUID_RE.test(plotId)) { res.status(400).json({ error: "Invalid plot id" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body.name === "string") patch.name = body.name.trim() || null;
  if (typeof body.cropType === "string" && body.cropType.trim()) patch.cropType = body.cropType.trim();
  if (typeof body.status === "string" && body.status.trim()) patch.status = body.status.trim();
  if (body.harvestDate === null) patch.harvestDate = null;
  else if (typeof body.harvestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.harvestDate)) patch.harvestDate = body.harvestDate;
  if (body.areaHectares !== undefined) {
    const n = Number(body.areaHectares);
    if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: "areaHectares must be a non-negative number" }); return; }
    patch.areaHectares = n.toFixed(4);
  }
  if (body.polygon !== undefined) {
    if (body.polygon === null) patch.polygon = null;
    else if (typeof body.polygon === "object" && body.polygon !== null) {
      const poly: any = body.polygon;
      if (poly.type !== "Polygon" && poly.type !== "MultiPolygon") {
        res.status(400).json({ error: "polygon must be a GeoJSON Polygon or MultiPolygon" }); return;
      }
      if (!Array.isArray(poly.coordinates)) {
        res.status(400).json({ error: "polygon.coordinates required" }); return;
      }
      patch.polygon = poly;
    } else { res.status(400).json({ error: "polygon must be an object or null" }); return; }
  }

  const [updated] = await db.update(plotsTable).set(patch).where(eq(plotsTable.id, plotId)).returning();
  if (!updated) { res.status(404).json({ error: "Plot not found" }); return; }
  res.json({ ...updated, areaHectares: parseFloat(updated.areaHectares ?? "0") });
});

// ---------- GET /plots/export ----------
// format: geojson | csv | kml. Same filters as /plots/geojson.
router.get("/plots/export", async (req, res): Promise<void> => {
  const format = String(req.query.format ?? "geojson").toLowerCase();
  if (!["geojson", "csv", "kml"].includes(format)) { res.status(400).json({ error: "format must be geojson|csv|kml" }); return; }

  const filters = buildPlotFilters(req.query);
  const rows = await db
    .select({
      id: plotsTable.id,
      farmerId: plotsTable.farmerId,
      name: plotsTable.name,
      cropType: plotsTable.cropType,
      areaHectares: plotsTable.areaHectares,
      polygon: plotsTable.polygon,
      status: plotsTable.status,
      harvestDate: plotsTable.harvestDate,
      farmerFirst: farmersTable.firstName,
      farmerLast: farmersTable.lastName,
      farmerRef: farmersTable.referenceNumber,
      groupName: groupsTable.name,
      regionName: regionsTable.name,
    })
    .from(plotsTable)
    .innerJoin(farmersTable, eq(plotsTable.farmerId, farmersTable.id))
    .leftJoin(groupsTable, eq(farmersTable.groupId, groupsTable.id))
    .leftJoin(regionsTable, eq(farmersTable.regionId, regionsTable.id))
    .where(filters.length > 0 ? and(...filters) : undefined);

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "geojson") {
    const fc = {
      type: "FeatureCollection",
      features: rows.filter(r => r.polygon != null).map(r => ({
        type: "Feature",
        geometry: r.polygon,
        properties: {
          id: r.id, farmerId: r.farmerId, farmerName: `${r.farmerFirst} ${r.farmerLast}`, farmerRef: r.farmerRef,
          groupName: r.groupName, regionName: r.regionName, name: r.name, cropType: r.cropType,
          areaHectares: parseFloat(r.areaHectares ?? "0"), status: r.status, harvestDate: r.harvestDate,
        },
      })),
    };
    res.setHeader("Content-Type", "application/geo+json");
    res.setHeader("Content-Disposition", `attachment; filename="plots-${stamp}.geojson"`);
    res.send(JSON.stringify(fc, null, 2));
    return;
  }

  if (format === "csv") {
    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ["id", "name", "farmerName", "farmerRef", "groupName", "regionName", "cropType", "areaHectares", "status", "harvestDate", "polygonWkt"];
    const polyToWkt = (poly: any): string => {
      if (!poly) return "";
      if (poly.type === "Polygon" && Array.isArray(poly.coordinates?.[0])) {
        const ring = poly.coordinates[0].map((c: number[]) => `${c[0]} ${c[1]}`).join(", ");
        return `POLYGON ((${ring}))`;
      }
      return "";
    };
    const lines = [
      headers.join(","),
      ...rows.map(r => [
        r.id, r.name ?? "", `${r.farmerFirst} ${r.farmerLast}`, r.farmerRef ?? "", r.groupName ?? "", r.regionName ?? "",
        r.cropType, parseFloat(r.areaHectares ?? "0"), r.status, r.harvestDate ?? "", polyToWkt(r.polygon),
      ].map(escape).join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="plots-${stamp}.csv"`);
    res.send(lines.join("\n"));
    return;
  }

  // KML
  const kmlEsc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const polyToKml = (poly: any): string => {
    if (!poly) return "";
    const ringToKml = (ring: number[][]) => ring.map(c => `${c[0]},${c[1]},0`).join(" ");
    if (poly.type === "Polygon") {
      const outer = `<outerBoundaryIs><LinearRing><coordinates>${ringToKml(poly.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs>`;
      const inners = (poly.coordinates.slice(1) as number[][][]).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${ringToKml(r)}</coordinates></LinearRing></innerBoundaryIs>`).join("");
      return `<Polygon>${outer}${inners}</Polygon>`;
    }
    if (poly.type === "MultiPolygon") {
      const polys = (poly.coordinates as number[][][][]).map((p) => {
        const outer = `<outerBoundaryIs><LinearRing><coordinates>${ringToKml(p[0])}</coordinates></LinearRing></outerBoundaryIs>`;
        return `<Polygon>${outer}</Polygon>`;
      }).join("");
      return `<MultiGeometry>${polys}</MultiGeometry>`;
    }
    return "";
  };
  const placemarks = rows.filter(r => r.polygon != null).map(r => `
    <Placemark>
      <name>${kmlEsc(r.name ?? `${r.farmerFirst} ${r.farmerLast}`)}</name>
      <description><![CDATA[
        Farmer: ${kmlEsc(`${r.farmerFirst} ${r.farmerLast}`)} (${kmlEsc(r.farmerRef ?? "")})<br/>
        Group: ${kmlEsc(r.groupName ?? "")}<br/>
        Region: ${kmlEsc(r.regionName ?? "")}<br/>
        Crop: ${kmlEsc(r.cropType)}<br/>
        Area: ${parseFloat(r.areaHectares ?? "0")} ha<br/>
        Status: ${kmlEsc(r.status)}
      ]]></description>
      <ExtendedData>
        <Data name="id"><value>${kmlEsc(r.id)}</value></Data>
        <Data name="cropType"><value>${kmlEsc(r.cropType)}</value></Data>
        <Data name="areaHectares"><value>${parseFloat(r.areaHectares ?? "0")}</value></Data>
        <Data name="status"><value>${kmlEsc(r.status)}</value></Data>
      </ExtendedData>
      ${polyToKml(r.polygon)}
    </Placemark>`).join("");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Mtandeo Farm Plots — ${stamp}</name>
    ${placemarks}
  </Document>
</kml>`;
  res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
  res.setHeader("Content-Disposition", `attachment; filename="plots-${stamp}.kml"`);
  res.send(kml);
});

router.get("/plots/:plotId", async (req, res): Promise<void> => {
  const { plotId } = req.params;
  const [plot] = await db.select().from(plotsTable).where(eq(plotsTable.id, plotId as string));
  if (!plot) {
    res.status(404).json({ error: "Plot not found" });
    return;
  }
  res.json({ ...plot, areaHectares: parseFloat(plot.areaHectares ?? "0") });
});

export default router;

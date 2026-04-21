import { Router, type IRouter } from "express";
import { eq, and, or, desc, lte, isNull, inArray } from "drizzle-orm";
import {
  db,
  commoditiesTable,
  commodityTypesTable,
  commodityPricesTable,
  commodityConversionsTable,
  commoditySeasonsTable,
  auditLogsTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const STAGES = new Set(["raw", "intermediate", "finished"]);
const PRICE_SOURCES = new Set(["manual", "market", "contract"]);

async function audit(entityType: string, entityId: string, action: string, user: any, before: any, after: any) {
  await db.insert(auditLogsTable).values({
    entityType, entityId, action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    before, after,
  });
}

function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s;
}

// =============== COMMODITIES ===============

router.get("/api/commodities", requirePermission("commodities.read"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = status ? eq(commoditiesTable.status, status) : undefined;
  const rows = await db.select().from(commoditiesTable).where(where).orderBy(commoditiesTable.name);

  const typeRows = await db.select().from(commodityTypesTable);
  const typesByCommodity = new Map<string, any[]>();
  for (const t of typeRows) {
    const arr = typesByCommodity.get(t.commodityId) ?? [];
    arr.push(t);
    typesByCommodity.set(t.commodityId, arr);
  }
  res.json(rows.map(c => ({ ...c, types: typesByCommodity.get(c.id) ?? [] })));
});

router.post("/api/commodities", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { name, code, scientificName, defaultUnit, description, status } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  if (typeof code !== "string" || !code.trim()) { res.status(400).json({ error: "code required" }); return; }
  const normCode = code.trim().toLowerCase();

  const [dup] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.code, normCode));
  if (dup) { res.status(409).json({ error: "Commodity code already exists" }); return; }

  const [created] = await db.insert(commoditiesTable).values({
    name: name.trim(),
    code: normCode,
    scientificName: scientificName?.toString().trim() || null,
    defaultUnit: defaultUnit?.toString().trim() || "kg",
    description: description ?? null,
    status: status === "inactive" ? "inactive" : "active",
  }).returning();
  await audit("commodity", created.id, "commodity.create", req.authedUser, null, created);
  res.status(201).json(created);
});

router.patch("/api/commodities/:id", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { id } = req.params;
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Commodity not found" }); return; }

  const patch: any = { updatedAt: new Date() };
  const { name, scientificName, defaultUnit, description, status } = req.body ?? {};
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  if (scientificName !== undefined) patch.scientificName = scientificName?.toString().trim() || null;
  if (defaultUnit !== undefined && defaultUnit?.toString().trim()) patch.defaultUnit = defaultUnit.toString().trim();
  if (description !== undefined) patch.description = description;
  if (status === "active" || status === "inactive") patch.status = status;

  const [updated] = await db.update(commoditiesTable).set(patch).where(eq(commoditiesTable.id, id)).returning();
  await audit("commodity", id, "commodity.update", req.authedUser, existing, updated);
  res.json(updated);
});

// =============== COMMODITY TYPES ===============

router.get("/api/commodities/:commodityId/types", requirePermission("commodities.read"), async (req, res) => {
  const { commodityId } = req.params;
  if (!isUuid(commodityId)) { res.status(400).json({ error: "Invalid commodityId" }); return; }
  const rows = await db.select().from(commodityTypesTable)
    .where(eq(commodityTypesTable.commodityId, commodityId))
    .orderBy(commodityTypesTable.name);
  res.json(rows);
});

router.post("/api/commodities/:commodityId/types", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { commodityId } = req.params;
  if (!isUuid(commodityId)) { res.status(400).json({ error: "Invalid commodityId" }); return; }
  const [parent] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.id, commodityId));
  if (!parent) { res.status(404).json({ error: "Commodity not found" }); return; }

  const { name, code, stage, parentCommodityTypeId, isTradable, defaultUnit, defaultMoistureMin, defaultMoistureMax, status } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  if (typeof code !== "string" || !code.trim()) { res.status(400).json({ error: "code required" }); return; }
  const normCode = code.trim().toLowerCase();
  const stg = (stage ?? "raw").toString().toLowerCase();
  if (!STAGES.has(stg)) { res.status(400).json({ error: "stage must be raw|intermediate|finished" }); return; }

  if (parentCommodityTypeId != null) {
    if (!isUuid(parentCommodityTypeId)) { res.status(400).json({ error: "Invalid parentCommodityTypeId" }); return; }
    const [p] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, parentCommodityTypeId));
    if (!p) { res.status(400).json({ error: "Parent commodity type not found" }); return; }
    if (p.commodityId !== commodityId) { res.status(400).json({ error: "Parent must belong to the same commodity" }); return; }
  }

  const validMoist = (m: any) => m == null || m === "" || (Number.isFinite(Number(m)) && Number(m) >= 0 && Number(m) <= 100);
  if (!validMoist(defaultMoistureMin) || !validMoist(defaultMoistureMax)) {
    res.status(400).json({ error: "defaultMoisture must be 0-100" }); return;
  }
  if (defaultMoistureMin != null && defaultMoistureMin !== "" && defaultMoistureMax != null && defaultMoistureMax !== "" &&
      Number(defaultMoistureMin) > Number(defaultMoistureMax)) {
    res.status(400).json({ error: "defaultMoistureMin must be <= defaultMoistureMax" }); return;
  }

  const [dup] = await db.select().from(commodityTypesTable)
    .where(and(eq(commodityTypesTable.commodityId, commodityId), eq(commodityTypesTable.code, normCode)));
  if (dup) { res.status(409).json({ error: "Type code already exists for this commodity" }); return; }

  const [created] = await db.insert(commodityTypesTable).values({
    commodityId,
    name: name.trim(),
    code: normCode,
    stage: stg,
    parentCommodityTypeId: parentCommodityTypeId ?? null,
    isTradable: isTradable === false ? false : true,
    defaultUnit: defaultUnit?.toString().trim() || parent.defaultUnit || "kg",
    defaultMoistureMin: defaultMoistureMin != null && defaultMoistureMin !== "" ? Number(defaultMoistureMin).toString() : null,
    defaultMoistureMax: defaultMoistureMax != null && defaultMoistureMax !== "" ? Number(defaultMoistureMax).toString() : null,
    status: status === "inactive" ? "inactive" : "active",
  }).returning();
  await audit("commodity_type", created.id, "commodity_type.create", req.authedUser, null, created);
  res.status(201).json(created);
});

router.patch("/api/commodity-types/:typeId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const [existing] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (!existing) { res.status(404).json({ error: "Type not found" }); return; }

  const patch: any = { updatedAt: new Date() };
  const { name, stage, parentCommodityTypeId, isTradable, defaultUnit, defaultMoistureMin, defaultMoistureMax, status } = req.body ?? {};
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  if (stage !== undefined) {
    const stg = stage.toString().toLowerCase();
    if (!STAGES.has(stg)) { res.status(400).json({ error: "stage must be raw|intermediate|finished" }); return; }
    patch.stage = stg;
  }
  if (parentCommodityTypeId !== undefined) {
    if (parentCommodityTypeId === null) {
      patch.parentCommodityTypeId = null;
    } else {
      if (!isUuid(parentCommodityTypeId)) { res.status(400).json({ error: "Invalid parentCommodityTypeId" }); return; }
      if (parentCommodityTypeId === typeId) { res.status(400).json({ error: "A type cannot be its own parent" }); return; }
      const [p] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, parentCommodityTypeId));
      if (!p) { res.status(400).json({ error: "Parent commodity type not found" }); return; }
      if (p.commodityId !== existing.commodityId) { res.status(400).json({ error: "Parent must belong to the same commodity" }); return; }
      patch.parentCommodityTypeId = parentCommodityTypeId;
    }
  }
  if (isTradable !== undefined) patch.isTradable = !!isTradable;
  if (defaultUnit !== undefined && defaultUnit?.toString().trim()) patch.defaultUnit = defaultUnit.toString().trim();
  const validMoist = (m: any) => m == null || m === "" || (Number.isFinite(Number(m)) && Number(m) >= 0 && Number(m) <= 100);
  if (defaultMoistureMin !== undefined) {
    if (!validMoist(defaultMoistureMin)) { res.status(400).json({ error: "Invalid defaultMoistureMin" }); return; }
    patch.defaultMoistureMin = defaultMoistureMin == null || defaultMoistureMin === "" ? null : Number(defaultMoistureMin).toString();
  }
  if (defaultMoistureMax !== undefined) {
    if (!validMoist(defaultMoistureMax)) { res.status(400).json({ error: "Invalid defaultMoistureMax" }); return; }
    patch.defaultMoistureMax = defaultMoistureMax == null || defaultMoistureMax === "" ? null : Number(defaultMoistureMax).toString();
  }
  // Cross-field min<=max guard using the merged result (existing + patch).
  const finalMin = patch.defaultMoistureMin !== undefined ? patch.defaultMoistureMin : existing.defaultMoistureMin;
  const finalMax = patch.defaultMoistureMax !== undefined ? patch.defaultMoistureMax : existing.defaultMoistureMax;
  if (finalMin != null && finalMax != null && Number(finalMin) > Number(finalMax)) {
    res.status(400).json({ error: "defaultMoistureMin must be <= defaultMoistureMax" }); return;
  }
  if (status === "active" || status === "inactive") patch.status = status;

  const [updated] = await db.update(commodityTypesTable).set(patch).where(eq(commodityTypesTable.id, typeId)).returning();
  await audit("commodity_type", typeId, "commodity_type.update", req.authedUser, existing, updated);
  res.json(updated);
});

// =============== SEASONS ===============

router.get("/api/commodity-types/:typeId/seasons", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const rows = await db.select().from(commoditySeasonsTable)
    .where(eq(commoditySeasonsTable.commodityTypeId, typeId))
    .orderBy(desc(commoditySeasonsTable.startDate));
  res.json(rows);
});

router.post("/api/commodity-types/:typeId/seasons", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const [type] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (!type) { res.status(404).json({ error: "Commodity type not found" }); return; }

  const { seasonName, startDate, endDate, regionId, isActive, notes } = req.body ?? {};
  if (typeof seasonName !== "string" || !seasonName.trim()) { res.status(400).json({ error: "seasonName required" }); return; }
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) { res.status(400).json({ error: "startDate/endDate must be valid YYYY-MM-DD" }); return; }
  if (startDate > endDate) { res.status(400).json({ error: "startDate must be <= endDate" }); return; }
  if (regionId != null && regionId !== "" && !isUuid(regionId)) { res.status(400).json({ error: "Invalid regionId" }); return; }

  const [created] = await db.insert(commoditySeasonsTable).values({
    commodityTypeId: typeId,
    seasonName: seasonName.trim(),
    startDate, endDate,
    regionId: regionId || null,
    isActive: isActive === false ? false : true,
    notes: notes ?? null,
  }).returning();
  await audit("commodity_season", created.id, "commodity_season.create", req.authedUser, null, created);
  res.status(201).json(created);
});

router.delete("/api/commodity-seasons/:seasonId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { seasonId } = req.params;
  if (!isUuid(seasonId)) { res.status(400).json({ error: "Invalid seasonId" }); return; }
  const [existing] = await db.select().from(commoditySeasonsTable).where(eq(commoditySeasonsTable.id, seasonId));
  if (!existing) { res.status(404).json({ error: "Season not found" }); return; }
  await db.delete(commoditySeasonsTable).where(eq(commoditySeasonsTable.id, seasonId));
  await audit("commodity_season", seasonId, "commodity_season.delete", req.authedUser, existing, null);
  res.status(204).end();
});

// =============== PRICES ===============

router.get("/api/commodity-types/:typeId/prices", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const rows = await db.select().from(commodityPricesTable)
    .where(eq(commodityPricesTable.commodityTypeId, typeId))
    .orderBy(desc(commodityPricesTable.effectiveDate), desc(commodityPricesTable.createdAt))
    .limit(limit);
  res.json(rows);
});

router.get("/api/commodity-types/:typeId/prices/current", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  let regionId: string | null = null;
  if (req.query.regionId !== undefined && req.query.regionId !== "") {
    if (typeof req.query.regionId !== "string" || !isUuid(req.query.regionId)) {
      res.status(400).json({ error: "Invalid regionId" }); return;
    }
    regionId = req.query.regionId;
  }
  const today = new Date().toISOString().slice(0, 10);

  const tryFetch = async (rid: string | null) => {
    const conds = [eq(commodityPricesTable.commodityTypeId, typeId), lte(commodityPricesTable.effectiveDate, today)];
    conds.push(rid ? eq(commodityPricesTable.regionId, rid) : isNull(commodityPricesTable.regionId));
    const [row] = await db.select().from(commodityPricesTable).where(and(...conds))
      .orderBy(desc(commodityPricesTable.effectiveDate), desc(commodityPricesTable.createdAt))
      .limit(1);
    return row ?? null;
  };
  let row = regionId ? await tryFetch(regionId) : null;
  if (!row) row = await tryFetch(null);
  if (!row) { res.status(404).json({ error: "No price set for this commodity type" }); return; }
  res.json(row);
});

router.post("/api/commodity-types/:typeId/prices", requirePermission("commodities.prices.write"), async (req: AuthedRequest, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const [type] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (!type) { res.status(404).json({ error: "Commodity type not found" }); return; }

  const { regionId, pricePerKg, currency, effectiveDate, source, notes } = req.body ?? {};
  const price = Number(pricePerKg);
  if (!Number.isFinite(price) || price <= 0) { res.status(400).json({ error: "pricePerKg must be a positive number" }); return; }
  if (!isCalendarDate(effectiveDate)) { res.status(400).json({ error: "effectiveDate must be valid YYYY-MM-DD" }); return; }
  if (regionId != null && regionId !== "" && !isUuid(regionId)) { res.status(400).json({ error: "Invalid regionId" }); return; }
  const src = (source ?? "manual").toString().toLowerCase();
  if (!PRICE_SOURCES.has(src)) { res.status(400).json({ error: "source must be manual|market|contract" }); return; }

  try {
    const [created] = await db.insert(commodityPricesTable).values({
      commodityTypeId: typeId,
      regionId: regionId || null,
      pricePerKg: price.toString(),
      currency: (currency ?? "UGX").toString().toUpperCase().slice(0, 8),
      effectiveDate,
      source: src,
      notes: notes ?? null,
      createdById: req.authedUser?.id ?? null,
    }).returning();
    await audit("commodity_price", created.id, "commodity_price.create", req.authedUser, null, created);
    res.status(201).json(created);
  } catch (e: any) {
    if (e?.code === "23505") {
      res.status(409).json({ error: "A price for this commodity type, region, currency and date already exists" });
      return;
    }
    throw e;
  }
});

// =============== CONVERSIONS (type → type) ===============

// List conversions where the given type is either source or destination — used to render the
// processing graph for that type.
router.get("/api/commodity-types/:typeId/conversions", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const rows = await db.select().from(commodityConversionsTable)
    .where(or(eq(commodityConversionsTable.fromCommodityTypeId, typeId), eq(commodityConversionsTable.toCommodityTypeId, typeId)));
  res.json(rows);
});

// Full conversions catalog (admin view, optionally filter by commodityId).
router.get("/api/commodity-conversions", requirePermission("commodities.read"), async (req, res) => {
  const commodityId = typeof req.query.commodityId === "string" && isUuid(req.query.commodityId) ? req.query.commodityId : null;
  if (commodityId) {
    const types = await db.select({ id: commodityTypesTable.id }).from(commodityTypesTable).where(eq(commodityTypesTable.commodityId, commodityId));
    const typeIds = types.map(t => t.id);
    if (typeIds.length === 0) { res.json([]); return; }
    const rows = await db.select().from(commodityConversionsTable)
      .where(or(inArray(commodityConversionsTable.fromCommodityTypeId, typeIds), inArray(commodityConversionsTable.toCommodityTypeId, typeIds)))
      .orderBy(desc(commodityConversionsTable.effectiveDate));
    res.json(rows);
    return;
  }
  const rows = await db.select().from(commodityConversionsTable).orderBy(desc(commodityConversionsTable.effectiveDate));
  res.json(rows);
});

router.post("/api/commodity-conversions", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { fromCommodityTypeId, toCommodityTypeId, expectedRate, minRate, maxRate, processType, effectiveDate, version, notes } = req.body ?? {};
  if (!isUuid(fromCommodityTypeId)) { res.status(400).json({ error: "fromCommodityTypeId required" }); return; }
  if (!isUuid(toCommodityTypeId)) { res.status(400).json({ error: "toCommodityTypeId required" }); return; }
  if (fromCommodityTypeId === toCommodityTypeId) { res.status(400).json({ error: "from and to must differ" }); return; }
  const exp = Number(expectedRate);
  if (!Number.isFinite(exp) || exp <= 0) { res.status(400).json({ error: "expectedRate must be a positive number" }); return; }
  const min = minRate != null && minRate !== "" ? Number(minRate) : null;
  const max = maxRate != null && maxRate !== "" ? Number(maxRate) : null;
  if (min != null && (!Number.isFinite(min) || min <= 0)) { res.status(400).json({ error: "minRate invalid" }); return; }
  if (max != null && (!Number.isFinite(max) || max <= 0)) { res.status(400).json({ error: "maxRate invalid" }); return; }
  if (min != null && max != null && min > max) { res.status(400).json({ error: "minRate must be <= maxRate" }); return; }
  if (min != null && exp < min) { res.status(400).json({ error: "expectedRate must be >= minRate" }); return; }
  if (max != null && exp > max) { res.status(400).json({ error: "expectedRate must be <= maxRate" }); return; }
  const eff = effectiveDate || new Date().toISOString().slice(0, 10);
  if (!isCalendarDate(eff)) { res.status(400).json({ error: "effectiveDate must be valid YYYY-MM-DD" }); return; }

  // Both types must exist and belong to the same commodity (transformations are within one crop).
  const types = await db.select().from(commodityTypesTable).where(inArray(commodityTypesTable.id, [fromCommodityTypeId, toCommodityTypeId]));
  if (types.length !== 2) { res.status(400).json({ error: "One or both commodity types not found" }); return; }
  if (types[0].commodityId !== types[1].commodityId) {
    res.status(400).json({ error: "Both types must belong to the same commodity" }); return;
  }

  try {
    const [created] = await db.insert(commodityConversionsTable).values({
      fromCommodityTypeId, toCommodityTypeId,
      expectedRate: exp.toString(),
      minRate: min != null ? min.toString() : null,
      maxRate: max != null ? max.toString() : null,
      processType: processType?.toString().trim() || null,
      effectiveDate: eff,
      version: Number.isInteger(version) && version > 0 ? version : 1,
      notes: notes ?? null,
    }).returning();
    await audit("commodity_conversion", created.id, "commodity_conversion.create", req.authedUser, null, created);
    res.status(201).json(created);
  } catch (e: any) {
    if (e?.code === "23505") {
      res.status(409).json({ error: "A conversion for this from→to pair on that effective date already exists" });
      return;
    }
    throw e;
  }
});

router.delete("/api/commodity-conversions/:conversionId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { conversionId } = req.params;
  if (!isUuid(conversionId)) { res.status(400).json({ error: "Invalid conversionId" }); return; }
  const [existing] = await db.select().from(commodityConversionsTable).where(eq(commodityConversionsTable.id, conversionId));
  if (!existing) { res.status(404).json({ error: "Conversion not found" }); return; }
  await db.delete(commodityConversionsTable).where(eq(commodityConversionsTable.id, conversionId));
  await audit("commodity_conversion", conversionId, "commodity_conversion.delete", req.authedUser, existing, null);
  res.status(204).end();
});

// On-the-fly conversion calculator: from one type to another, applying chain of conversions if
// no direct rate exists. Returns the multiplied effective rate. e.g. Cherry → Green Bean via
// Cherry → Parchment (0.45) × Parchment → Green Bean (0.50) = 0.225.
router.get("/api/commodity-types/:fromTypeId/convert/:toTypeId", requirePermission("commodities.read"), async (req, res) => {
  const { fromTypeId, toTypeId } = req.params;
  if (!isUuid(fromTypeId) || !isUuid(toTypeId)) { res.status(400).json({ error: "Invalid type id" }); return; }
  const qty = Number(req.query.quantity ?? 1);
  if (!Number.isFinite(qty) || qty < 0) { res.status(400).json({ error: "quantity must be a non-negative number" }); return; }
  const today = new Date().toISOString().slice(0, 10);

  // Pull latest active rate per pair (effectiveDate <= today) for this commodity's types only.
  const endpoints = await db.select().from(commodityTypesTable).where(inArray(commodityTypesTable.id, [fromTypeId, toTypeId]));
  const fromType = endpoints.find(t => t.id === fromTypeId);
  const toType = endpoints.find(t => t.id === toTypeId);
  if (!fromType) { res.status(404).json({ error: "fromType not found" }); return; }
  if (!toType) { res.status(404).json({ error: "toType not found" }); return; }
  if (fromType.commodityId !== toType.commodityId) {
    res.status(400).json({ error: "fromType and toType must belong to the same commodity" }); return;
  }
  const allTypes = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.commodityId, fromType.commodityId));
  const typeIds = allTypes.map(t => t.id);

  const allConvs = await db.select().from(commodityConversionsTable)
    .where(and(
      inArray(commodityConversionsTable.fromCommodityTypeId, typeIds),
      lte(commodityConversionsTable.effectiveDate, today),
    ))
    .orderBy(desc(commodityConversionsTable.effectiveDate), desc(commodityConversionsTable.version));

  // Keep the latest per from→to pair.
  const latestByPair = new Map<string, typeof allConvs[number]>();
  for (const c of allConvs) {
    const key = `${c.fromCommodityTypeId}->${c.toCommodityTypeId}`;
    if (!latestByPair.has(key)) latestByPair.set(key, c);
  }

  // BFS shortest chain.
  const adj = new Map<string, Array<{ to: string; conv: typeof allConvs[number] }>>();
  for (const c of latestByPair.values()) {
    const arr = adj.get(c.fromCommodityTypeId) ?? [];
    arr.push({ to: c.toCommodityTypeId, conv: c });
    adj.set(c.fromCommodityTypeId, arr);
  }

  if (fromTypeId === toTypeId) {
    res.json({ fromTypeId, toTypeId, quantity: qty, ratio: 1, result: qty, path: [] });
    return;
  }

  const visited = new Set<string>([fromTypeId]);
  const queue: Array<{ node: string; path: typeof allConvs }> = [{ node: fromTypeId, path: [] }];
  while (queue.length) {
    const { node, path } = queue.shift()!;
    for (const { to, conv } of adj.get(node) ?? []) {
      if (visited.has(to)) continue;
      const newPath = [...path, conv];
      if (to === toTypeId) {
        const ratio = newPath.reduce((acc, c) => acc * Number(c.expectedRate), 1);
        res.json({ fromTypeId, toTypeId, quantity: qty, ratio, result: qty * ratio, path: newPath });
        return;
      }
      visited.add(to);
      queue.push({ node: to, path: newPath });
    }
  }
  res.status(404).json({ error: "No conversion path found between these commodity types" });
});

export default router;

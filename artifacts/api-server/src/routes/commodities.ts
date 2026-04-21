import { Router, type IRouter } from "express";
import { eq, and, or, desc, lte, isNull, inArray } from "drizzle-orm";
import {
  db,
  commoditiesTable,
  commodityTypesTable,
  commodityPricesTable,
  commodityConversionsTable,
  commoditySeasonsTable,
  commodityQualitySpecsTable,
  samplingConfigsTable,
  auditLogsTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const STAGES = new Set(["raw", "intermediate", "finished"]);
const PRICE_SOURCES = new Set(["manual", "market", "contract"]);
// Sample stages where a quality spec can apply. Mirrors the planned Sampling Module's
// `SampleStage` enum so a spec authored here can be auto-loaded by sampling without translation.
const SAMPLE_STAGES = new Set(["field", "pre_offload", "post_offload", "warehouse", "processing", "export"]);

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

router.get("/commodities", requirePermission("commodities.read"), async (req, res) => {
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

router.post("/commodities", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
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

router.patch("/commodities/:id", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
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

router.get("/commodities/:commodityId/types", requirePermission("commodities.read"), async (req, res) => {
  const { commodityId } = req.params;
  if (!isUuid(commodityId)) { res.status(400).json({ error: "Invalid commodityId" }); return; }
  const rows = await db.select().from(commodityTypesTable)
    .where(eq(commodityTypesTable.commodityId, commodityId))
    .orderBy(commodityTypesTable.name);
  res.json(rows);
});

router.post("/commodities/:commodityId/types", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { commodityId } = req.params;
  if (!isUuid(commodityId)) { res.status(400).json({ error: "Invalid commodityId" }); return; }
  const [parent] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.id, commodityId));
  if (!parent) { res.status(404).json({ error: "Commodity not found" }); return; }

  const { name, code, stage, parentCommodityTypeId, isPurchasable, isSellable, defaultUnit, defaultMoistureMin, defaultMoistureMax, status } = req.body ?? {};
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
    isPurchasable: isPurchasable === false ? false : true,
    isSellable: isSellable === false ? false : true,
    defaultUnit: defaultUnit?.toString().trim() || parent.defaultUnit || "kg",
    defaultMoistureMin: defaultMoistureMin != null && defaultMoistureMin !== "" ? Number(defaultMoistureMin).toString() : null,
    defaultMoistureMax: defaultMoistureMax != null && defaultMoistureMax !== "" ? Number(defaultMoistureMax).toString() : null,
    status: status === "inactive" ? "inactive" : "active",
  }).returning();
  await audit("commodity_type", created.id, "commodity_type.create", req.authedUser, null, created);
  res.status(201).json(created);
});

router.patch("/commodity-types/:typeId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const [existing] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (!existing) { res.status(404).json({ error: "Type not found" }); return; }

  const patch: any = { updatedAt: new Date() };
  const { name, stage, parentCommodityTypeId, isPurchasable, isSellable, defaultUnit, defaultMoistureMin, defaultMoistureMax, status } = req.body ?? {};
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
  if (isPurchasable !== undefined) patch.isPurchasable = !!isPurchasable;
  if (isSellable !== undefined) patch.isSellable = !!isSellable;
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

router.get("/commodity-types/:typeId/seasons", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const rows = await db.select().from(commoditySeasonsTable)
    .where(eq(commoditySeasonsTable.commodityTypeId, typeId))
    .orderBy(desc(commoditySeasonsTable.startDate));
  res.json(rows);
});

router.post("/commodity-types/:typeId/seasons", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
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

router.delete("/commodity-seasons/:seasonId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { seasonId } = req.params;
  if (!isUuid(seasonId)) { res.status(400).json({ error: "Invalid seasonId" }); return; }
  const [existing] = await db.select().from(commoditySeasonsTable).where(eq(commoditySeasonsTable.id, seasonId));
  if (!existing) { res.status(404).json({ error: "Season not found" }); return; }
  await db.delete(commoditySeasonsTable).where(eq(commoditySeasonsTable.id, seasonId));
  await audit("commodity_season", seasonId, "commodity_season.delete", req.authedUser, existing, null);
  res.status(204).end();
});

// =============== PRICES ===============

router.get("/commodity-types/:typeId/prices", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const rows = await db.select().from(commodityPricesTable)
    .where(eq(commodityPricesTable.commodityTypeId, typeId))
    .orderBy(desc(commodityPricesTable.effectiveDate), desc(commodityPricesTable.createdAt))
    .limit(limit);
  res.json(rows);
});

router.get("/commodity-types/:typeId/prices/current", requirePermission("commodities.read"), async (req, res) => {
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

router.post("/commodity-types/:typeId/prices", requirePermission("commodities.prices.write"), async (req: AuthedRequest, res) => {
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
router.get("/commodity-types/:typeId/conversions", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const rows = await db.select().from(commodityConversionsTable)
    .where(or(eq(commodityConversionsTable.fromCommodityTypeId, typeId), eq(commodityConversionsTable.toCommodityTypeId, typeId)));
  res.json(rows);
});

// Full conversions catalog (admin view, optionally filter by commodityId).
router.get("/commodity-conversions", requirePermission("commodities.read"), async (req, res) => {
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

router.post("/commodity-conversions", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
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

router.delete("/commodity-conversions/:conversionId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
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
router.get("/commodity-types/:fromTypeId/convert/:toTypeId", requirePermission("commodities.read"), async (req, res) => {
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

// =============== QUALITY SPECS (Sampling Module input) ===============
//
// These rows define the QC parameters that the Sampling Module will auto-load when a sample is
// created for a given CommodityType. The latest active version of each parameterCode (by
// effectiveDate desc, version desc) is what sampling will surface.

router.get("/commodity-types/:typeId/quality-specs", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const showInactive = req.query.includeInactive === "true";
  const conds = [eq(commodityQualitySpecsTable.commodityTypeId, typeId)];
  if (!showInactive) conds.push(eq(commodityQualitySpecsTable.status, "active"));
  const rows = await db.select().from(commodityQualitySpecsTable)
    .where(and(...conds))
    .orderBy(commodityQualitySpecsTable.parameterName, desc(commodityQualitySpecsTable.effectiveDate), desc(commodityQualitySpecsTable.version));
  res.json(rows);
});

// "Active set" — the resolved spec that sampling should use today: latest active version of each
// parameterCode with effectiveDate <= today, optionally filtered by sample stage.
router.get("/commodity-types/:typeId/quality-specs/active", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const stage = typeof req.query.stage === "string" ? req.query.stage : null;
  if (stage && !SAMPLE_STAGES.has(stage)) { res.status(400).json({ error: `stage must be one of ${[...SAMPLE_STAGES].join("|")}` }); return; }
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db.select().from(commodityQualitySpecsTable)
    .where(and(
      eq(commodityQualitySpecsTable.commodityTypeId, typeId),
      eq(commodityQualitySpecsTable.status, "active"),
      lte(commodityQualitySpecsTable.effectiveDate, today),
    ))
    .orderBy(desc(commodityQualitySpecsTable.effectiveDate), desc(commodityQualitySpecsTable.version));

  // Stage filter MUST run before the latest-per-parameterCode reduction. Otherwise a newer
  // stage-specific spec (e.g. v2 export-only) would mask an older broadly-applicable one
  // (e.g. v1 all-stages) and the requested stage would incorrectly come back empty.
  const stageFiltered = stage
    ? rows.filter(s => {
        const stages = Array.isArray(s.appliesAtStages) ? s.appliesAtStages as string[] : null;
        return !stages || stages.length === 0 || stages.includes(stage);
      })
    : rows;

  const latest = new Map<string, typeof rows[number]>();
  for (const r of stageFiltered) {
    if (!latest.has(r.parameterCode)) latest.set(r.parameterCode, r);
  }
  res.json([...latest.values()]);
});

router.post("/commodity-types/:typeId/quality-specs", requirePermission("commodities.quality.write"), async (req: AuthedRequest, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const [type] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (!type) { res.status(404).json({ error: "Commodity type not found" }); return; }

  const { parameterName, parameterCode, unit, minValue, maxValue, targetValue, methodUsed,
          affectsPrice, mandatory, appliesAtStages, effectiveDate, version, notes } = req.body ?? {};

  if (typeof parameterName !== "string" || !parameterName.trim()) { res.status(400).json({ error: "parameterName required" }); return; }
  if (typeof parameterCode !== "string" || !parameterCode.trim()) { res.status(400).json({ error: "parameterCode required" }); return; }
  const code = parameterCode.trim().toLowerCase().replace(/\s+/g, "_");

  const num = (v: any) => v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN);
  const min = num(minValue), max = num(maxValue), target = num(targetValue);
  if (Number.isNaN(min) || Number.isNaN(max) || Number.isNaN(target)) {
    res.status(400).json({ error: "minValue/maxValue/targetValue must be numeric" }); return;
  }
  if (min == null && max == null) {
    res.status(400).json({ error: "At least one of minValue or maxValue must be provided" }); return;
  }
  if (min != null && max != null && min > max) {
    res.status(400).json({ error: "minValue must be <= maxValue" }); return;
  }
  if (target != null) {
    if (min != null && target < min) { res.status(400).json({ error: "targetValue must be >= minValue" }); return; }
    if (max != null && target > max) { res.status(400).json({ error: "targetValue must be <= maxValue" }); return; }
  }

  let stages: string[] | null = null;
  if (appliesAtStages != null) {
    if (!Array.isArray(appliesAtStages)) { res.status(400).json({ error: "appliesAtStages must be an array" }); return; }
    const invalid = appliesAtStages.find((s: any) => typeof s !== "string" || !SAMPLE_STAGES.has(s));
    if (invalid !== undefined) { res.status(400).json({ error: `appliesAtStages contains invalid stage; valid: ${[...SAMPLE_STAGES].join("|")}` }); return; }
    stages = appliesAtStages.length === 0 ? null : appliesAtStages;
  }

  const eff = effectiveDate || new Date().toISOString().slice(0, 10);
  if (!isCalendarDate(eff)) { res.status(400).json({ error: "effectiveDate must be valid YYYY-MM-DD" }); return; }
  const ver = Number.isInteger(version) && version > 0 ? version : 1;

  try {
    const [created] = await db.insert(commodityQualitySpecsTable).values({
      commodityTypeId: typeId,
      parameterName: parameterName.trim(),
      parameterCode: code,
      unit: unit?.toString().trim() || null,
      minValue: min != null ? min.toString() : null,
      maxValue: max != null ? max.toString() : null,
      targetValue: target != null ? target.toString() : null,
      methodUsed: methodUsed?.toString().trim() || null,
      affectsPrice: !!affectsPrice,
      mandatory: mandatory === false ? false : true,
      appliesAtStages: stages,
      effectiveDate: eff,
      version: ver,
      status: "active",
      notes: notes ?? null,
      createdById: req.authedUser?.id ?? null,
    }).returning();
    await audit("commodity_quality_spec", created.id, "commodity_quality_spec.create", req.authedUser, null, created);
    res.status(201).json(created);
  } catch (e: any) {
    if (e?.code === "23505") {
      res.status(409).json({ error: "A spec for this parameterCode on that effective date and version already exists — bump version to revise" });
      return;
    }
    throw e;
  }
});

router.patch("/commodity-quality-specs/:specId", requirePermission("commodities.quality.write"), async (req: AuthedRequest, res) => {
  const { specId } = req.params;
  if (!isUuid(specId)) { res.status(400).json({ error: "Invalid specId" }); return; }
  const [existing] = await db.select().from(commodityQualitySpecsTable).where(eq(commodityQualitySpecsTable.id, specId));
  if (!existing) { res.status(404).json({ error: "Spec not found" }); return; }

  const patch: any = { updatedAt: new Date() };
  const { parameterName, unit, methodUsed, affectsPrice, mandatory, status, notes, appliesAtStages,
          minValue, maxValue, targetValue } = req.body ?? {};

  if (typeof parameterName === "string" && parameterName.trim()) patch.parameterName = parameterName.trim();
  if (unit !== undefined) patch.unit = unit?.toString().trim() || null;
  if (methodUsed !== undefined) patch.methodUsed = methodUsed?.toString().trim() || null;
  if (affectsPrice !== undefined) patch.affectsPrice = !!affectsPrice;
  if (mandatory !== undefined) patch.mandatory = !!mandatory;
  if (status === "active" || status === "inactive") patch.status = status;
  if (notes !== undefined) patch.notes = notes;
  if (appliesAtStages !== undefined) {
    if (appliesAtStages === null) {
      patch.appliesAtStages = null;
    } else {
      if (!Array.isArray(appliesAtStages)) { res.status(400).json({ error: "appliesAtStages must be an array or null" }); return; }
      const invalid = appliesAtStages.find((s: any) => typeof s !== "string" || !SAMPLE_STAGES.has(s));
      if (invalid !== undefined) { res.status(400).json({ error: "appliesAtStages contains invalid stage" }); return; }
      patch.appliesAtStages = appliesAtStages.length === 0 ? null : appliesAtStages;
    }
  }
  const num = (v: any) => v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN);
  if (minValue !== undefined) {
    const n = num(minValue);
    if (Number.isNaN(n)) { res.status(400).json({ error: "minValue must be numeric" }); return; }
    patch.minValue = n != null ? n.toString() : null;
  }
  if (maxValue !== undefined) {
    const n = num(maxValue);
    if (Number.isNaN(n)) { res.status(400).json({ error: "maxValue must be numeric" }); return; }
    patch.maxValue = n != null ? n.toString() : null;
  }
  if (targetValue !== undefined) {
    const n = num(targetValue);
    if (Number.isNaN(n)) { res.status(400).json({ error: "targetValue must be numeric" }); return; }
    patch.targetValue = n != null ? n.toString() : null;
  }

  // Cross-field guards on merged result.
  const finalMin = patch.minValue !== undefined ? patch.minValue : existing.minValue;
  const finalMax = patch.maxValue !== undefined ? patch.maxValue : existing.maxValue;
  const finalTarget = patch.targetValue !== undefined ? patch.targetValue : existing.targetValue;
  if (finalMin == null && finalMax == null) { res.status(400).json({ error: "At least one of minValue or maxValue must remain set" }); return; }
  if (finalMin != null && finalMax != null && Number(finalMin) > Number(finalMax)) {
    res.status(400).json({ error: "minValue must be <= maxValue" }); return;
  }
  if (finalTarget != null) {
    if (finalMin != null && Number(finalTarget) < Number(finalMin)) { res.status(400).json({ error: "targetValue must be >= minValue" }); return; }
    if (finalMax != null && Number(finalTarget) > Number(finalMax)) { res.status(400).json({ error: "targetValue must be <= maxValue" }); return; }
  }

  const [updated] = await db.update(commodityQualitySpecsTable).set(patch).where(eq(commodityQualitySpecsTable.id, specId)).returning();
  await audit("commodity_quality_spec", specId, "commodity_quality_spec.update", req.authedUser, existing, updated);
  res.json(updated);
});

router.delete("/commodity-quality-specs/:specId", requirePermission("commodities.quality.write"), async (req: AuthedRequest, res) => {
  const { specId } = req.params;
  if (!isUuid(specId)) { res.status(400).json({ error: "Invalid specId" }); return; }
  const [existing] = await db.select().from(commodityQualitySpecsTable).where(eq(commodityQualitySpecsTable.id, specId));
  if (!existing) { res.status(404).json({ error: "Spec not found" }); return; }
  // Soft-archive by default — preserves audit and prior sample test references.
  // Pass ?hard=true to actually delete (only if no sample has used this spec yet).
  if (req.query.hard === "true") {
    await db.delete(commodityQualitySpecsTable).where(eq(commodityQualitySpecsTable.id, specId));
    await audit("commodity_quality_spec", specId, "commodity_quality_spec.delete", req.authedUser, existing, null);
  } else {
    const [updated] = await db.update(commodityQualitySpecsTable)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(commodityQualitySpecsTable.id, specId)).returning();
    await audit("commodity_quality_spec", specId, "commodity_quality_spec.archive", req.authedUser, existing, updated);
  }
  res.status(204).end();
});

// Evaluate a measured value against the active spec for a single parameter — useful for the
// Sampling Module's out-of-range detector and the QC pricing-adjustment formula.
router.get("/commodity-types/:typeId/quality-specs/:parameterCode/evaluate", requirePermission("commodities.read"), async (req, res) => {
  const { typeId, parameterCode } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const value = Number(req.query.value);
  if (!Number.isFinite(value)) { res.status(400).json({ error: "value must be numeric" }); return; }
  const stage = typeof req.query.stage === "string" ? req.query.stage : null;
  if (stage && !SAMPLE_STAGES.has(stage)) { res.status(400).json({ error: `stage must be one of ${[...SAMPLE_STAGES].join("|")}` }); return; }
  const today = new Date().toISOString().slice(0, 10);

  // Pull every active candidate ordered newest-first, then stage-filter, then take the latest.
  // Same ordering as /active to keep results consistent for sampling.
  const candidates = await db.select().from(commodityQualitySpecsTable)
    .where(and(
      eq(commodityQualitySpecsTable.commodityTypeId, typeId),
      eq(commodityQualitySpecsTable.parameterCode, parameterCode),
      eq(commodityQualitySpecsTable.status, "active"),
      lte(commodityQualitySpecsTable.effectiveDate, today),
    ))
    .orderBy(desc(commodityQualitySpecsTable.effectiveDate), desc(commodityQualitySpecsTable.version));

  const stageFiltered = stage
    ? candidates.filter(s => {
        const stages = Array.isArray(s.appliesAtStages) ? s.appliesAtStages as string[] : null;
        return !stages || stages.length === 0 || stages.includes(stage);
      })
    : candidates;
  const spec = stageFiltered[0];
  if (!spec) { res.status(404).json({ error: stage ? `No active spec for this parameter at stage '${stage}'` : "No active spec for this parameter" }); return; }

  const min = spec.minValue != null ? Number(spec.minValue) : null;
  const max = spec.maxValue != null ? Number(spec.maxValue) : null;
  const target = spec.targetValue != null ? Number(spec.targetValue) : null;
  const belowMin = min != null && value < min;
  const aboveMax = max != null && value > max;
  const inRange = !belowMin && !aboveMax;
  const deviationFromTarget = target != null ? value - target : null;
  res.json({
    parameterCode: spec.parameterCode,
    parameterName: spec.parameterName,
    unit: spec.unit,
    value, min, max, target,
    inRange, belowMin, aboveMax,
    deviationFromTarget,
    affectsPrice: spec.affectsPrice,
    mandatory: spec.mandatory,
    specId: spec.id, specVersion: spec.version, specEffectiveDate: spec.effectiveDate,
  });
});

// =============== SAMPLING CONFIGURATIONS ===============

const SAMPLING_METHODS = new Set(["grab", "composite", "incremental"]);
const FREQUENCY_RULES = new Set(["per_batch", "per_kg", "per_truck"]);

router.get("/commodity-types/:typeId/sampling-configs", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const rows = await db.select().from(samplingConfigsTable)
    .where(eq(samplingConfigsTable.commodityTypeId, typeId))
    .orderBy(samplingConfigsTable.stage);
  res.json(rows);
});

router.post("/commodity-types/:typeId/sampling-configs", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const [type] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (!type) { res.status(404).json({ error: "Commodity type not found" }); return; }

  const { stage, isMandatory, samplingMethod, frequencyRule, frequencyValue, minSamples, maxSamples, requiresLabTest, autoBlockIfMissing, allowOverride, notes } = req.body ?? {};
  if (!SAMPLE_STAGES.has(stage)) { res.status(400).json({ error: `stage must be one of ${[...SAMPLE_STAGES].join("|")}` }); return; }
  if (!SAMPLING_METHODS.has(samplingMethod)) { res.status(400).json({ error: `samplingMethod must be one of ${[...SAMPLING_METHODS].join("|")}` }); return; }
  if (!FREQUENCY_RULES.has(frequencyRule)) { res.status(400).json({ error: `frequencyRule must be one of ${[...FREQUENCY_RULES].join("|")}` }); return; }
  if (frequencyRule === "per_kg" && (frequencyValue == null || !Number.isFinite(Number(frequencyValue)) || Number(frequencyValue) <= 0)) {
    res.status(400).json({ error: "frequencyValue (kg) is required and must be > 0 when frequencyRule = per_kg" }); return;
  }
  const minS = Number(minSamples ?? 1);
  if (!Number.isInteger(minS) || minS < 1) { res.status(400).json({ error: "minSamples must be an integer >= 1" }); return; }
  const maxS = maxSamples == null || maxSamples === "" ? null : Number(maxSamples);
  if (maxS != null && (!Number.isInteger(maxS) || maxS < minS)) { res.status(400).json({ error: "maxSamples must be an integer >= minSamples" }); return; }

  const [created] = await db.insert(samplingConfigsTable).values({
    commodityTypeId: typeId,
    stage,
    isMandatory: !!isMandatory,
    samplingMethod,
    frequencyRule,
    frequencyValue: frequencyRule === "per_kg" ? String(Number(frequencyValue)) : null,
    minSamples: minS,
    maxSamples: maxS,
    requiresLabTest: !!requiresLabTest,
    autoBlockIfMissing: !!autoBlockIfMissing,
    allowOverride: !!allowOverride,
    notes: notes ?? null,
    createdById: req.authedUser?.id ?? null,
  }).returning();
  await audit("sampling_config", created.id, "sampling_config.create", req.authedUser, null, created);
  res.status(201).json(created);
});

router.patch("/sampling-configs/:configId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { configId } = req.params;
  if (!isUuid(configId)) { res.status(400).json({ error: "Invalid configId" }); return; }
  const [existing] = await db.select().from(samplingConfigsTable).where(eq(samplingConfigsTable.id, configId));
  if (!existing) { res.status(404).json({ error: "Sampling config not found" }); return; }

  const patch: any = { updatedAt: new Date() };
  const { stage, isMandatory, samplingMethod, frequencyRule, frequencyValue, minSamples, maxSamples, requiresLabTest, autoBlockIfMissing, allowOverride, status, notes } = req.body ?? {};
  if (stage !== undefined) {
    if (!SAMPLE_STAGES.has(stage)) { res.status(400).json({ error: "Invalid stage" }); return; }
    patch.stage = stage;
  }
  if (samplingMethod !== undefined) {
    if (!SAMPLING_METHODS.has(samplingMethod)) { res.status(400).json({ error: "Invalid samplingMethod" }); return; }
    patch.samplingMethod = samplingMethod;
  }
  if (frequencyRule !== undefined) {
    if (!FREQUENCY_RULES.has(frequencyRule)) { res.status(400).json({ error: "Invalid frequencyRule" }); return; }
    patch.frequencyRule = frequencyRule;
  }
  const effRule = patch.frequencyRule ?? existing.frequencyRule;
  if (frequencyValue !== undefined) {
    if (frequencyValue == null || frequencyValue === "") {
      patch.frequencyValue = null;
    } else {
      const v = Number(frequencyValue);
      if (!Number.isFinite(v) || v <= 0) { res.status(400).json({ error: "frequencyValue must be > 0" }); return; }
      patch.frequencyValue = String(v);
    }
  }
  if (effRule === "per_kg" && (patch.frequencyValue ?? existing.frequencyValue) == null) {
    res.status(400).json({ error: "frequencyValue (kg) is required when frequencyRule = per_kg" }); return;
  }
  if (isMandatory !== undefined) patch.isMandatory = !!isMandatory;
  if (requiresLabTest !== undefined) patch.requiresLabTest = !!requiresLabTest;
  if (autoBlockIfMissing !== undefined) patch.autoBlockIfMissing = !!autoBlockIfMissing;
  if (allowOverride !== undefined) patch.allowOverride = !!allowOverride;
  if (minSamples !== undefined) {
    const v = Number(minSamples);
    if (!Number.isInteger(v) || v < 1) { res.status(400).json({ error: "minSamples must be an integer >= 1" }); return; }
    patch.minSamples = v;
  }
  if (maxSamples !== undefined) {
    if (maxSamples == null || maxSamples === "") {
      patch.maxSamples = null;
    } else {
      const v = Number(maxSamples);
      const minRef = patch.minSamples ?? existing.minSamples;
      if (!Number.isInteger(v) || v < minRef) { res.status(400).json({ error: "maxSamples must be an integer >= minSamples" }); return; }
      patch.maxSamples = v;
    }
  }
  if (status !== undefined) {
    if (!["active", "inactive"].includes(status)) { res.status(400).json({ error: "status must be active|inactive" }); return; }
    patch.status = status;
  }
  if (notes !== undefined) patch.notes = notes ?? null;

  const [updated] = await db.update(samplingConfigsTable).set(patch).where(eq(samplingConfigsTable.id, configId)).returning();
  await audit("sampling_config", updated.id, "sampling_config.update", req.authedUser, existing, updated);
  res.json(updated);
});

router.delete("/sampling-configs/:configId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { configId } = req.params;
  if (!isUuid(configId)) { res.status(400).json({ error: "Invalid configId" }); return; }
  const [existing] = await db.select().from(samplingConfigsTable).where(eq(samplingConfigsTable.id, configId));
  if (!existing) { res.status(404).json({ error: "Sampling config not found" }); return; }
  await db.delete(samplingConfigsTable).where(eq(samplingConfigsTable.id, configId));
  await audit("sampling_config", configId, "sampling_config.delete", req.authedUser, existing, null);
  res.status(204).end();
});

export default router;

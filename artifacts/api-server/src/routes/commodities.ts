import { Router, type IRouter } from "express";
import { eq, and, desc, sql, lte, isNull, or } from "drizzle-orm";
import {
  db,
  commoditiesTable,
  commodityTypesTable,
  commodityPricesTable,
  commodityConversionsTable,
  auditLogsTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

async function audit(entityType: string, entityId: string, action: string, user: any, before: any, after: any) {
  await db.insert(auditLogsTable).values({
    entityType, entityId, action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    before, after,
  });
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
  const { name, code, description, status } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  if (typeof code !== "string" || !code.trim()) { res.status(400).json({ error: "code required" }); return; }
  const normCode = code.trim().toLowerCase();

  const [dup] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.code, normCode));
  if (dup) { res.status(409).json({ error: "Commodity code already exists" }); return; }

  const [created] = await db.insert(commoditiesTable).values({
    name: name.trim(),
    code: normCode,
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
  const { name, description, status } = req.body ?? {};
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
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
  const rows = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.commodityId, commodityId)).orderBy(commodityTypesTable.name);
  res.json(rows);
});

router.post("/api/commodities/:commodityId/types", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { commodityId } = req.params;
  if (!isUuid(commodityId)) { res.status(400).json({ error: "Invalid commodityId" }); return; }
  const [parent] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.id, commodityId));
  if (!parent) { res.status(404).json({ error: "Commodity not found" }); return; }

  const { name, code, defaultUnit, defaultForm, harvestSeasonStartMonth, harvestSeasonEndMonth, status } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  if (typeof code !== "string" || !code.trim()) { res.status(400).json({ error: "code required" }); return; }
  const normCode = code.trim().toLowerCase();

  const validMonth = (m: any) => m == null || (Number.isInteger(m) && m >= 1 && m <= 12);
  if (!validMonth(harvestSeasonStartMonth) || !validMonth(harvestSeasonEndMonth)) {
    res.status(400).json({ error: "harvestSeason months must be integers 1-12" }); return;
  }

  const [dup] = await db.select().from(commodityTypesTable).where(and(eq(commodityTypesTable.commodityId, commodityId), eq(commodityTypesTable.code, normCode)));
  if (dup) { res.status(409).json({ error: "Type code already exists for this commodity" }); return; }

  const [created] = await db.insert(commodityTypesTable).values({
    commodityId,
    name: name.trim(),
    code: normCode,
    defaultUnit: defaultUnit?.toString().trim() || "kg",
    defaultForm: defaultForm?.toString().trim() || null,
    harvestSeasonStartMonth: harvestSeasonStartMonth ?? null,
    harvestSeasonEndMonth: harvestSeasonEndMonth ?? null,
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
  const { name, defaultUnit, defaultForm, harvestSeasonStartMonth, harvestSeasonEndMonth, status } = req.body ?? {};
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  if (defaultUnit !== undefined) patch.defaultUnit = defaultUnit?.toString().trim() || "kg";
  if (defaultForm !== undefined) patch.defaultForm = defaultForm?.toString().trim() || null;
  const validMonth = (m: any) => m == null || (Number.isInteger(m) && m >= 1 && m <= 12);
  if (harvestSeasonStartMonth !== undefined) {
    if (!validMonth(harvestSeasonStartMonth)) { res.status(400).json({ error: "Invalid harvestSeasonStartMonth" }); return; }
    patch.harvestSeasonStartMonth = harvestSeasonStartMonth;
  }
  if (harvestSeasonEndMonth !== undefined) {
    if (!validMonth(harvestSeasonEndMonth)) { res.status(400).json({ error: "Invalid harvestSeasonEndMonth" }); return; }
    patch.harvestSeasonEndMonth = harvestSeasonEndMonth;
  }
  if (status === "active" || status === "inactive") patch.status = status;

  const [updated] = await db.update(commodityTypesTable).set(patch).where(eq(commodityTypesTable.id, typeId)).returning();
  await audit("commodity_type", typeId, "commodity_type.update", req.authedUser, existing, updated);
  res.json(updated);
});

// =============== PRICES ===============

// Resolve current prices: for each (typeId, regionId|null, form|null) the latest effectiveDate <= today.
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
  const form = typeof req.query.form === "string" && req.query.form.trim() ? req.query.form.trim().toLowerCase() : null;
  const today = new Date().toISOString().slice(0, 10);

  // Try region-specific first; fall back to national (regionId IS NULL).
  const tryFetch = async (rid: string | null) => {
    const conds = [eq(commodityPricesTable.commodityTypeId, typeId), lte(commodityPricesTable.effectiveDate, today)];
    conds.push(rid ? eq(commodityPricesTable.regionId, rid) : isNull(commodityPricesTable.regionId));
    if (form) conds.push(eq(commodityPricesTable.form, form));
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

  const { regionId, form, pricePerKg, currency, effectiveDate, source, notes } = req.body ?? {};
  const price = Number(pricePerKg);
  if (!Number.isFinite(price) || price <= 0) { res.status(400).json({ error: "pricePerKg must be a positive number" }); return; }
  if (typeof effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    res.status(400).json({ error: "effectiveDate must be YYYY-MM-DD" }); return;
  }
  // Calendar-validate (rejects 2026-02-31 etc.).
  const dt = new Date(`${effectiveDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== effectiveDate) {
    res.status(400).json({ error: "effectiveDate is not a valid calendar date" }); return;
  }
  if (regionId != null && !isUuid(regionId)) { res.status(400).json({ error: "Invalid regionId" }); return; }
  const normalizedForm = form?.toString().trim().toLowerCase() || type.defaultForm?.toLowerCase() || null;

  try {
    const [created] = await db.insert(commodityPricesTable).values({
      commodityTypeId: typeId,
      regionId: regionId ?? null,
      form: normalizedForm,
      pricePerKg: price.toString(),
      currency: (currency ?? "UGX").toString().toUpperCase().slice(0, 8),
      effectiveDate,
      source: source ?? null,
      notes: notes ?? null,
      createdById: req.authedUser?.id ?? null,
    }).returning();
    await audit("commodity_price", created.id, "commodity_price.create", req.authedUser, null, created);
    res.status(201).json(created);
  } catch (e: any) {
    if (e?.code === "23505") {
      res.status(409).json({ error: "A price for this commodity type, region, form, currency and date already exists" });
      return;
    }
    throw e;
  }
});

// =============== CONVERSIONS ===============

router.get("/api/commodity-types/:typeId/conversions", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const rows = await db.select().from(commodityConversionsTable).where(eq(commodityConversionsTable.commodityTypeId, typeId));
  res.json(rows);
});

router.post("/api/commodity-types/:typeId/conversions", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const [type] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (!type) { res.status(404).json({ error: "Commodity type not found" }); return; }

  const { fromForm, toForm, ratio, notes } = req.body ?? {};
  if (typeof fromForm !== "string" || !fromForm.trim()) { res.status(400).json({ error: "fromForm required" }); return; }
  if (typeof toForm !== "string" || !toForm.trim()) { res.status(400).json({ error: "toForm required" }); return; }
  const fF = fromForm.trim().toLowerCase();
  const tF = toForm.trim().toLowerCase();
  if (fF === tF) { res.status(400).json({ error: "fromForm and toForm must differ" }); return; }
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) { res.status(400).json({ error: "ratio must be a positive number" }); return; }

  const [dup] = await db.select().from(commodityConversionsTable).where(and(
    eq(commodityConversionsTable.commodityTypeId, typeId),
    eq(commodityConversionsTable.fromForm, fF),
    eq(commodityConversionsTable.toForm, tF),
  ));
  if (dup) { res.status(409).json({ error: "Conversion for this from→to pair already exists" }); return; }

  const [created] = await db.insert(commodityConversionsTable).values({
    commodityTypeId: typeId, fromForm: fF, toForm: tF, ratio: r.toString(), notes: notes ?? null,
  }).returning();
  await audit("commodity_conversion", created.id, "commodity_conversion.create", req.authedUser, null, created);
  res.status(201).json(created);
});

router.patch("/api/commodity-conversions/:conversionId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { conversionId } = req.params;
  if (!isUuid(conversionId)) { res.status(400).json({ error: "Invalid conversionId" }); return; }
  const [existing] = await db.select().from(commodityConversionsTable).where(eq(commodityConversionsTable.id, conversionId));
  if (!existing) { res.status(404).json({ error: "Conversion not found" }); return; }

  const { ratio, notes } = req.body ?? {};
  const patch: any = { updatedAt: new Date() };
  if (ratio !== undefined) {
    const r = Number(ratio);
    if (!Number.isFinite(r) || r <= 0) { res.status(400).json({ error: "ratio must be positive" }); return; }
    patch.ratio = r.toString();
  }
  if (notes !== undefined) patch.notes = notes;

  const [updated] = await db.update(commodityConversionsTable).set(patch).where(eq(commodityConversionsTable.id, conversionId)).returning();
  await audit("commodity_conversion", conversionId, "commodity_conversion.update", req.authedUser, existing, updated);
  res.json(updated);
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

// On-the-fly conversion calculator. e.g. ?fromForm=cherry&toForm=green_bean&quantity=100
router.get("/api/commodity-types/:typeId/convert", requirePermission("commodities.read"), async (req, res) => {
  const { typeId } = req.params;
  if (!isUuid(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
  const fromForm = String(req.query.fromForm ?? "").trim().toLowerCase();
  const toForm = String(req.query.toForm ?? "").trim().toLowerCase();
  const qty = Number(req.query.quantity);
  if (!fromForm || !toForm) { res.status(400).json({ error: "fromForm and toForm required" }); return; }
  if (!Number.isFinite(qty) || qty < 0) { res.status(400).json({ error: "quantity must be a non-negative number" }); return; }

  const [direct] = await db.select().from(commodityConversionsTable).where(and(
    eq(commodityConversionsTable.commodityTypeId, typeId),
    eq(commodityConversionsTable.fromForm, fromForm),
    eq(commodityConversionsTable.toForm, toForm),
  ));
  if (direct) {
    const ratio = Number(direct.ratio);
    res.json({ fromForm, toForm, quantity: qty, ratio, result: qty * ratio, source: "direct" });
    return;
  }
  // Try inverse.
  const [inv] = await db.select().from(commodityConversionsTable).where(and(
    eq(commodityConversionsTable.commodityTypeId, typeId),
    eq(commodityConversionsTable.fromForm, toForm),
    eq(commodityConversionsTable.toForm, fromForm),
  ));
  if (inv) {
    const ratio = 1 / Number(inv.ratio);
    res.json({ fromForm, toForm, quantity: qty, ratio, result: qty * ratio, source: "inverse" });
    return;
  }
  res.status(404).json({ error: "No conversion defined between these forms" });
});

export default router;

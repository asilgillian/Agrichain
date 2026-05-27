import { Router } from "express";
import { db } from "@workspace/db";
import {
  loanCategoriesTable,
  loanProductsTable,
  loanProductItemsTable,
} from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();

// =================================================================================================
// Param helpers — every :id/:itemId/loanCategoryId is validated to avoid letting bad UUIDs reach
// Postgres (which would otherwise raise a 500 from an invalid UUID cast).
// =================================================================================================
const uuidSchema = z.string().uuid();
function parseUuid(value: unknown): string | null {
  const r = uuidSchema.safeParse(value);
  return r.success ? r.data : null;
}

// =================================================================================================
// Loan Categories
// =================================================================================================
const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});
const updateCategorySchema = createCategorySchema.partial();

router.get("/loan-categories", requirePermission("loans.read"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(loanCategoriesTable).orderBy(asc(loanCategoriesTable.name));
  res.json(rows);
});

router.post("/loan-categories", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  try {
    const [row] = await db.insert(loanCategoriesTable).values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isActive: parsed.data.isActive ?? true,
    }).returning();
    res.status(201).json(row);
  } catch (e: any) {
    if (String(e?.message ?? "").includes("loan_categories_name_uniq")) {
      res.status(409).json({ error: "A loan category with that name already exists" }); return;
    }
    throw e;
  }
});

router.patch("/loan-categories/:id", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updateCategorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  try {
    const [row] = await db.update(loanCategoriesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(loanCategoriesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Loan category not found" }); return; }
    res.json(row);
  } catch (e: any) {
    if (String(e?.message ?? "").includes("loan_categories_name_uniq")) {
      res.status(409).json({ error: "A loan category with that name already exists" }); return;
    }
    throw e;
  }
});

router.delete("/loan-categories/:id", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  // Refuse deletion when products exist; admin should deactivate instead.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(loanProductsTable).where(eq(loanProductsTable.loanCategoryId, id));
  if ((count ?? 0) > 0) {
    res.status(409).json({ error: "Cannot delete: products exist under this category. Deactivate instead." });
    return;
  }
  const [row] = await db.delete(loanCategoriesTable).where(eq(loanCategoriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Loan category not found" }); return; }
  res.status(204).end();
});

// =================================================================================================
// Loan Products
// =================================================================================================
const interestTypeSchema = z.enum(["flat", "reducing", "none"]);
const repaymentMethodSchema = z.enum(["auto_deduct", "manual", "hybrid"]);
const productTypeSchema = z.enum(["INPUT", "CASH"]);

const createProductSchema = z.object({
  loanCategoryId: z.string().uuid(),
  name: z.string().min(1).max(160),
  commodityTypeId: z.string().uuid().optional().nullable(),
  // INPUT = in-kind package with a fixed price baked into the product (operator
  // selects product, principal auto-fills + locks). CASH = operator-entered
  // principal (credit-limit gating comes later).
  productType: productTypeSchema.optional(),
  defaultPrincipal: z.number().min(0).optional().nullable(),
  interestType: interestTypeSchema.optional(),
  interestRate: z.number().min(0).max(1000).optional(),
  penaltyRate: z.number().min(0).max(1000).optional(),
  gracePeriodDays: z.number().int().min(0).max(3650).optional(),
  maxAmount: z.number().min(0).optional().nullable(),
  maxRestructures: z.number().int().min(0).max(50).optional(),
  repaymentMethod: repaymentMethodSchema.optional(),
  recoveryPriority: z.number().int().min(0).max(10_000).optional(),
  allowPartialRepayment: z.boolean().optional(),
  allowFinanceOverride: z.boolean().optional(),
  seasonBased: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
const updateProductSchema = createProductSchema.partial();

router.get("/loan-products", requirePermission("loans.read"), async (req, res): Promise<void> => {
  const categoryIdRaw = req.query.loanCategoryId;
  let where = undefined;
  if (typeof categoryIdRaw === "string" && categoryIdRaw.length > 0) {
    const cid = parseUuid(categoryIdRaw);
    if (!cid) { res.status(400).json({ error: "Invalid loanCategoryId" }); return; }
    where = eq(loanProductsTable.loanCategoryId, cid);
  }
  const rows = await db.select().from(loanProductsTable).where(where).orderBy(desc(loanProductsTable.createdAt));
  res.json(rows);
});

router.get("/loan-products/:id", requirePermission("loans.read"), async (req, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(loanProductsTable).where(eq(loanProductsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Loan product not found" }); return; }
  const items = await db.select().from(loanProductItemsTable)
    .where(eq(loanProductItemsTable.loanProductId, id))
    .orderBy(asc(loanProductItemsTable.itemName));
  res.json({ ...row, items });
});

router.post("/loan-products", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;
  const productType = d.productType ?? "CASH";
  // INPUT products must carry their price — the whole point is operators don't
  // type a principal at loan-creation time.
  if (productType === "INPUT" && (!d.defaultPrincipal || d.defaultPrincipal <= 0)) {
    res.status(400).json({ error: "INPUT products require a defaultPrincipal greater than zero" }); return;
  }
  try {
    const [row] = await db.insert(loanProductsTable).values({
      loanCategoryId: d.loanCategoryId,
      name: d.name,
      commodityTypeId: d.commodityTypeId ?? null,
      productType,
      defaultPrincipal: d.defaultPrincipal != null ? String(d.defaultPrincipal) : null,
      interestType: d.interestType ?? "flat",
      interestRate: String(d.interestRate ?? 0),
      penaltyRate: String(d.penaltyRate ?? 0),
      gracePeriodDays: d.gracePeriodDays ?? 0,
      maxAmount: d.maxAmount != null ? String(d.maxAmount) : null,
      maxRestructures: d.maxRestructures ?? 0,
      repaymentMethod: d.repaymentMethod ?? "auto_deduct",
      recoveryPriority: d.recoveryPriority ?? 100,
      allowPartialRepayment: d.allowPartialRepayment ?? true,
      allowFinanceOverride: d.allowFinanceOverride ?? true,
      seasonBased: d.seasonBased ?? false,
      isActive: d.isActive ?? true,
    }).returning();
    res.status(201).json(row);
  } catch (e: any) {
    if (String(e?.message ?? "").includes("loan_products_category_name_uniq")) {
      res.status(409).json({ error: "A loan product with that name already exists in this category" }); return;
    }
    throw e;
  }
});

router.patch("/loan-products/:id", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (d.loanCategoryId !== undefined) update.loanCategoryId = d.loanCategoryId;
  if (d.name !== undefined) update.name = d.name;
  if (d.commodityTypeId !== undefined) update.commodityTypeId = d.commodityTypeId;
  if (d.productType !== undefined) update.productType = d.productType;
  if (d.defaultPrincipal !== undefined) update.defaultPrincipal = d.defaultPrincipal == null ? null : String(d.defaultPrincipal);
  if (d.interestType !== undefined) update.interestType = d.interestType;
  if (d.interestRate !== undefined) update.interestRate = String(d.interestRate);
  if (d.penaltyRate !== undefined) update.penaltyRate = String(d.penaltyRate);
  if (d.gracePeriodDays !== undefined) update.gracePeriodDays = d.gracePeriodDays;
  if (d.maxAmount !== undefined) update.maxAmount = d.maxAmount == null ? null : String(d.maxAmount);
  if (d.maxRestructures !== undefined) update.maxRestructures = d.maxRestructures;
  if (d.repaymentMethod !== undefined) update.repaymentMethod = d.repaymentMethod;
  if (d.recoveryPriority !== undefined) update.recoveryPriority = d.recoveryPriority;
  if (d.allowPartialRepayment !== undefined) update.allowPartialRepayment = d.allowPartialRepayment;
  if (d.allowFinanceOverride !== undefined) update.allowFinanceOverride = d.allowFinanceOverride;
  if (d.seasonBased !== undefined) update.seasonBased = d.seasonBased;
  if (d.isActive !== undefined) update.isActive = d.isActive;
  // Lock-read + invariant-check + write in one tx so two concurrent patches
  // can't end up with productType='INPUT' AND defaultPrincipal=null. Without
  // FOR UPDATE, request A could read CASH/null, request B could flip type to
  // INPUT and add a price, then request A's write lands and wipes the price.
  try {
    const row = await db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT product_type, default_principal FROM loan_products WHERE id = ${id} FOR UPDATE
      `);
      const current = (locked.rows ?? locked)[0] as any;
      if (!current) return null;
      // Only revalidate when either field is in play in this patch.
      if (d.productType !== undefined || d.defaultPrincipal !== undefined) {
        const effectiveType = d.productType ?? current.product_type;
        const effectivePrincipal = d.defaultPrincipal !== undefined
          ? d.defaultPrincipal
          : (current.default_principal != null ? Number(current.default_principal) : null);
        if (effectiveType === "INPUT" && (effectivePrincipal == null || effectivePrincipal <= 0)) {
          throw Object.assign(new Error("INPUT products require a defaultPrincipal greater than zero"), { status: 400 });
        }
      }
      const [r] = await tx.update(loanProductsTable).set(update).where(eq(loanProductsTable.id, id)).returning();
      return r ?? null;
    });
    if (!row) { res.status(404).json({ error: "Loan product not found" }); return; }
    res.json(row);
  } catch (e: any) {
    if (e?.status) { res.status(e.status).json({ error: e.message }); return; }
    if (String(e?.message ?? "").includes("loan_products_category_name_uniq")) {
      res.status(409).json({ error: "A loan product with that name already exists in this category" }); return;
    }
    throw e;
  }
});

// Deletion cascades to loan_product_items (children are wholly owned by the product).
router.delete("/loan-products/:id", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(loanProductsTable).where(eq(loanProductsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Loan product not found" }); return; }
  res.status(204).end();
});

// =================================================================================================
// Loan Product Items (in-kind line items)
// =================================================================================================
const createItemSchema = z.object({
  itemName: z.string().min(1).max(160),
  unitPrice: z.number().min(0),
  inventoryItemId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});
const updateItemSchema = createItemSchema.partial();

router.post("/loan-products/:id/items", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  // Ensure parent exists
  const [parent] = await db.select({ id: loanProductsTable.id }).from(loanProductsTable)
    .where(eq(loanProductsTable.id, id)).limit(1);
  if (!parent) { res.status(404).json({ error: "Loan product not found" }); return; }
  const [row] = await db.insert(loanProductItemsTable).values({
    loanProductId: id,
    itemName: parsed.data.itemName,
    unitPrice: String(parsed.data.unitPrice),
    inventoryItemId: parsed.data.inventoryItemId ?? null,
    supplierId: parsed.data.supplierId ?? null,
    isActive: parsed.data.isActive ?? true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/loan-product-items/:itemId", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const itemId = parseUuid(req.params.itemId);
  if (!itemId) { res.status(400).json({ error: "Invalid itemId" }); return; }
  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (d.itemName !== undefined) update.itemName = d.itemName;
  if (d.unitPrice !== undefined) update.unitPrice = String(d.unitPrice);
  if (d.inventoryItemId !== undefined) update.inventoryItemId = d.inventoryItemId;
  if (d.supplierId !== undefined) update.supplierId = d.supplierId;
  if (d.isActive !== undefined) update.isActive = d.isActive;
  const [row] = await db.update(loanProductItemsTable).set(update)
    .where(eq(loanProductItemsTable.id, itemId)).returning();
  if (!row) { res.status(404).json({ error: "Loan product item not found" }); return; }
  res.json(row);
});

router.delete("/loan-product-items/:itemId", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const itemId = parseUuid(req.params.itemId);
  if (!itemId) { res.status(400).json({ error: "Invalid itemId" }); return; }
  const [row] = await db.delete(loanProductItemsTable)
    .where(eq(loanProductItemsTable.id, itemId)).returning();
  if (!row) { res.status(404).json({ error: "Loan product item not found" }); return; }
  res.status(204).end();
});

export default router;

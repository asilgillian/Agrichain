import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, assetsTable, usersTable } from "@workspace/db";
import { CreateAssetBody, AssignAssetBody, ReturnAssetBody, ListAssetsQueryParams } from "@workspace/api-zod";
import { toDbDate } from "../lib/dates";

const router: IRouter = Router();

function generateAssetCode(): string {
  return "AST" + Date.now().toString(36).toUpperCase();
}

router.get("/assets", async (req, res): Promise<void> => {
  const parsed = ListAssetsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, assignedTo } = parsed.data;
  const conditions: any[] = [];
  if (status) conditions.push(eq(assetsTable.status, status));
  if (assignedTo) conditions.push(eq(assetsTable.assignedToUserId, assignedTo));

  const assets = conditions.length > 0
    ? await db.select().from(assetsTable).where(and(...conditions)).orderBy(desc(assetsTable.createdAt))
    : await db.select().from(assetsTable).orderBy(desc(assetsTable.createdAt));

  const enriched = await Promise.all(assets.map(async (a) => {
    let assignedToName = null;
    if (a.assignedToUserId) {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, a.assignedToUserId));
      assignedToName = user ? `${user.firstName} ${user.lastName}` : null;
    }
    return {
      ...a,
      purchaseValue: parseFloat(a.purchaseValue ?? "0"),
      currentBookValue: a.currentBookValue ? parseFloat(a.currentBookValue) : null,
      assignedToName,
    };
  }));
  res.json(enriched);
});

router.post("/assets", async (req, res): Promise<void> => {
  const parsed = CreateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const assetCode = generateAssetCode();
  const [asset] = await db.insert(assetsTable).values({
    ...parsed.data,
    assetCode,
    purchaseDate: toDbDate(parsed.data.purchaseDate),
    purchaseValue: parsed.data.purchaseValue.toString(),
    currentBookValue: parsed.data.purchaseValue.toString(),
  }).returning();
  res.status(201).json({ ...asset, purchaseValue: parsed.data.purchaseValue, currentBookValue: parsed.data.purchaseValue, assignedToName: null });
});

router.get("/assets/:assetId", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId as string));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  let assignedToName = null;
  if (asset.assignedToUserId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, asset.assignedToUserId));
    assignedToName = user ? `${user.firstName} ${user.lastName}` : null;
  }
  res.json({
    ...asset,
    purchaseValue: parseFloat(asset.purchaseValue ?? "0"),
    currentBookValue: asset.currentBookValue ? parseFloat(asset.currentBookValue) : null,
    assignedToName,
    assignmentHistory: (asset.assignmentHistory as any[]) ?? [],
  });
});

router.post("/assets/:assetId/assign", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const parsed = AssignAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId as string));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  const history = ((asset.assignmentHistory as any[]) ?? []).concat([{
    userId: parsed.data.userId,
    assignedAt: new Date().toISOString(),
    conditionAtHandover: parsed.data.conditionAtHandover,
  }]);
  const [updated] = await db.update(assetsTable).set({
    assignedToUserId: parsed.data.userId,
    status: "assigned",
    assignmentHistory: history,
    updatedAt: new Date(),
  }).where(eq(assetsTable.id, assetId as string)).returning();
  res.json({ ...updated, purchaseValue: parseFloat(updated.purchaseValue ?? "0"), currentBookValue: null, assignedToName: null });
});

router.post("/assets/:assetId/return", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const parsed = ReturnAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId as string));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  const history = ((asset.assignmentHistory as any[]) ?? []);
  if (history.length > 0) history[history.length - 1].returnedAt = new Date().toISOString();
  const [updated] = await db.update(assetsTable).set({
    assignedToUserId: null,
    status: "available",
    assignmentHistory: history,
    updatedAt: new Date(),
  }).where(eq(assetsTable.id, assetId as string)).returning();
  res.json({ ...updated, purchaseValue: parseFloat(updated.purchaseValue ?? "0"), currentBookValue: null, assignedToName: null });
});

export default router;

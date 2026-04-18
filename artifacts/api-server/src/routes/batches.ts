import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, batchesTable, usersTable } from "@workspace/db";
import { CreateBatchBody, ListBatchesQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

function generateBatchTag(): string {
  return "B" + Date.now().toString(36).toUpperCase();
}

router.get("/batches", async (req, res): Promise<void> => {
  const parsed = ListBatchesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { agentId, status } = parsed.data;
  const conditions: any[] = [];
  if (agentId) conditions.push(eq(batchesTable.agentId, agentId));
  if (status) conditions.push(eq(batchesTable.status, status));

  const batches = conditions.length > 0
    ? await db.select().from(batchesTable).where(and(...conditions)).orderBy(desc(batchesTable.createdAt))
    : await db.select().from(batchesTable).orderBy(desc(batchesTable.createdAt));

  res.json(batches.map(b => ({
    ...b,
    totalWeightKg: parseFloat(b.totalWeightKg ?? "0"),
    agentName: "Field Agent",
  })));
});

router.post("/batches", async (req, res): Promise<void> => {
  const parsed = CreateBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const batchTag = generateBatchTag();
  const agentId = req.body.agentId ?? "00000000-0000-0000-0000-000000000001";
  const [batch] = await db.insert(batchesTable).values({ ...parsed.data, batchTag, agentId }).returning();
  res.status(201).json({ ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"), agentName: "Field Agent" });
});

router.get("/batches/:batchId", async (req, res): Promise<void> => {
  const { batchId } = req.params;
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId as string));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json({
    ...batch,
    totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"),
    agentName: "Field Agent",
    farmerContributions: (batch.farmerContributions as any[]) ?? [],
  });
});

router.post("/batches/:batchId/lock", async (req, res): Promise<void> => {
  const { batchId } = req.params;
  const [batch] = await db.update(batchesTable)
    .set({ status: "locked", updatedAt: new Date() })
    .where(eq(batchesTable.id, batchId as string))
    .returning();
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json({ ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"), agentName: "Field Agent" });
});

export default router;

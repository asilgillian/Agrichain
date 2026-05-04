import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, batchesTable } from "@workspace/db";
import { CreateBatchBody, ListBatchesQueryParams } from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { checkFarmersStageForTxn } from "../lib/transaction-access";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateBatchTag(): string {
  return "B" + Date.now().toString(36).toUpperCase();
}

router.get("/batches", requirePermission("procurement.read"), async (req, res): Promise<void> => {
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

router.post("/batches", requirePermission("procurement.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const batchTag = generateBatchTag();
  // Always derive agentId from the authed user — never trust client-supplied agentId
  const agentId = req.authedUser!.id;

  // Validate optional body fields that aren't in CreateBatchBody (codegen drift workaround)
  const rawGroupId = req.body.groupId;
  let groupId: string | null = null;
  if (rawGroupId != null) {
    if (typeof rawGroupId !== "string" || !UUID_RE.test(rawGroupId)) {
      res.status(400).json({ error: "groupId must be a UUID" }); return;
    }
    groupId = rawGroupId;
  }

  let farmerCount = 0;
  if (req.body.farmerCount != null) {
    const n = Number(req.body.farmerCount);
    if (!Number.isInteger(n) || n < 0 || n > 100000) {
      res.status(400).json({ error: "farmerCount must be a non-negative integer" }); return;
    }
    farmerCount = n;
  }

  let farmerContributions: any[] = [];
  if (req.body.farmerContributions != null) {
    if (!Array.isArray(req.body.farmerContributions)) {
      res.status(400).json({ error: "farmerContributions must be an array" }); return;
    }
    farmerContributions = req.body.farmerContributions;
  }

  // Admin-controlled gate: every contributing farmer must meet the
  // registration-stage rule for "delivery" (batches are this codebase's
  // farmer-level delivery aggregation primitive).
  const contributingFarmerIds = Array.from(
    new Set(
      farmerContributions
        .map((c: any) => (c && typeof c === "object" ? c.farmerId : null))
        .filter((id: unknown): id is string => typeof id === "string" && UUID_RE.test(id)),
    ),
  );
  if (contributingFarmerIds.length > 0) {
    const denial = await checkFarmersStageForTxn(contributingFarmerIds, "delivery");
    if (denial) { res.status(denial.status).json(denial.body); return; }
  }

  let qualifyingStreams: string[] = [];
  if (req.body.qualifyingStreams != null) {
    if (!Array.isArray(req.body.qualifyingStreams) || !req.body.qualifyingStreams.every((s: unknown) => typeof s === "string")) {
      res.status(400).json({ error: "qualifyingStreams must be an array of strings" }); return;
    }
    qualifyingStreams = req.body.qualifyingStreams;
  }

  const [batch] = await db.insert(batchesTable).values({
    ...parsed.data, batchTag, agentId, groupId, farmerCount, farmerContributions, qualifyingStreams,
  }).returning();
  res.status(201).json({ ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"), agentName: "Field Agent" });
});

router.get("/batches/:batchId", requirePermission("procurement.read"), async (req, res): Promise<void> => {
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

router.post("/batches/:batchId/lock", requirePermission("procurement.write"), async (req, res): Promise<void> => {
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

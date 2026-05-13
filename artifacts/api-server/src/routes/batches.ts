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
    const raw = req.body.farmerContributions as any[];
    // Strict per-entry validation. Anything missing a uuid farmerId or a
    // finite non-negative weightKg is a 400 — silently dropping invalid rows
    // would let a caller skew the multi-farmer payment split.
    if (!raw.every(c => c && typeof c === "object" && typeof c.farmerId === "string" && UUID_RE.test(c.farmerId) && Number.isFinite(Number(c.weightKg)) && Number(c.weightKg) >= 0)) {
      res.status(400).json({ error: "farmerContributions entries must be { farmerId: uuid, weightKg: number>=0 }" }); return;
    }
    // Canonicalize UUIDs to lowercase BEFORE dedup; otherwise the same logical
    // farmer in mixed case would slip through and inflate the split divisor.
    for (const c of raw) c.farmerId = c.farmerId.toLowerCase();
    // Reject duplicate farmerIds outright.
    const seen = new Set<string>();
    for (const c of raw) {
      if (seen.has(c.farmerId)) {
        res.status(400).json({ error: `Duplicate farmerId in farmerContributions: ${c.farmerId}` }); return;
      }
      seen.add(c.farmerId);
    }
    farmerContributions = raw;
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

// PATCH lets a field agent edit an OPEN batch's contributions / weight before
// locking. Permission-gated; locked or delivered batches are immutable here so
// downstream lot/QC math stays trustworthy.
router.patch("/batches/:batchId", requirePermission("procurement.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { batchId } = req.params;
  const userId = req.authedUser?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Pre-validate the patch payload BEFORE we hit the DB, so we can return
  // crisp 400s. Ownership + open-status checks happen atomically in the
  // UPDATE's WHERE clause to avoid TOCTOU races with /lock.
  const patch: Record<string, unknown> = {};
  if (Array.isArray(req.body.farmerContributions)) {
    const contribs = req.body.farmerContributions as any[];
    if (!contribs.every(c => c && typeof c === "object" && typeof c.farmerId === "string" && UUID_RE.test(c.farmerId) && Number.isFinite(Number(c.weightKg)) && Number(c.weightKg) >= 0)) {
      res.status(400).json({ error: "farmerContributions entries must be { farmerId: uuid, weightKg: number>=0 }" }); return;
    }
    // Canonicalize before dedup (see POST /batches).
    for (const c of contribs) c.farmerId = c.farmerId.toLowerCase();
    // Reject duplicate farmerIds — see POST /batches for rationale (split-divisor
    // attack via repeated rows).
    const seen = new Set<string>();
    for (const c of contribs) {
      if (seen.has(c.farmerId)) {
        res.status(400).json({ error: `Duplicate farmerId in farmerContributions: ${c.farmerId}` }); return;
      }
      seen.add(c.farmerId);
    }
    const denial = await checkFarmersStageForTxn(Array.from(seen), "delivery");
    if (denial) { res.status(denial.status).json(denial.body); return; }
    patch.farmerContributions = contribs;
    patch.farmerCount = seen.size;
    patch.totalWeightKg = String(contribs.reduce((s, c) => s + Number(c.weightKg || 0), 0));
  }
  if (typeof req.body.commodityType === "string") patch.commodityType = req.body.commodityType;
  if (typeof req.body.cropType === "string") patch.cropType = req.body.cropType;
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No editable fields supplied" }); return; }
  patch.updatedAt = new Date();

  // Atomic guarded UPDATE — ownership AND open-status are part of the WHERE.
  // If a concurrent /lock fires between two of our PATCH calls, this update
  // matches zero rows and we report 409.
  const updated = await db.update(batchesTable)
    .set(patch as any)
    .where(and(
      eq(batchesTable.id, batchId as string),
      eq(batchesTable.status, "open"),
      eq(batchesTable.agentId, userId),
    ))
    .returning();
  if (updated.length === 0) {
    // Distinguish the cases for a useful error.
    const [existing] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId as string));
    if (!existing) { res.status(404).json({ error: "Batch not found" }); return; }
    if (existing.agentId !== userId) { res.status(403).json({ error: "You do not own this batch" }); return; }
    res.status(409).json({ error: `Batch is not open (status: ${existing.status})` }); return;
  }
  const batch = updated[0];
  res.json({ ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"), agentName: "Field Agent" });
});

router.post("/batches/:batchId/lock", requirePermission("procurement.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { batchId } = req.params;
  const userId = req.authedUser?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  // Atomic guarded transition: only the owning agent may lock, and only while
  // the batch is still open. Mirrors the PATCH guard so concurrent edits
  // can't race past authorization or re-lock a closed batch.
  const updated = await db.update(batchesTable)
    .set({ status: "locked", updatedAt: new Date() })
    .where(and(
      eq(batchesTable.id, batchId as string),
      eq(batchesTable.status, "open"),
      eq(batchesTable.agentId, userId),
    ))
    .returning();
  if (updated.length === 0) {
    const [existing] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId as string));
    if (!existing) { res.status(404).json({ error: "Batch not found" }); return; }
    if (existing.agentId !== userId) { res.status(403).json({ error: "You do not own this batch" }); return; }
    res.status(409).json({ error: `Batch is not open (status: ${existing.status})` }); return;
  }
  const batch = updated[0];
  res.json({ ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"), agentName: "Field Agent" });
});

export default router;

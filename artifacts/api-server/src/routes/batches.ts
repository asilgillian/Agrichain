import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray, isNull } from "drizzle-orm";
import { db, batchesTable, deliveriesTable } from "@workspace/db";
import { ListBatchesQueryParams } from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { checkFarmersStageForTxn } from "../lib/transaction-access";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateBatchTag(): string {
  // System-generated batch number, e.g. B-20260513-XXXX. The trailing chunk
  // uses a base36 timestamp slice so concurrent batches in the same second
  // don't collide on the unique index.
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const tail = Date.now().toString(36).slice(-5).toUpperCase();
  return `B-${ymd}-${tail}`;
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

// LEGACY route. The platform is now delivery-first: agents capture per-farmer
// deliveries via POST /procurement/deliveries (mobile), then group selected
// captured deliveries into a batch via POST /batches/from-deliveries. Direct
// batch creation with farmerContributions is no longer supported.
router.post("/batches", requirePermission("procurement.write"), async (_req, res): Promise<void> => {
  res.status(410).json({
    error: "POST /batches is deprecated. Capture deliveries first, then group with POST /batches/from-deliveries.",
  });
});

// NEW: group captured deliveries into a batch.
// Body: { deliveryIds: string[], harvestDate?: string, groupId?: string }
// Server validates: every id exists, every delivery is unbatched
// (status=captured AND batch_id IS NULL), and ALL deliveries share the same
// cropType. The batch's cropType, farmerCount, totalWeightKg, qualifyingStreams
// and agentId are derived server-side — clients can't spoof them.
router.post("/batches/from-deliveries", requirePermission("procurement.write"), async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.authedUser?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rawIds = req.body?.deliveryIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    res.status(400).json({ error: "deliveryIds must be a non-empty array of UUIDs" }); return;
  }
  const deliveryIds = Array.from(new Set(rawIds.map(s => typeof s === "string" ? s.toLowerCase() : "")));
  if (!deliveryIds.every(id => UUID_RE.test(id))) {
    res.status(400).json({ error: "deliveryIds must all be UUIDs" }); return;
  }

  let groupId: string | null = null;
  if (req.body?.groupId != null) {
    if (typeof req.body.groupId !== "string" || !UUID_RE.test(req.body.groupId)) {
      res.status(400).json({ error: "groupId must be a UUID" }); return;
    }
    groupId = req.body.groupId;
  }

  let harvestDate: string;
  if (typeof req.body?.harvestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.harvestDate)) {
    harvestDate = req.body.harvestDate;
  } else {
    const d = new Date();
    harvestDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  // Pre-check farmer stage gate BEFORE opening the tx — saves us from rolling
  // back the batch insert if any farmer fails the registration-stage rule.
  const preFarmerIds = Array.from(new Set(
    (await db.select({ farmerId: deliveriesTable.farmerId })
      .from(deliveriesTable)
      .where(inArray(deliveriesTable.id, deliveryIds))
    ).map(r => r.farmerId).filter((id): id is string => id !== null)
  ));
  if (preFarmerIds.length > 0) {
    const denial = await checkFarmersStageForTxn(preFarmerIds, "delivery");
    if (denial) { res.status(denial.status).json(denial.body); return; }
  }

  const result = await db.transaction(async (tx) => {
    // Re-read deliveries inside the tx and lock implicitly via the guarded
    // UPDATE below. Validate existence + unbatched + same-crop here.
    const rows = await tx.select().from(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
    if (rows.length !== deliveryIds.length) {
      const found = new Set(rows.map(r => r.id));
      const missing = deliveryIds.filter(id => !found.has(id));
      return { status: 404, body: { error: "One or more deliveries not found", missing } } as const;
    }
    const notCaptured = rows.filter(r => r.status !== "captured" || r.batchId !== null);
    if (notCaptured.length > 0) {
      return { status: 409, body: { error: "All deliveries must be unbatched (status=captured)", offending: notCaptured.map(r => ({ id: r.id, status: r.status, batchId: r.batchId })) } } as const;
    }
    const crops = new Set(rows.map(r => r.cropType));
    if (crops.size !== 1) {
      return { status: 400, body: { error: "All deliveries in a batch must share the same cropType", crops: [...crops] } } as const;
    }
    const cropType = rows[0]!.cropType;
    const totalWeightKg = rows.reduce((s, r) => s + Number(r.capturedWeightKg ?? 0), 0);
    const farmerCount = new Set(rows.map(r => r.farmerId)).size;
    const qualifyingStreams = Array.from(new Set(rows.flatMap(r => r.qualifyingStreams ?? [])));

    const batchTag = generateBatchTag();
    const [batch] = await tx.insert(batchesTable).values({
      batchTag, agentId: userId, groupId, cropType,
      totalWeightKg: String(totalWeightKg),
      farmerCount,
      qualifyingStreams,
      status: "open",
      harvestDate,
      farmerContributions: [],
    }).returning();

    // Atomic guarded UPDATE: only flip deliveries that are still captured AND
    // unbatched. If a concurrent /from-deliveries grabbed any of them first,
    // we'll see a row-count mismatch and roll back.
    const updated = await tx.update(deliveriesTable)
      .set({ batchId: batch.id, status: "pending_weight_submit", updatedAt: new Date() })
      .where(and(
        inArray(deliveriesTable.id, deliveryIds),
        eq(deliveriesTable.status, "captured"),
        isNull(deliveriesTable.batchId),
      ))
      .returning({ id: deliveriesTable.id });
    if (updated.length !== deliveryIds.length) {
      throw Object.assign(new Error("CONCURRENT_BATCH"), { code: "CONCURRENT_BATCH" });
    }
    return { status: 201, body: { ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"), agentName: "Field Agent", deliveryIds } } as const;
  }).catch(err => {
    if (err && (err as any).code === "CONCURRENT_BATCH") {
      return { status: 409, body: { error: "One or more deliveries were concurrently batched by another request" } } as const;
    }
    throw err;
  });

  res.status(result.status).json(result.body);
});

router.get("/batches/:batchId", requirePermission("procurement.read"), async (req, res): Promise<void> => {
  const { batchId } = req.params;
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId as string));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  // Surface the per-farmer deliveries that compose this batch (replaces the
  // legacy farmerContributions jsonb column for the new flow).
  const deliveries = await db.select().from(deliveriesTable)
    .where(eq(deliveriesTable.batchId, batchId as string))
    .orderBy(desc(deliveriesTable.createdAt));
  res.json({
    ...batch,
    totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"),
    agentName: "Field Agent",
    deliveries: deliveries.map(d => ({
      id: d.id,
      deliveryNumber: d.deliveryNumber,
      farmerId: d.farmerId,
      cropType: d.cropType,
      capturedWeightKg: parseFloat(d.capturedWeightKg ?? "0"),
      status: d.status,
    })),
  });
});

// Remove a delivery from an OPEN batch. The delivery returns to 'captured'
// and can be regrouped. Locked/delivered batches are immutable.
router.delete("/batches/:batchId/deliveries/:deliveryId", requirePermission("procurement.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { batchId, deliveryId } = req.params;
  const userId = req.authedUser?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!UUID_RE.test(batchId as string) || !UUID_RE.test(deliveryId as string)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }

  const result = await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batchesTable).where(eq(batchesTable.id, batchId as string));
    if (!batch) return { status: 404, body: { error: "Batch not found" } } as const;
    if (batch.agentId !== userId) return { status: 403, body: { error: "You do not own this batch" } } as const;
    if (batch.status !== "open") return { status: 409, body: { error: `Batch is not open (status: ${batch.status})` } } as const;

    // Atomic guarded unlink.
    const updated = await tx.update(deliveriesTable)
      .set({ batchId: null, status: "captured", updatedAt: new Date() })
      .where(and(
        eq(deliveriesTable.id, deliveryId as string),
        eq(deliveriesTable.batchId, batchId as string),
      ))
      .returning({ id: deliveriesTable.id, capturedWeightKg: deliveriesTable.capturedWeightKg, farmerId: deliveriesTable.farmerId });
    if (updated.length === 0) {
      return { status: 404, body: { error: "Delivery not in this batch" } } as const;
    }

    // Recompute aggregates from remaining rows.
    const [agg] = await tx.select({
      total: sql<string>`COALESCE(SUM(${deliveriesTable.capturedWeightKg}), 0)::text`,
      farmers: sql<number>`COUNT(DISTINCT ${deliveriesTable.farmerId})::int`,
    }).from(deliveriesTable).where(eq(deliveriesTable.batchId, batchId as string));
    const remaining = agg?.farmers ?? 0;
    if (remaining === 0) {
      // Removing the last delivery dissolves the batch — otherwise we'd leave
      // an empty "ghost batch" sitting on the agent's open list forever.
      await tx.delete(batchesTable).where(eq(batchesTable.id, batchId as string));
      return { status: 200, body: { ok: true, batchDissolved: true } } as const;
    }
    await tx.update(batchesTable)
      .set({ totalWeightKg: agg?.total ?? "0", farmerCount: remaining, updatedAt: new Date() })
      .where(eq(batchesTable.id, batchId as string));
    return { status: 200, body: { ok: true } } as const;
  });
  res.status(result.status).json(result.body);
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

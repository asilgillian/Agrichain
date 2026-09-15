import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  silosTable,
  siloBatchesTable,
  siloBatchProcessesTable,
  gradingRunsTable,
  auditLogsTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const BATCH_STATUSES = new Set(["OPEN", "PROCESSING", "CLOSED"]);

async function audit(entityType: string, entityId: string, action: string, user: any, before: any, after: any) {
  await db.insert(auditLogsTable).values({
    entityType, entityId, action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    before, after,
  });
}

// Batch-number generator: SB-YYYYMMDD-XXXXX. Per-day monotonic counter derived from the highest
// existing suffix for that day (NOT the row count — deletions would make a count-based suffix
// collide with surviving higher-numbered batches and never resolve on retry).
// Race-tolerant via the unique constraint + retry inside the create handler.
async function generateBatchNumber(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `SB-${today}-`;
  const [{ maxSuffix }] = await db
    .select({ maxSuffix: sql<number>`coalesce(max(right(${siloBatchesTable.batchNumber}, 5)::int), 0)` })
    .from(siloBatchesTable)
    .where(sql`${siloBatchesTable.batchNumber} LIKE ${prefix + "%"}`);
  return `${prefix}${String(Number(maxSuffix) + 1).padStart(5, "0")}`;
}

// Sum the input weight already consumed by grading runs for a set of silo batches. Grading is the
// authoritative consumer of a batch's stock, so available = batch.inputWeightKg − Σ run.inputWeightKg.
async function consumedByBatch(batchIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (batchIds.length === 0) return map;
  const rows = await db
    .select({
      siloBatchId: gradingRunsTable.siloBatchId,
      consumed: sql<string>`coalesce(sum(${gradingRunsTable.inputWeightKg}), 0)`,
    })
    .from(gradingRunsTable)
    .where(inArray(gradingRunsTable.siloBatchId, batchIds))
    .groupBy(gradingRunsTable.siloBatchId);
  for (const r of rows) {
    if (r.siloBatchId) map.set(r.siloBatchId, Number(r.consumed) || 0);
  }
  return map;
}

// =============== SILOS ===============

router.get("/silos", requirePermission("warehouse.read"), async (req, res) => {
  const conds: any[] = [];
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status) conds.push(eq(silosTable.status, status));
  const rows = await db.select().from(silosTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(silosTable.name);
  res.json(rows);
});

router.post("/silos", requirePermission("warehouse.write"), async (req: AuthedRequest, res) => {
  const { name, stream, facilityId, commodityType, capacityKg, status } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  if (typeof stream !== "string" || !stream.trim()) { res.status(400).json({ error: "stream required" }); return; }
  let cap: string | null = null;
  if (capacityKg != null && capacityKg !== "") {
    const c = Number(capacityKg);
    if (!Number.isFinite(c) || c < 0) { res.status(400).json({ error: "capacityKg must be a non-negative number" }); return; }
    cap = c.toFixed(2);
  }
  const [created] = await db.insert(silosTable).values({
    name: name.trim(),
    stream: stream.trim(),
    facilityId: typeof facilityId === "string" && facilityId.trim() ? facilityId.trim() : null,
    commodityType: typeof commodityType === "string" && commodityType.trim() ? commodityType.trim() : null,
    capacityKg: cap,
    status: typeof status === "string" && status.trim() ? status.trim() : "ACTIVE",
  }).returning();
  await audit("silo", created.id, "silo.create", req.authedUser, null, created);
  res.status(201).json(created);
});

// =============== SILO BATCHES ===============

router.get("/silo-batches", requirePermission("warehouse.read"), async (req, res) => {
  const conds: any[] = [];
  const siloId = typeof req.query.siloId === "string" && isUuid(req.query.siloId) ? req.query.siloId : null;
  const status = typeof req.query.status === "string" && BATCH_STATUSES.has(req.query.status) ? req.query.status : null;
  if (siloId) conds.push(eq(siloBatchesTable.siloId, siloId));
  if (status) conds.push(eq(siloBatchesTable.status, status));

  const rows = await db
    .select({
      id: siloBatchesTable.id,
      batchNumber: siloBatchesTable.batchNumber,
      siloId: siloBatchesTable.siloId,
      siloName: silosTable.name,
      streams: siloBatchesTable.streams,
      status: siloBatchesTable.status,
      inputWeightKg: siloBatchesTable.inputWeightKg,
      outputWeightKg: siloBatchesTable.outputWeightKg,
      createdAt: siloBatchesTable.createdAt,
      closedAt: siloBatchesTable.closedAt,
    })
    .from(siloBatchesTable)
    .leftJoin(silosTable, eq(siloBatchesTable.siloId, silosTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(siloBatchesTable.createdAt));

  const consumed = await consumedByBatch(rows.map(r => r.id));
  const withAvail = rows.map(r => {
    const used = consumed.get(r.id) ?? 0;
    const avail = Math.max(0, Number(r.inputWeightKg) - used);
    return { ...r, consumedWeightKg: used.toFixed(2), availableWeightKg: avail.toFixed(2) };
  });
  res.json(withAvail);
});

router.get("/silo-batches/:id", requirePermission("warehouse.read"), async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select({
      id: siloBatchesTable.id,
      batchNumber: siloBatchesTable.batchNumber,
      siloId: siloBatchesTable.siloId,
      siloName: silosTable.name,
      streams: siloBatchesTable.streams,
      status: siloBatchesTable.status,
      inputWeightKg: siloBatchesTable.inputWeightKg,
      outputWeightKg: siloBatchesTable.outputWeightKg,
      createdAt: siloBatchesTable.createdAt,
      closedAt: siloBatchesTable.closedAt,
    })
    .from(siloBatchesTable)
    .leftJoin(silosTable, eq(siloBatchesTable.siloId, silosTable.id))
    .where(eq(siloBatchesTable.id, id));
  if (!row) { res.status(404).json({ error: "Silo batch not found" }); return; }
  const consumed = await consumedByBatch([row.id]);
  const used = consumed.get(row.id) ?? 0;
  const avail = Math.max(0, Number(row.inputWeightKg) - used);
  res.json({ ...row, consumedWeightKg: used.toFixed(2), availableWeightKg: avail.toFixed(2) });
});

router.post("/silo-batches", requirePermission("warehouse.write"), async (req: AuthedRequest, res) => {
  const { siloId, streams, inputWeightKg, status } = req.body ?? {};
  if (!isUuid(siloId)) { res.status(400).json({ error: "siloId required" }); return; }
  const input = Number(inputWeightKg);
  if (!Number.isFinite(input) || input <= 0) { res.status(400).json({ error: "inputWeightKg must be a positive number" }); return; }
  const st = typeof status === "string" && BATCH_STATUSES.has(status) ? status : "OPEN";

  const [silo] = await db.select().from(silosTable).where(eq(silosTable.id, siloId));
  if (!silo) { res.status(400).json({ error: "silo not found" }); return; }

  // Default the batch streams to the silo's stream if none supplied.
  let streamList: string[] | null = null;
  if (Array.isArray(streams)) {
    streamList = streams.filter((s: unknown) => typeof s === "string" && s.trim()).map((s: string) => s.trim());
  }
  if (!streamList || streamList.length === 0) streamList = silo.stream ? [silo.stream] : null;

  // Retry on batch-number unique violations so two agents saving at the same instant both succeed
  // with the regenerated number instead of surfacing a 500. Note: inside db.transaction() the pg
  // error code moves to e.cause (see .agents/memory/drizzle-tx-error-unwrap.md), so unwrap both levels.
  const MAX_BATCH_NUMBER_ATTEMPTS = 5;
  let created: any;
  for (let attempt = 0; attempt < MAX_BATCH_NUMBER_ATTEMPTS; attempt++) {
    const batchNumber = await generateBatchNumber();
    try {
      [created] = await db.insert(siloBatchesTable).values({
        batchNumber,
        siloId,
        streams: streamList,
        status: st,
        inputWeightKg: input.toFixed(2),
      }).returning();
      break;
    } catch (e: any) {
      const pgCode = e?.code ?? e?.cause?.code;
      const pgConstraint = e?.constraint ?? e?.cause?.constraint;
      const isBatchNumberCollision =
        pgCode === "23505" &&
        (String(pgConstraint ?? "").includes("batch_number") || String(e?.cause?.detail ?? e?.detail ?? "").includes("batch_number"));
      if (isBatchNumberCollision && attempt < MAX_BATCH_NUMBER_ATTEMPTS - 1) continue;
      throw e;
    }
  }
  if (!created) { res.status(500).json({ error: "Could not allocate a unique batch number, please retry" }); return; }

  await audit("silo_batch", created.id, "silo_batch.create", req.authedUser, null, created);
  res.status(201).json({ ...created, siloName: silo.name, consumedWeightKg: "0.00", availableWeightKg: input.toFixed(2) });
});

// =============== SILO BATCH PROCESSES (parallel quality + storage signoff) ===============
// Implements the locked decision "Parallel quality and warehouse signoffs" plus outturn
// deviation severity. The silo_batch_processes table already modeled this — qualitySignoff /
// warehouseSignoff columns, expectedOuturnPct / actualOuturnPct — but no route ever touched
// it, so it could never be populated. These endpoints are that missing wiring.
//
// "Parallel" means the two signoffs are independent: either can be recorded first, neither
// blocks the other, and a process is only complete once BOTH are APPROVED.

const SIGNOFF_DECISIONS = new Set(["APPROVED", "REJECTED"]);

// Default three-tier severity classification for outturn deviation (percentage points
// between expected and actual). This satisfies the "three severity levels" part of the
// locked decision; the "configurable" part still needs an admin-editable thresholds table
// (e.g. per commodity or process type) rather than these constants — flagging as a
// deliberate scope boundary for this pass, not an oversight.
function classifyOutturnSeverity(
  expectedPct: unknown,
  actualPct: unknown,
): "NORMAL" | "WARNING" | "CRITICAL" | null {
  const exp = expectedPct == null ? null : Number(expectedPct);
  const act = actualPct == null ? null : Number(actualPct);
  if (exp == null || act == null || !Number.isFinite(exp) || !Number.isFinite(act)) return null;
  const deviation = Math.abs(act - exp);
  if (deviation >= 5) return "CRITICAL";
  if (deviation >= 2) return "WARNING";
  return "NORMAL";
}

async function recordSignoff(
  processId: string,
  track: "quality" | "warehouse",
  decision: string,
  extra: { outputWeightKg?: unknown; actualOuturnPct?: unknown },
  user: any,
): Promise<{ error: string; status: number } | { row: any; severity: ReturnType<typeof classifyOutturnSeverity> }> {
  const [process] = await db.select().from(siloBatchProcessesTable).where(eq(siloBatchProcessesTable.id, processId));
  if (!process) return { error: "Process not found", status: 404 };

  const currentStatus = track === "quality" ? process.qualitySignoff : process.warehouseSignoff;
  if (currentStatus !== "PENDING") {
    return { error: `${track === "quality" ? "Quality" : "Storage"} signoff already ${currentStatus}`, status: 409 };
  }
  if (!SIGNOFF_DECISIONS.has(decision)) {
    return { error: "decision must be APPROVED or REJECTED", status: 400 };
  }

  const patch: Record<string, unknown> = track === "quality"
    ? { qualitySignoff: decision, qualitySignedById: user?.id ?? null, qualitySignedAt: new Date() }
    : { warehouseSignoff: decision, warehouseSignedById: user?.id ?? null, warehouseSignedAt: new Date() };

  if (extra.outputWeightKg != null && extra.outputWeightKg !== "") {
    const o = Number(extra.outputWeightKg);
    if (!Number.isFinite(o) || o < 0) return { error: "outputWeightKg must be a non-negative number", status: 400 };
    patch.outputWeightKg = o.toFixed(2);
  }
  if (extra.actualOuturnPct != null && extra.actualOuturnPct !== "") {
    const a = Number(extra.actualOuturnPct);
    if (!Number.isFinite(a) || a < 0 || a > 100) return { error: "actualOuturnPct must be between 0 and 100", status: 400 };
    patch.actualOuturnPct = a.toFixed(3);
  }

  let [updated] = await db.update(siloBatchProcessesTable).set(patch)
    .where(eq(siloBatchProcessesTable.id, processId)).returning();

  // Completion requires BOTH tracks approved — check after every signoff, from either side.
  if (updated.qualitySignoff === "APPROVED" && updated.warehouseSignoff === "APPROVED" && !updated.completedAt) {
    [updated] = await db.update(siloBatchProcessesTable).set({ completedAt: new Date() })
      .where(eq(siloBatchProcessesTable.id, processId)).returning();
  }

  await audit("silo_batch_process", processId, `silo_batch_process.${track}_signoff`, user, process, updated);
  return { row: updated, severity: classifyOutturnSeverity(updated.expectedOuturnPct, updated.actualOuturnPct) };
}

router.get("/silo-batches/:id/processes", requirePermission("warehouse.read"), async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(siloBatchProcessesTable)
    .where(eq(siloBatchProcessesTable.siloBatchId, id))
    .orderBy(desc(siloBatchProcessesTable.createdAt));
  res.json(rows.map(r => ({
    ...r,
    outturnSeverity: classifyOutturnSeverity(r.expectedOuturnPct, r.actualOuturnPct),
  })));
});

router.post("/silo-batches/:id/processes", requirePermission("warehouse.processing.write"), async (req: AuthedRequest, res) => {
  const { id: siloBatchId } = req.params;
  if (!isUuid(siloBatchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [batch] = await db.select().from(siloBatchesTable).where(eq(siloBatchesTable.id, siloBatchId));
  if (!batch) { res.status(404).json({ error: "Silo batch not found" }); return; }
  if (batch.status === "CLOSED") { res.status(409).json({ error: "Cannot start a process on a closed batch" }); return; }

  const { processName, inputWeightKg, expectedOuturnPct, parameters, photoUrls } = req.body ?? {};
  if (typeof processName !== "string" || !processName.trim()) { res.status(400).json({ error: "processName required" }); return; }
  const input = Number(inputWeightKg);
  if (!Number.isFinite(input) || input <= 0) { res.status(400).json({ error: "inputWeightKg must be a positive number" }); return; }

  let expOuturn: string | null = null;
  if (expectedOuturnPct != null && expectedOuturnPct !== "") {
    const e = Number(expectedOuturnPct);
    if (!Number.isFinite(e) || e < 0 || e > 100) { res.status(400).json({ error: "expectedOuturnPct must be between 0 and 100" }); return; }
    expOuturn = e.toFixed(3);
  }

  const [created] = await db.insert(siloBatchProcessesTable).values({
    siloBatchId,
    processName: processName.trim(),
    inputWeightKg: input.toFixed(2),
    expectedOuturnPct: expOuturn,
    parameters: parameters ?? null,
    photoUrls: Array.isArray(photoUrls) ? photoUrls.filter((u: unknown) => typeof u === "string") : null,
    startedAt: new Date(),
  }).returning();

  // A batch with its first process step in flight is no longer just sitting OPEN.
  if (batch.status === "OPEN") {
    await db.update(siloBatchesTable).set({ status: "PROCESSING" }).where(eq(siloBatchesTable.id, siloBatchId));
  }

  await audit("silo_batch_process", created.id, "silo_batch_process.create", req.authedUser, null, created);
  res.status(201).json({ ...created, outturnSeverity: null });
});

router.post(
  "/silo-batch-processes/:id/quality-signoff",
  requirePermission("warehouse.processing.quality_signoff"),
  async (req: AuthedRequest, res) => {
    const { id } = req.params;
    if (!isUuid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { decision, outputWeightKg, actualOuturnPct } = req.body ?? {};
    const result = await recordSignoff(id, "quality", decision, { outputWeightKg, actualOuturnPct }, req.authedUser);
    if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ ...result.row, outturnSeverity: result.severity });
  },
);

router.post(
  "/silo-batch-processes/:id/storage-signoff",
  requirePermission("warehouse.processing.storage_signoff"),
  async (req: AuthedRequest, res) => {
    const { id } = req.params;
    if (!isUuid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { decision, outputWeightKg, actualOuturnPct } = req.body ?? {};
    // Maps to the `warehouseSignoff` column — named "storage" in the URL to avoid
    // colliding with the generic warehouse.read/write permissions used elsewhere in
    // this file.
    const result = await recordSignoff(id, "warehouse", decision, { outputWeightKg, actualOuturnPct }, req.authedUser);
    if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ ...result.row, outturnSeverity: result.severity });
  },
);

export default router;

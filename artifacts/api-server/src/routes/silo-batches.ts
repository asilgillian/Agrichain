import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  silosTable,
  siloBatchesTable,
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

// Batch-number generator: SB-YYYYMMDD-XXXXX. Per-day monotonic counter derived from the existing
// row count for that day. Race-tolerant via the unique index + retry inside the create handler.
async function generateBatchNumber(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `SB-${today}-`;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(siloBatchesTable)
    .where(sql`${siloBatchesTable.batchNumber} LIKE ${prefix + "%"}`);
  return `${prefix}${String(Number(count) + 1).padStart(5, "0")}`;
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

  let created: any;
  let lastErr: any;
  for (let i = 0; i < 5; i++) {
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
      lastErr = e;
      const msg = String(e?.message || e?.cause?.message || "");
      if (msg.includes("silo_batches_batch_number") || msg.includes("batch_number")) continue;
      throw e;
    }
  }
  if (!created) throw lastErr ?? new Error("Failed to allocate batch number");

  await audit("silo_batch", created.id, "silo_batch.create", req.authedUser, null, created);
  res.status(201).json({ ...created, siloName: silo.name, consumedWeightKg: "0.00", availableWeightKg: input.toFixed(2) });
});

export default router;

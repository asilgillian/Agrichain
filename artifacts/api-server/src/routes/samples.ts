import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import {
  db,
  samplesTable,
  samplingConfigsTable,
  commodityTypesTable,
  auditLogsTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const SAMPLE_STAGES = new Set(["field", "pre_offload", "post_offload", "warehouse", "processing", "export"]);
const SAMPLING_METHODS = new Set(["grab", "composite", "incremental"]);
const LINKED_TYPES = new Set(["farmer", "batch", "lot", "silo_batch", "container"]);
const SAMPLE_STATUSES = new Set(["collected", "lab_pending", "completed", "rejected", "voided"]);

// Per-stage entity binding from the operational brief. Enforced server-side so a Field-stage
// sample cannot accidentally link to a Container, etc. Warehouse accepts both batch and lot
// because lots are sometimes still being assembled when sampled.
const STAGE_TO_LINKED: Record<string, string[]> = {
  field: ["farmer"],
  pre_offload: ["batch"],
  post_offload: ["lot", "batch"],
  warehouse: ["lot", "batch"],
  processing: ["silo_batch", "lot"],
  export: ["container"],
};

async function audit(entityType: string, entityId: string, action: string, user: any, before: any, after: any) {
  await db.insert(auditLogsTable).values({
    entityType, entityId, action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    before, after,
  });
}

// Sample-code generator: SMP-YYYY-NNNNNN. Uses a per-year monotonic counter derived from the
// existing row count to keep codes short and human-friendly. Race-tolerant via unique index +
// retry. We attempt up to 5 candidate codes before bailing.
async function generateSampleCode(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `SMP-${year}-`;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(samplesTable)
    .where(sql`${samplesTable.sampleCode} LIKE ${prefix + "%"}`);
  const start = Number(count) + 1;
  return `${prefix}${String(start).padStart(6, "0")}`;
}

// =================================================================================================
// LIST samples — supports filtering by commodityType, stage, linked entity, collector, status,
// date range. Returns most recent first. Always paginated (default 50, max 200).
// =================================================================================================
router.get("/samples", requirePermission("commodities.read"), async (req, res) => {
  const filters: any[] = [];
  const { commodityTypeId, stage, linkedEntityType, linkedEntityId, collectorId, status, from, to, code } = req.query as Record<string, string>;
  if (commodityTypeId && isUuid(commodityTypeId)) filters.push(eq(samplesTable.commodityTypeId, commodityTypeId));
  if (stage && SAMPLE_STAGES.has(stage)) filters.push(eq(samplesTable.stage, stage));
  if (linkedEntityType && LINKED_TYPES.has(linkedEntityType)) filters.push(eq(samplesTable.linkedEntityType, linkedEntityType));
  if (linkedEntityId) filters.push(eq(samplesTable.linkedEntityId, linkedEntityId));
  if (collectorId && isUuid(collectorId)) filters.push(eq(samplesTable.collectorId, collectorId));
  if (status && SAMPLE_STATUSES.has(status)) filters.push(eq(samplesTable.status, status));
  if (code) filters.push(eq(samplesTable.sampleCode, code));
  if (from) filters.push(gte(samplesTable.collectionDate, new Date(from)));
  if (to) filters.push(lte(samplesTable.collectionDate, new Date(to)));

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = filters.length ? and(...filters) : undefined;
  const rows = await db.select().from(samplesTable).where(where).orderBy(desc(samplesTable.collectionDate)).limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(samplesTable).where(where);
  res.json({ rows, total: Number(total), limit, offset });
});

// Lookup by sample code — used for QR-code scan workflows.
router.get("/samples/code/:code", requirePermission("commodities.read"), async (req, res) => {
  const [row] = await db.select().from(samplesTable).where(eq(samplesTable.sampleCode, req.params.code));
  if (!row) { res.status(404).json({ error: "Sample not found" }); return; }
  res.json(row);
});

router.get("/samples/:id", requirePermission("commodities.read"), async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!row) { res.status(404).json({ error: "Sample not found" }); return; }
  res.json(row);
});

// =================================================================================================
// CREATE sample — designed to be called either online (web UI) or replayed from an offline mobile
// queue. If clientGeneratedId is supplied and already exists, returns the existing row (idempotent
// replay) instead of creating a duplicate.
// =================================================================================================
router.post("/samples", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const {
    commodityTypeId,
    samplingConfigId,
    stage,
    linkedEntityType,
    linkedEntityId,
    samplingMethod,
    collectionDate,
    latitude,
    longitude,
    gpsAccuracyM,
    sampleWeightKg,
    subSampleCount,
    containerType,
    sealNumber,
    photoUrls,
    notes,
    clientGeneratedId,
    clientCreatedAt,
  } = req.body ?? {};

  // Idempotent replay — if the device already pushed this clientGeneratedId, return the
  // previously-created row unchanged. This is what makes offline sync safe to retry.
  if (clientGeneratedId && typeof clientGeneratedId === "string") {
    const [existing] = await db.select().from(samplesTable).where(eq(samplesTable.clientGeneratedId, clientGeneratedId));
    if (existing) { res.status(200).json(existing); return; }
  }

  if (!isUuid(commodityTypeId)) { res.status(400).json({ error: "commodityTypeId required" }); return; }
  if (!SAMPLE_STAGES.has(stage)) { res.status(400).json({ error: `stage must be one of ${[...SAMPLE_STAGES].join("|")}` }); return; }
  if (!LINKED_TYPES.has(linkedEntityType)) { res.status(400).json({ error: `linkedEntityType must be one of ${[...LINKED_TYPES].join("|")}` }); return; }
  // Enforce stage↔entity invariant so traceability chains stay coherent.
  const allowedLinks = STAGE_TO_LINKED[stage] ?? [];
  if (!allowedLinks.includes(linkedEntityType)) {
    res.status(400).json({ error: `Stage '${stage}' samples must link to one of: ${allowedLinks.join(", ")}` }); return;
  }
  if (!linkedEntityId || typeof linkedEntityId !== "string") { res.status(400).json({ error: "linkedEntityId required" }); return; }
  if (!SAMPLING_METHODS.has(samplingMethod)) { res.status(400).json({ error: `samplingMethod must be one of ${[...SAMPLING_METHODS].join("|")}` }); return; }
  if (!collectionDate || Number.isNaN(new Date(collectionDate).getTime())) {
    res.status(400).json({ error: "collectionDate required (ISO timestamp)" }); return;
  }

  // Verify commodityType exists.
  const [type] = await db.select().from(commodityTypesTable).where(eq(commodityTypesTable.id, commodityTypeId));
  if (!type) { res.status(400).json({ error: "commodityType not found" }); return; }

  // Snapshot the sampling config that was active at capture time. We persist BOTH a reference
  // (id + version) and a full JSON copy of the row, so historical samples remain interpretable
  // even if the config is later edited or deleted.
  let snapshotConfigId: string | null = null;
  let snapshotConfigVersion: number | null = null;
  let snapshotConfigJson: any = null;
  let cfgRow: any = null;
  if (samplingConfigId && isUuid(samplingConfigId)) {
    [cfgRow] = await db.select().from(samplingConfigsTable).where(eq(samplingConfigsTable.id, samplingConfigId));
  } else {
    [cfgRow] = await db.select().from(samplingConfigsTable)
      .where(and(eq(samplingConfigsTable.commodityTypeId, commodityTypeId), eq(samplingConfigsTable.stage, stage), eq(samplingConfigsTable.status, "active")));
  }
  if (cfgRow) {
    snapshotConfigId = cfgRow.id;
    snapshotConfigVersion = cfgRow.version ?? 1;
    snapshotConfigJson = cfgRow;
  }

  const lat = latitude != null && latitude !== "" ? Number(latitude) : null;
  const lng = longitude != null && longitude !== "" ? Number(longitude) : null;
  const acc = gpsAccuracyM != null && gpsAccuracyM !== "" ? Number(gpsAccuracyM) : null;
  const wt = sampleWeightKg != null && sampleWeightKg !== "" ? Number(sampleWeightKg) : null;
  const subN = Number.isInteger(subSampleCount) && subSampleCount > 0 ? subSampleCount : 1;
  const photos = Array.isArray(photoUrls) ? photoUrls.filter((u) => typeof u === "string" && u.trim()) : [];

  // Race-tolerant code generation: try up to 5 codes before giving up.
  let created;
  let lastErr: any;
  for (let i = 0; i < 5; i++) {
    const sampleCode = await generateSampleCode();
    try {
      [created] = await db.insert(samplesTable).values({
        sampleCode,
        commodityTypeId,
        samplingConfigId: snapshotConfigId,
        samplingConfigVersion: snapshotConfigVersion,
        samplingConfigSnapshot: snapshotConfigJson,
        stage,
        linkedEntityType,
        linkedEntityId,
        samplingMethod,
        collectionDate: new Date(collectionDate),
        latitude: lat != null ? lat.toString() : null,
        longitude: lng != null ? lng.toString() : null,
        gpsAccuracyM: acc != null ? acc.toString() : null,
        collectorId: req.authedUser?.id ?? null,
        sampleWeightKg: wt != null ? wt.toString() : null,
        subSampleCount: subN,
        containerType: containerType || null,
        sealNumber: sealNumber || null,
        photoUrls: photos,
        notes: notes || null,
        clientGeneratedId: clientGeneratedId || null,
        clientCreatedAt: clientCreatedAt ? new Date(clientCreatedAt) : null,
      }).returning();
      break;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || "");
      // Race winner on clientGeneratedId — fetch and return the row that won the insert race.
      // Makes offline retry safe even under concurrent device sync.
      if (msg.includes("samples_client_id_uniq") && clientGeneratedId) {
        const [existing] = await db.select().from(samplesTable).where(eq(samplesTable.clientGeneratedId, clientGeneratedId));
        if (existing) { res.status(200).json(existing); return; }
      }
      // Code collision — retry with the next sequence number.
      if (msg.includes("samples_code_uniq")) continue;
      throw e;
    }
  }
  if (!created) throw lastErr ?? new Error("Failed to allocate sample code");

  await audit("sample", created.id, "sample.create", req.authedUser, null, created);
  res.status(201).json(created);
});

// PATCH — used for status transitions (lab_pending → completed/rejected), adding lab notes,
// appending photos. Code, type, and link are immutable to preserve audit chain.
router.patch("/samples/:id", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { id } = req.params;
  if (!isUuid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Sample not found" }); return; }

  const { status, notes, photoUrls, sealNumber, containerType } = req.body ?? {};
  const patch: any = { updatedAt: new Date() };
  if (status !== undefined) {
    if (!SAMPLE_STATUSES.has(status)) { res.status(400).json({ error: "Invalid status" }); return; }
    patch.status = status;
  }
  if (notes !== undefined) patch.notes = notes ?? null;
  if (sealNumber !== undefined) patch.sealNumber = sealNumber ?? null;
  if (containerType !== undefined) patch.containerType = containerType ?? null;
  if (photoUrls !== undefined) {
    if (!Array.isArray(photoUrls)) { res.status(400).json({ error: "photoUrls must be array" }); return; }
    patch.photoUrls = photoUrls.filter((u) => typeof u === "string" && u.trim());
  }

  const [updated] = await db.update(samplesTable).set(patch).where(eq(samplesTable.id, id)).returning();
  await audit("sample", updated.id, "sample.update", req.authedUser, existing, updated);
  res.json(updated);
});

export default router;

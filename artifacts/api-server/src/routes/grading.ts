import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  gradingProfilesTable,
  gradingProfileOutputsTable,
  gradingRunsTable,
  gradingRunOutputsTable,
  commodityTypesTable,
  commodityStockMovementsTable,
  siloBatchesTable,
  auditLogsTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s;
}

async function audit(entityType: string, entityId: string, action: string, user: any, before: any, after: any) {
  await db.insert(auditLogsTable).values({
    entityType, entityId, action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    before, after,
  });
}

// Run-number generator: GRD-YYYYMMDD-XXXXX. Per-day monotonic counter derived from the existing
// row count for that day. Race-tolerant via the unique index + retry inside the create handler.
async function generateRunNumber(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `GRD-${today}-`;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gradingRunsTable)
    .where(sql`${gradingRunsTable.runNumber} LIKE ${prefix + "%"}`);
  return `${prefix}${String(Number(count) + 1).padStart(5, "0")}`;
}

// Validate + normalise a list of profile output rows. Returns the cleaned rows or an error string.
function normaliseOutputs(raw: any): { ok: true; rows: any[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "At least one output grade is required" };
  }
  const rows: any[] = [];
  for (let i = 0; i < raw.length; i++) {
    const o = raw[i] ?? {};
    const isSellable = o.isSellable !== false; // default true
    const exp = Number(o.expectedYieldPct);
    if (!Number.isFinite(exp) || exp < 0 || exp > 100) {
      return { ok: false, error: `Output #${i + 1}: expectedYieldPct must be between 0 and 100` };
    }
    const min = o.minYieldPct != null && o.minYieldPct !== "" ? Number(o.minYieldPct) : null;
    const max = o.maxYieldPct != null && o.maxYieldPct !== "" ? Number(o.maxYieldPct) : null;
    if (min != null && (!Number.isFinite(min) || min < 0 || min > 100)) return { ok: false, error: `Output #${i + 1}: minYieldPct invalid` };
    if (max != null && (!Number.isFinite(max) || max < 0 || max > 100)) return { ok: false, error: `Output #${i + 1}: maxYieldPct invalid` };
    if (min != null && max != null && min > max) return { ok: false, error: `Output #${i + 1}: minYieldPct must be <= maxYieldPct` };
    const outTypeId = o.outputCommodityTypeId;
    if (isSellable) {
      if (!isUuid(outTypeId)) return { ok: false, error: `Output #${i + 1}: sellable grades require a valid outputCommodityTypeId` };
    } else if (outTypeId != null && outTypeId !== "" && !isUuid(outTypeId)) {
      return { ok: false, error: `Output #${i + 1}: outputCommodityTypeId invalid` };
    }
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : null;
    if (!isSellable && !label && !isUuid(outTypeId)) {
      return { ok: false, error: `Output #${i + 1}: loss/byproduct rows need a label` };
    }
    rows.push({
      outputCommodityTypeId: isUuid(outTypeId) ? outTypeId : null,
      label,
      expectedYieldPct: exp,
      minYieldPct: min,
      maxYieldPct: max,
      isSellable,
      sortOrder: Number.isInteger(o.sortOrder) ? o.sortOrder : i,
    });
  }
  // Yield percentages must sum to ~100% (allow small float drift).
  const sum = rows.reduce((s, r) => s + r.expectedYieldPct, 0);
  if (Math.abs(sum - 100) > 0.5) {
    return { ok: false, error: `Expected yields must sum to ~100% (got ${sum.toFixed(2)}%)` };
  }
  return { ok: true, rows };
}

// Confirm every referenced output commodity type exists and shares the input type's commodity.
async function validateOutputTypes(inputTypeId: string, rows: any[]): Promise<string | null> {
  const typeIds = Array.from(new Set(rows.map(r => r.outputCommodityTypeId).filter(isUuid))) as string[];
  const allIds = Array.from(new Set([inputTypeId, ...typeIds]));
  const types = await db.select().from(commodityTypesTable).where(inArray(commodityTypesTable.id, allIds));
  const byId = new Map(types.map(t => [t.id, t]));
  const input = byId.get(inputTypeId);
  if (!input) return "input commodity type not found";
  for (const id of typeIds) {
    const t = byId.get(id);
    if (!t) return "one or more output commodity types not found";
    if (t.commodityId !== input.commodityId) return "all output grades must belong to the same commodity as the input";
  }
  return null;
}

async function loadProfileDetail(profileId: string) {
  const [profile] = await db.select().from(gradingProfilesTable).where(eq(gradingProfilesTable.id, profileId));
  if (!profile) return null;
  const outputs = await db.select().from(gradingProfileOutputsTable)
    .where(eq(gradingProfileOutputsTable.gradingProfileId, profileId))
    .orderBy(gradingProfileOutputsTable.sortOrder);
  return { ...profile, outputs };
}

// =============== GRADING PROFILES ===============

router.get("/grading-profiles", requirePermission("commodities.read"), async (req, res) => {
  const conds = [] as any[];
  const inputTypeId = typeof req.query.inputCommodityTypeId === "string" && isUuid(req.query.inputCommodityTypeId) ? req.query.inputCommodityTypeId : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const commodityId = typeof req.query.commodityId === "string" && isUuid(req.query.commodityId) ? req.query.commodityId : null;

  if (inputTypeId) conds.push(eq(gradingProfilesTable.inputCommodityTypeId, inputTypeId));
  if (status) conds.push(eq(gradingProfilesTable.status, status));
  if (commodityId) {
    const types = await db.select({ id: commodityTypesTable.id }).from(commodityTypesTable).where(eq(commodityTypesTable.commodityId, commodityId));
    const ids = types.map(t => t.id);
    if (ids.length === 0) { res.json([]); return; }
    conds.push(inArray(gradingProfilesTable.inputCommodityTypeId, ids));
  }
  const rows = await db.select().from(gradingProfilesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(gradingProfilesTable.effectiveDate));
  res.json(rows);
});

router.get("/grading-profiles/:profileId", requirePermission("commodities.read"), async (req, res) => {
  const { profileId } = req.params;
  if (!isUuid(profileId)) { res.status(400).json({ error: "Invalid profileId" }); return; }
  const detail = await loadProfileDetail(profileId);
  if (!detail) { res.status(404).json({ error: "Grading profile not found" }); return; }
  res.json(detail);
});

router.post("/grading-profiles", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { name, inputCommodityTypeId, status, effectiveDate, notes, outputs } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  if (!isUuid(inputCommodityTypeId)) { res.status(400).json({ error: "inputCommodityTypeId required" }); return; }
  const eff = effectiveDate || new Date().toISOString().slice(0, 10);
  if (!isCalendarDate(eff)) { res.status(400).json({ error: "effectiveDate must be valid YYYY-MM-DD" }); return; }
  const st = status === "inactive" ? "inactive" : "active";

  const norm = normaliseOutputs(outputs);
  if (!norm.ok) { res.status(400).json({ error: norm.error }); return; }
  const typeErr = await validateOutputTypes(inputCommodityTypeId, norm.rows);
  if (typeErr) { res.status(400).json({ error: typeErr }); return; }

  const created = await db.transaction(async (tx) => {
    const [profile] = await tx.insert(gradingProfilesTable).values({
      name: name.trim(),
      inputCommodityTypeId,
      status: st,
      effectiveDate: eff,
      notes: notes?.toString().trim() || null,
      createdById: req.authedUser?.id ?? null,
    }).returning();
    await tx.insert(gradingProfileOutputsTable).values(norm.rows.map(r => ({
      gradingProfileId: profile.id,
      outputCommodityTypeId: r.outputCommodityTypeId,
      label: r.label,
      expectedYieldPct: r.expectedYieldPct.toString(),
      minYieldPct: r.minYieldPct != null ? r.minYieldPct.toString() : null,
      maxYieldPct: r.maxYieldPct != null ? r.maxYieldPct.toString() : null,
      isSellable: r.isSellable,
      sortOrder: r.sortOrder,
    })));
    return profile;
  });
  await audit("grading_profile", created.id, "grading_profile.create", req.authedUser, null, created);
  const detail = await loadProfileDetail(created.id);
  res.status(201).json(detail);
});

router.patch("/grading-profiles/:profileId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { profileId } = req.params;
  if (!isUuid(profileId)) { res.status(400).json({ error: "Invalid profileId" }); return; }
  const [existing] = await db.select().from(gradingProfilesTable).where(eq(gradingProfilesTable.id, profileId));
  if (!existing) { res.status(404).json({ error: "Grading profile not found" }); return; }

  const { name, inputCommodityTypeId, status, effectiveDate, notes, outputs } = req.body ?? {};
  const patch: any = { updatedAt: new Date() };
  if (name != null) {
    if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name invalid" }); return; }
    patch.name = name.trim();
  }
  const nextInputType = isUuid(inputCommodityTypeId) ? inputCommodityTypeId : existing.inputCommodityTypeId;
  if (inputCommodityTypeId != null) {
    if (!isUuid(inputCommodityTypeId)) { res.status(400).json({ error: "inputCommodityTypeId invalid" }); return; }
    patch.inputCommodityTypeId = inputCommodityTypeId;
  }
  if (status != null) patch.status = status === "inactive" ? "inactive" : "active";
  if (effectiveDate != null) {
    if (!isCalendarDate(effectiveDate)) { res.status(400).json({ error: "effectiveDate must be valid YYYY-MM-DD" }); return; }
    patch.effectiveDate = effectiveDate;
  }
  if (notes !== undefined) patch.notes = notes?.toString().trim() || null;

  let norm: { ok: true; rows: any[] } | { ok: false; error: string } | null = null;
  if (outputs !== undefined && outputs !== null) {
    norm = normaliseOutputs(outputs);
    if (!norm.ok) { res.status(400).json({ error: norm.error }); return; }
    const typeErr = await validateOutputTypes(nextInputType, norm.rows);
    if (typeErr) { res.status(400).json({ error: typeErr }); return; }
  }

  await db.transaction(async (tx) => {
    await tx.update(gradingProfilesTable).set(patch).where(eq(gradingProfilesTable.id, profileId));
    if (norm && norm.ok) {
      await tx.delete(gradingProfileOutputsTable).where(eq(gradingProfileOutputsTable.gradingProfileId, profileId));
      await tx.insert(gradingProfileOutputsTable).values(norm.rows.map(r => ({
        gradingProfileId: profileId,
        outputCommodityTypeId: r.outputCommodityTypeId,
        label: r.label,
        expectedYieldPct: r.expectedYieldPct.toString(),
        minYieldPct: r.minYieldPct != null ? r.minYieldPct.toString() : null,
        maxYieldPct: r.maxYieldPct != null ? r.maxYieldPct.toString() : null,
        isSellable: r.isSellable,
        sortOrder: r.sortOrder,
      })));
    }
  });
  const detail = await loadProfileDetail(profileId);
  await audit("grading_profile", profileId, "grading_profile.update", req.authedUser, existing, detail);
  res.json(detail);
});

router.delete("/grading-profiles/:profileId", requirePermission("commodities.write"), async (req: AuthedRequest, res) => {
  const { profileId } = req.params;
  if (!isUuid(profileId)) { res.status(400).json({ error: "Invalid profileId" }); return; }
  const [existing] = await db.select().from(gradingProfilesTable).where(eq(gradingProfilesTable.id, profileId));
  if (!existing) { res.status(404).json({ error: "Grading profile not found" }); return; }
  const [run] = await db.select({ id: gradingRunsTable.id }).from(gradingRunsTable).where(eq(gradingRunsTable.gradingProfileId, profileId)).limit(1);
  if (run) { res.status(409).json({ error: "Cannot delete a profile that has grading runs; deactivate it instead" }); return; }
  await db.delete(gradingProfilesTable).where(eq(gradingProfilesTable.id, profileId));
  await audit("grading_profile", profileId, "grading_profile.delete", req.authedUser, existing, null);
  res.status(204).end();
});

// =============== GRADING RUNS ===============

router.get("/grading-runs", requirePermission("warehouse.read"), async (req, res) => {
  const conds = [] as any[];
  const profileId = typeof req.query.gradingProfileId === "string" && isUuid(req.query.gradingProfileId) ? req.query.gradingProfileId : null;
  const siloBatchId = typeof req.query.siloBatchId === "string" && isUuid(req.query.siloBatchId) ? req.query.siloBatchId : null;
  if (profileId) conds.push(eq(gradingRunsTable.gradingProfileId, profileId));
  if (siloBatchId) conds.push(eq(gradingRunsTable.siloBatchId, siloBatchId));
  const rows = await db
    .select({
      id: gradingRunsTable.id,
      runNumber: gradingRunsTable.runNumber,
      gradingProfileId: gradingRunsTable.gradingProfileId,
      siloBatchId: gradingRunsTable.siloBatchId,
      siloBatchNumber: siloBatchesTable.batchNumber,
      inputCommodityTypeId: gradingRunsTable.inputCommodityTypeId,
      inputWeightKg: gradingRunsTable.inputWeightKg,
      totalOutputKg: gradingRunsTable.totalOutputKg,
      lossKg: gradingRunsTable.lossKg,
      lossPct: gradingRunsTable.lossPct,
      status: gradingRunsTable.status,
      notes: gradingRunsTable.notes,
      runById: gradingRunsTable.runById,
      createdAt: gradingRunsTable.createdAt,
    })
    .from(gradingRunsTable)
    .leftJoin(siloBatchesTable, eq(gradingRunsTable.siloBatchId, siloBatchesTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(gradingRunsTable.createdAt));
  res.json(rows);
});

router.get("/grading-runs/:runId", requirePermission("warehouse.read"), async (req, res) => {
  const { runId } = req.params;
  if (!isUuid(runId)) { res.status(400).json({ error: "Invalid runId" }); return; }
  const [run] = await db.select().from(gradingRunsTable).where(eq(gradingRunsTable.id, runId));
  if (!run) { res.status(404).json({ error: "Grading run not found" }); return; }
  const outputs = await db.select().from(gradingRunOutputsTable).where(eq(gradingRunOutputsTable.gradingRunId, runId));
  const [profile] = await db.select({ name: gradingProfilesTable.name }).from(gradingProfilesTable).where(eq(gradingProfilesTable.id, run.gradingProfileId));
  res.json({ ...run, profileName: profile?.name ?? null, outputs });
});

router.post("/grading-runs", requirePermission("warehouse.write"), async (req: AuthedRequest, res) => {
  const { gradingProfileId, siloBatchId, inputWeightKg, notes, outputs } = req.body ?? {};
  if (!isUuid(gradingProfileId)) { res.status(400).json({ error: "gradingProfileId required" }); return; }
  const input = Number(inputWeightKg);
  if (!Number.isFinite(input) || input <= 0) { res.status(400).json({ error: "inputWeightKg must be a positive number" }); return; }
  if (!Array.isArray(outputs) || outputs.length === 0) { res.status(400).json({ error: "outputs required" }); return; }

  const detail = await loadProfileDetail(gradingProfileId);
  if (!detail) { res.status(404).json({ error: "Grading profile not found" }); return; }
  if (detail.status !== "active") { res.status(400).json({ error: "Grading profile is inactive" }); return; }

  const outputById = new Map(detail.outputs.map(o => [o.id, o]));
  const actualByOutputId = new Map<string, number>();
  for (const item of outputs) {
    const oid = item?.gradingProfileOutputId;
    if (!isUuid(oid) || !outputById.has(oid)) { res.status(400).json({ error: "Each output must reference a valid gradingProfileOutputId of this profile" }); return; }
    const w = Number(item.actualWeightKg);
    if (!Number.isFinite(w) || w < 0) { res.status(400).json({ error: "actualWeightKg must be a non-negative number" }); return; }
    actualByOutputId.set(oid, w);
  }

  const totalOutput = Array.from(actualByOutputId.values()).reduce((s, w) => s + w, 0);
  if (totalOutput - input > 0.01) {
    res.status(400).json({ error: `Sum of graded outputs (${totalOutput.toFixed(2)} kg) cannot exceed input (${input.toFixed(2)} kg)` });
    return;
  }
  const lossKg = Math.max(0, input - totalOutput);
  const lossPct = input > 0 ? (lossKg / input) * 100 : 0;

  const runNumber = await generateRunNumber();

  const created = await db.transaction(async (tx) => {
    const [run] = await tx.insert(gradingRunsTable).values({
      runNumber,
      gradingProfileId,
      siloBatchId: isUuid(siloBatchId) ? siloBatchId : null,
      inputCommodityTypeId: detail.inputCommodityTypeId,
      inputWeightKg: input.toFixed(2),
      totalOutputKg: totalOutput.toFixed(2),
      lossKg: lossKg.toFixed(2),
      lossPct: lossPct.toFixed(3),
      status: "completed",
      notes: notes?.toString().trim() || null,
      runById: req.authedUser?.id ?? null,
    }).returning();

    const runOutputs = detail.outputs.map(o => {
      const actual = actualByOutputId.get(o.id) ?? 0;
      const actualPct = input > 0 ? (actual / input) * 100 : 0;
      const expectedPct = Number(o.expectedYieldPct);
      return {
        gradingRunId: run.id,
        gradingProfileOutputId: o.id,
        outputCommodityTypeId: o.outputCommodityTypeId,
        label: o.label,
        isSellable: o.isSellable,
        expectedYieldPct: expectedPct.toFixed(3),
        actualWeightKg: actual.toFixed(2),
        actualYieldPct: actualPct.toFixed(3),
        variancePct: (actualPct - expectedPct).toFixed(3),
      };
    });
    const insertedOutputs = await tx.insert(gradingRunOutputsTable).values(runOutputs).returning();

    // Book graded coffee back into warehouse stock (real inventory rows in the commodity stock
    // ledger). Draw down the input commodity type by the input weight, then book each sellable
    // graded output as positive stock of its output commodity type. Loss/byproduct rows and
    // zero-weight outputs are excluded from sellable stock.
    const movements = [
      {
        commodityTypeId: detail.inputCommodityTypeId,
        weightKg: (-input).toFixed(2),
        movementType: "grading_input",
        gradingRunId: run.id,
        gradingRunOutputId: null as string | null,
        siloBatchId: isUuid(siloBatchId) ? siloBatchId : null,
        notes: `Input consumed by grading run ${run.runNumber}`,
        createdById: req.authedUser?.id ?? null,
      },
    ];
    for (const o of insertedOutputs) {
      const actual = Number(o.actualWeightKg);
      if (o.isSellable && isUuid(o.outputCommodityTypeId ?? undefined) && actual > 0) {
        movements.push({
          commodityTypeId: o.outputCommodityTypeId!,
          weightKg: actual.toFixed(2),
          movementType: "grading_output",
          gradingRunId: run.id,
          gradingRunOutputId: o.id,
          siloBatchId: isUuid(siloBatchId) ? siloBatchId : null,
          notes: `Graded ${o.label ?? "output"} from run ${run.runNumber}`,
          createdById: req.authedUser?.id ?? null,
        });
      }
    }
    await tx.insert(commodityStockMovementsTable).values(movements);
    return run;
  });

  await audit("grading_run", created.id, "grading_run.create", req.authedUser, null, created);
  const runOutputs = await db.select().from(gradingRunOutputsTable).where(eq(gradingRunOutputsTable.gradingRunId, created.id));
  res.status(201).json({ ...created, profileName: detail.name, outputs: runOutputs });
});

export default router;

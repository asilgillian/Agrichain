import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  deliveriesTable,
  batchesTable,
  auditLogsTable,
  procurementContractsTable,
  procurementWorkflowsTable,
  usersTable,
} from "@workspace/db";
import { resolveWorkflowForDelivery, getWorkflowStages, DEFAULT_STAGE_PERMISSION } from "./procurement-workflows";
import {
  CreateDeliveryBody,
  SubmitDeliveryWeightBody,
  SubmitDeliveryQcBody,
  ProposeDeliveryPricingBody,
  RejectDeliveryBody,
  ListDeliveriesQueryParams,
} from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

function generateLotTag(): string {
  return "L" + Date.now().toString(36).toUpperCase();
}

function determineGrade(moisture: number, defects: number, cupScore?: number): string {
  if (moisture > 13 || defects > 5) return "C";
  if (moisture > 11 || defects > 2) return "B";
  if (cupScore && cupScore >= 80) return "AA";
  return "A";
}

function num(v: string | null | undefined): number | null {
  return v != null ? parseFloat(v) : null;
}

async function userNameMap(ids: (string | null)[]): Promise<Record<string, string>> {
  const set = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!set.length) return {};
  const rows = await db.select().from(usersTable);
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (set.includes(r.id)) map[r.id] = `${r.firstName} ${r.lastName}`.trim();
  }
  return map;
}

function shapeDelivery(
  d: typeof deliveriesTable.$inferSelect,
  names: Record<string, string> = {},
) {
  return {
    ...d,
    grossWeightKg: num(d.grossWeightKg),
    tareWeightKg: num(d.tareWeightKg),
    netWeightKg: num(d.netWeightKg),
    weightVarianceKg: num(d.weightVarianceKg),
    moistureContent: num(d.moistureContent),
    defectCount: num(d.defectCount),
    cupScore: num(d.cupScore),
    pricePerKg: num(d.pricePerKg),
    totalValue: num(d.totalValue),
    floorPricePerKg: num(d.floorPricePerKg),
    weightSubmittedByName: d.weightSubmittedById ? names[d.weightSubmittedById] : undefined,
    weightApprovedByName: d.weightApprovedById ? names[d.weightApprovedById] : undefined,
    qcSubmittedByName: d.qcSubmittedById ? names[d.qcSubmittedById] : undefined,
    qcApprovedByName: d.qcApprovedById ? names[d.qcApprovedById] : undefined,
    pricingProposedByName: d.pricingProposedById ? names[d.pricingProposedById] : undefined,
    pricingApprovedByName: d.pricingApprovedById ? names[d.pricingApprovedById] : undefined,
    rejectionByName: d.rejectionById ? names[d.rejectionById] : undefined,
  };
}

// ---------- WORKFLOW ENGINE HELPERS ----------
//
// Each delivery is pinned to a workflow at creation. The workflow's stages list — ordered by
// orderIdx — defines the sequence of submit/approve/info actions that must happen. The delivery
// carries `currentStageOrder`, an integer that points at the row in that list whose action is
// currently expected. The legacy `status` column is still maintained as a human-readable label
// (pending_<stage>_<verb>, approved, rejected_*, etc.) so existing dashboards/filters keep working.

const STATUS_FOR_KIND: Record<string, string> = {
  WEIGHT_SUBMIT: "pending_weight_submit",
  WEIGHT_APPROVE: "pending_weight_approve",
  QC_SUBMIT: "pending_qc_submit",
  QC_APPROVE: "pending_qc_approve",
  PRICING_PROPOSE: "pending_pricing_propose",
  PRICING_APPROVE: "pending_pricing_approve",
  INFO_CHECKPOINT: "pending_info_checkpoint",
};

type StageLike = { id: string; orderIdx: number; isActive: boolean; stageKind: string; displayName: string };

// INFO_CHECKPOINT stages are informational landmarks — there is no completion endpoint, so the
// engine treats them as auto-pass and never parks a delivery on one. They still appear in the
// workflow for documentation/audit purposes.
const NON_GATING_KINDS = new Set(["INFO_CHECKPOINT"]);

// Find the next ACTIVE gating stage strictly after `currentOrder`. Returns null when finished.
function nextActiveStage<T extends StageLike>(stages: T[], currentOrder: number): T | null {
  return stages
    .filter((s) => s.isActive && !NON_GATING_KINDS.has(s.stageKind) && s.orderIdx > currentOrder)
    .sort((a, b) => a.orderIdx - b.orderIdx)[0] ?? null;
}

// Find the ACTIVE gating stage at exactly `currentOrder` (or skip forward over a deactivated/info row).
function activeStageAtOrAfter<T extends StageLike>(stages: T[], currentOrder: number): T | null {
  return stages
    .filter((s) => s.isActive && !NON_GATING_KINDS.has(s.stageKind) && s.orderIdx >= currentOrder)
    .sort((a, b) => a.orderIdx - b.orderIdx)[0] ?? null;
}

// Atomic state transition: UPDATE with status precondition + audit insert in a single transaction.
// Returns the updated row, or null when the precondition no longer holds (race lost).
//
// expectedStatus may be a single string OR an array of acceptable prior statuses (used by
// /resume which accepts both partial_rejection and rejected_escalate).
async function transition(
  deliveryId: string,
  expectedStatus: string | string[],
  patch: Partial<typeof deliveriesTable.$inferInsert>,
  user: AuthedRequest["authedUser"] | undefined,
  action: string,
  metadata: Record<string, unknown>,
): Promise<typeof deliveriesTable.$inferSelect | null> {
  return await db.transaction(async (tx) => {
    // Capture full BEFORE snapshot inside the txn so the audit row can reconstruct field-level
    // changes for any later forensic review or compliance audit.
    const [before] = await tx.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId));
    if (!before) return null;
    const statusGuard = Array.isArray(expectedStatus)
      ? inArray(deliveriesTable.status, expectedStatus)
      : eq(deliveriesTable.status, expectedStatus);
    const updated = await tx
      .update(deliveriesTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(deliveriesTable.id, deliveryId), statusGuard))
      .returning();
    if (updated.length === 0) return null;
    await tx.insert(auditLogsTable).values({
      entityType: "delivery",
      entityId: deliveryId,
      action,
      actorId: user?.id ?? "system",
      actorName: user?.email ?? "system",
      actorRole: user?.role ?? "system",
      before: { status: before.status, ...stripNoiseFromAudit(before) },
      after: { status: updated[0].status, ...stripNoiseFromAudit(updated[0]), _change: metadata },
    });
    return updated[0];
  });
}

// Drop high-noise / always-changing fields from the audit snapshot. We keep the business-meaningful
// columns so a reviewer can diff before vs. after in one glance without scrolling past timestamps.
function stripNoiseFromAudit(row: typeof deliveriesTable.$inferSelect) {
  const { id: _id, lotTag: _lt, createdAt: _ca, updatedAt: _ua, ...rest } = row;
  return rest;
}

// Helper for warnings written to the audit trail without changing delivery state.
async function writeAuditWarning(
  entityId: string,
  action: string,
  user: AuthedRequest["authedUser"] | undefined,
  payload: Record<string, unknown>,
) {
  await db.insert(auditLogsTable).values({
    entityType: "delivery",
    entityId,
    action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    after: { warning: true, ...payload },
  });
}

// ---------- LIST / GET / CREATE ----------

router.get("/procurement/deliveries", requirePermission("procurement.read"), async (req, res): Promise<void> => {
  const parsed = ListDeliveriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, stationId } = parsed.data;
  const conditions: any[] = [];
  if (status) conditions.push(eq(deliveriesTable.status, status));
  if (stationId) conditions.push(eq(deliveriesTable.stationId, stationId));
  const deliveries = conditions.length
    ? await db.select().from(deliveriesTable).where(and(...conditions)).orderBy(desc(deliveriesTable.createdAt))
    : await db.select().from(deliveriesTable).orderBy(desc(deliveriesTable.createdAt));
  const names = await userNameMap(deliveries.flatMap(d => [
    d.weightSubmittedById, d.weightApprovedById, d.qcSubmittedById, d.qcApprovedById,
    d.pricingProposedById, d.pricingApprovedById, d.rejectionById,
  ]));
  res.json(deliveries.map(d => shapeDelivery(d, names)));
});

router.post("/procurement/deliveries", requirePermission("procurement.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateDeliveryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batchesTable).where(eq(batchesTable.batchTag, parsed.data.batchTag));
    if (!batch) return { error: "Batch not found" as const };
    // Resolve workflow OUTSIDE the inner transaction (it does its own seed-on-empty txn).
    // Then pin its first active stage on the new delivery.
    const lotTag = generateLotTag();
    const workflow = await resolveWorkflowForDelivery(batch.cropType ?? null);
    const stages = await getWorkflowStages(workflow.id);
    const firstStage = stages.find((s) => s.isActive);
    if (!firstStage) return { error: "Resolved workflow has no active stages — cannot create delivery" as const };
    const initialStatus = STATUS_FOR_KIND[firstStage.stageKind] ?? "pending_weight_submit";
    const [delivery] = await tx.insert(deliveriesTable).values({
      lotTag,
      batchId: batch.id,
      stationId: parsed.data.stationId,
      truckPlate: parsed.data.truckPlate,
      driverName: parsed.data.driverName,
      preOffloadSampleTaken: parsed.data.preOffloadSampleTaken ?? false,
      qualifyingStreams: batch.qualifyingStreams,
      workflowId: workflow.id,
      currentStageOrder: firstStage.orderIdx,
      status: initialStatus,
    }).returning();
    await tx.insert(auditLogsTable).values({
      entityType: "delivery",
      entityId: delivery.id,
      action: "delivery.create",
      actorId: req.authedUser?.id ?? "system",
      actorName: req.authedUser?.email ?? "system",
      actorRole: req.authedUser?.role ?? "system",
      after: { lotTag, batchTag: parsed.data.batchTag },
    });
    return { delivery };
  });
  if ("error" in result) { res.status(404).json({ error: result.error }); return; }
  res.status(201).json(shapeDelivery(result.delivery));
});

router.get("/procurement/deliveries/:deliveryId", requirePermission("procurement.read"), async (req, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, delivery.batchId));
  const auditTrail = await db.select().from(auditLogsTable).where(eq(auditLogsTable.entityId, deliveryId as string)).orderBy(desc(auditLogsTable.timestamp));
  const contract = delivery.contractId
    ? (await db.select().from(procurementContractsTable).where(eq(procurementContractsTable.id, delivery.contractId)))[0]
    : null;
  const names = await userNameMap([
    delivery.weightSubmittedById, delivery.weightApprovedById, delivery.qcSubmittedById, delivery.qcApprovedById,
    delivery.pricingProposedById, delivery.pricingApprovedById, delivery.rejectionById,
  ]);
  // Resolve workflow + current stage so the UI can render stage names from the configured master
  // instead of legacy hardcoded labels.
  let workflow: any = null;
  let currentStage: any = null;
  if (delivery.workflowId) {
    const [wf] = await db.select().from(procurementWorkflowsTable).where(eq(procurementWorkflowsTable.id, delivery.workflowId));
    if (wf) {
      const stages = await getWorkflowStages(delivery.workflowId);
      workflow = { id: wf.id, code: wf.code, name: wf.name, stages };
      currentStage = activeStageAtOrAfter(stages, delivery.currentStageOrder ?? 0);
    }
  }
  res.json({
    ...shapeDelivery(delivery, names),
    batch: batch ? { ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0") } : null,
    contract: contract ? { ...contract, floorPricePerKg: num(contract.floorPricePerKg) } : null,
    workflow,
    currentStage,
    auditTrail,
  });
});

// ---------- DUAL-ACTOR GATES ----------
//
// Each gate handler loads the delivery + its workflow stages, validates that the stage at
// `currentStageOrder` is of the expected kind (e.g. WEIGHT_SUBMIT), and computes the next
// status from the next active stage in the workflow.
async function loadDeliveryWithStage(deliveryId: string, expectedKind: string) {
  const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId));
  if (!delivery) return { error: "Delivery not found", code: 404 } as const;
  if (!delivery.workflowId) return { error: "Delivery has no workflow pinned (legacy row)", code: 400 } as const;
  const stages = await getWorkflowStages(delivery.workflowId);
  const current = activeStageAtOrAfter(stages, delivery.currentStageOrder ?? 0);
  if (!current) return { error: "Delivery has no remaining active stages", code: 409 } as const;
  if (current.stageKind !== expectedKind) {
    return { error: `Workflow expects ${current.stageKind} (${current.displayName}); cannot ${expectedKind}`, code: 409 } as const;
  }
  const next = nextActiveStage(stages, current.orderIdx);
  return { delivery, stages, current, next } as const;
}

// Compute the status string for the stage AFTER advancement. If there is no next stage, we land
// in `approved` (terminal). Otherwise we use the canonical pending_* label for that kind.
function nextStatusAfter(nextStage: { stageKind: string } | null): string {
  if (!nextStage) return "approved";
  return STATUS_FOR_KIND[nextStage.stageKind] ?? "pending_pricing_approve";
}


router.post("/procurement/deliveries/:deliveryId/weight/submit", requirePermission("procurement.weight.submit"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = SubmitDeliveryWeightBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await loadDeliveryWithStage(req.params.deliveryId as string, "WEIGHT_SUBMIT");
  if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
  const userId = req.authedUser!.id;
  const net = (parsed.data.grossWeightKg - parsed.data.tareWeightKg).toFixed(3);
  const delivery = await transition(ctx.delivery.id, ctx.delivery.status, {
    grossWeightKg: parsed.data.grossWeightKg.toString(),
    tareWeightKg: parsed.data.tareWeightKg.toString(),
    netWeightKg: net,
    weightSubmittedById: userId,
    weightSubmittedAt: new Date(),
    weightApproved: false,
    weightApprovedById: null,
    weightApprovedAt: null,
    currentStageOrder: (ctx.next?.orderIdx ?? ctx.current.orderIdx) as number,
    status: nextStatusAfter(ctx.next),
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "weight.submit", { grossWeightKg: parsed.data.grossWeightKg, tareWeightKg: parsed.data.tareWeightKg, netWeightKg: parseFloat(net), stageId: ctx.current.id });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/weight/approve", requirePermission("procurement.weight.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const ctx = await loadDeliveryWithStage(req.params.deliveryId as string, "WEIGHT_APPROVE");
  if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
  const userId = req.authedUser!.id;
  if (ctx.delivery.weightSubmittedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as submitter" }); return;
  }
  const delivery = await transition(ctx.delivery.id, ctx.delivery.status, {
    weightApproved: true,
    weightApprovedById: userId,
    weightApprovedAt: new Date(),
    currentStageOrder: (ctx.next?.orderIdx ?? ctx.current.orderIdx) as number,
    status: nextStatusAfter(ctx.next),
  }, req.authedUser, "weight.approve", { stageId: ctx.current.id });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/qc/submit", requirePermission("procurement.qc.submit"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = SubmitDeliveryQcBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await loadDeliveryWithStage(req.params.deliveryId as string, "QC_SUBMIT");
  if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
  const userId = req.authedUser!.id;
  const grade = determineGrade(parsed.data.moistureContent, parsed.data.defectCount, parsed.data.cupScore ?? undefined);
  const sampleId = (parsed.data as any).sampleId ?? null;
  const delivery = await transition(ctx.delivery.id, ctx.delivery.status, {
    moistureContent: parsed.data.moistureContent.toString(),
    defectCount: parsed.data.defectCount.toString(),
    cupScore: parsed.data.cupScore?.toString() ?? null,
    grade,
    qcSampleId: sampleId,
    qcSubmittedById: userId,
    qcSubmittedAt: new Date(),
    qcApproved: false,
    qcApprovedById: null,
    qcApprovedAt: null,
    currentStageOrder: (ctx.next?.orderIdx ?? ctx.current.orderIdx) as number,
    status: nextStatusAfter(ctx.next),
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "qc.submit", { moistureContent: parsed.data.moistureContent, defectCount: parsed.data.defectCount, cupScore: parsed.data.cupScore, grade, sampleId, stageId: ctx.current.id });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/qc/approve", requirePermission("procurement.qc.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const ctx = await loadDeliveryWithStage(req.params.deliveryId as string, "QC_APPROVE");
  if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
  const userId = req.authedUser!.id;
  if (ctx.delivery.qcSubmittedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as submitter" }); return;
  }
  const delivery = await transition(ctx.delivery.id, ctx.delivery.status, {
    qcApproved: true,
    qcApprovedById: userId,
    qcApprovedAt: new Date(),
    currentStageOrder: (ctx.next?.orderIdx ?? ctx.current.orderIdx) as number,
    status: nextStatusAfter(ctx.next),
  }, req.authedUser, "qc.approve", { stageId: ctx.current.id });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/pricing/propose", requirePermission("procurement.pricing.propose"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = ProposeDeliveryPricingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const ctx = await loadDeliveryWithStage(deliveryId as string, "PRICING_PROPOSE");
  if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
  const current = ctx.delivery;
  // Workflow may have skipped weight/QC entirely (e.g. pricing-only quick flow). Only enforce
  // both-approved if those stage kinds are present in the resolved workflow.
  const stageKinds = new Set(ctx.stages.map((s) => s.stageKind));
  if (stageKinds.has("WEIGHT_APPROVE") && !current.weightApproved) {
    res.status(400).json({ error: "Weight must be approved before pricing" }); return;
  }
  if (stageKinds.has("QC_APPROVE") && !current.qcApproved) {
    res.status(400).json({ error: "QC must be approved before pricing" }); return;
  }
  // Floor-price enforcement via active PRE_SEASON contract.
  //
  // Resolution policy (per product decision):
  //   - LENIENT + AUDIT: when contract resolution is ambiguous (no group on batch, commodity
  //     mismatch, or non-UGX contract), the floor check is skipped but a warning audit event is
  //     written so the gap shows up in compliance reports.
  //   - PIN-IF-ACTIVE: if this delivery already has a contractId (from a prior CORRECTION
  //     re-propose), reuse it when still ACTIVE. If it's no longer ACTIVE, re-resolve and emit a
  //     warning so the buyer/manager sees that the original protection was lost.
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, current.batchId));
  let floor: number | null = null;
  let contractId: string | null = null;
  let resolvedFromPin = false;
  let resolutionWarning: { code: string; message: string; details?: any } | null = null;

  // Pin path
  if (current.contractId) {
    const [pinned] = await db.select().from(procurementContractsTable).where(eq(procurementContractsTable.id, current.contractId));
    if (pinned && pinned.status === "ACTIVE") {
      contractId = pinned.id;
      floor = pinned.floorPricePerKg ? parseFloat(pinned.floorPricePerKg) : null;
      resolvedFromPin = true;
      if (pinned.currency && pinned.currency !== "UGX") {
        resolutionWarning = { code: "non_ugx_contract", message: `Pinned contract ${pinned.contractNumber} is denominated in ${pinned.currency}; floor check skipped (no FX support yet)`, details: { contractId: pinned.id, currency: pinned.currency } };
        floor = null;
      }
    } else if (pinned) {
      resolutionWarning = { code: "pinned_contract_not_active", message: `Originally pinned contract ${pinned.contractNumber} is now ${pinned.status}; re-resolving the latest active contract for this group/commodity`, details: { previousContractId: pinned.id, previousStatus: pinned.status } };
    }
  }

  // Re-resolve path (no pin, or pin was stale)
  if (!resolvedFromPin) {
    if (!batch?.groupId) {
      const w: { code: string; message: string; details?: any } = { code: "batch_missing_group", message: "Batch has no farmer group; floor-price enforcement skipped (no contract resolvable)", details: { batchId: current.batchId } };
      resolutionWarning = resolutionWarning ?? w;
    } else {
      const candidates = await db.select().from(procurementContractsTable).where(and(
        eq(procurementContractsTable.groupId, batch.groupId),
        eq(procurementContractsTable.commodityType, batch.cropType ?? ""),
        eq(procurementContractsTable.status, "ACTIVE"),
      ));
      const preSeason = candidates
        .filter(c => c.contractType === "PRE_SEASON" && c.floorPricePerKg)
        .sort((a, b) => parseFloat(b.floorPricePerKg!) - parseFloat(a.floorPricePerKg!))[0];
      if (!preSeason) {
        // Try a permissive lookup to surface "near-miss" warnings (group has contracts but with a
        // commodity string that differs from batch.cropType — likely a catalog drift).
        const groupAll = await db.select().from(procurementContractsTable).where(and(
          eq(procurementContractsTable.groupId, batch.groupId),
          eq(procurementContractsTable.status, "ACTIVE"),
        ));
        const otherCommodities = groupAll.filter(c => c.commodityType !== (batch.cropType ?? "")).map(c => c.commodityType);
        if (otherCommodities.length > 0) {
          resolutionWarning = resolutionWarning ?? { code: "commodity_string_mismatch", message: `Batch commodity '${batch.cropType}' does not match any active contract for this group; floor-price enforcement skipped`, details: { batchCommodity: batch.cropType, availableContractCommodities: otherCommodities } };
        }
      } else if (preSeason.currency && preSeason.currency !== "UGX") {
        // Pin the contract on first resolution even if floor check is skipped, so subsequent
        // re-proposals re-use the same contract instead of resolving anew (architect requirement).
        contractId = preSeason.id;
        resolutionWarning = resolutionWarning ?? { code: "non_ugx_contract", message: `Active contract ${preSeason.contractNumber} is denominated in ${preSeason.currency}; floor check skipped (no FX support yet)`, details: { contractId: preSeason.id, currency: preSeason.currency } };
      } else if (preSeason.floorPricePerKg) {
        floor = parseFloat(preSeason.floorPricePerKg);
        contractId = preSeason.id;
      }
    }
  }

  if (resolutionWarning) {
    await writeAuditWarning(deliveryId as string, "pricing.floor_skipped", req.authedUser, resolutionWarning);
  }

  if (floor != null && parsed.data.pricePerKg < floor) {
    // Compliance: every attempt to undercut the contractual floor must leave a forensic trace
    // even though the state did not change. Reviewers / regulators need to see who tried.
    await writeAuditWarning(deliveryId as string, "pricing.below_floor_denied", req.authedUser, {
      attemptedPricePerKg: parsed.data.pricePerKg,
      floorPricePerKg: floor,
      contractId,
      resolvedFromPin,
    });
    res.status(400).json({
      error: `Proposed price ${parsed.data.pricePerKg} below contract floor ${floor}`,
      floorPricePerKg: floor,
      contractId,
      resolvedFromPin,
    });
    return;
  }
  const userId = req.authedUser!.id;
  const netKg = parseFloat(current.netWeightKg ?? "0");
  const totalValue = (netKg * parsed.data.pricePerKg).toFixed(2);
  const delivery = await transition(current.id, current.status, {
    pricePerKg: parsed.data.pricePerKg.toString(),
    totalValue,
    pricingDeductions: parsed.data.deductions ?? null,
    pricingIncentives: parsed.data.incentives ?? null,
    pricingProposedById: userId,
    pricingProposedAt: new Date(),
    pricingApprovedById: null,
    pricingApprovedAt: null,
    floorPricePerKg: floor != null ? floor.toString() : null,
    contractId,
    currentStageOrder: (ctx.next?.orderIdx ?? ctx.current.orderIdx) as number,
    status: nextStatusAfter(ctx.next),
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "pricing.propose", { pricePerKg: parsed.data.pricePerKg, totalValue, floorPricePerKg: floor, contractId, stageId: ctx.current.id });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/pricing/approve", requirePermission("procurement.pricing.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const ctx = await loadDeliveryWithStage(req.params.deliveryId as string, "PRICING_APPROVE");
  if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
  const userId = req.authedUser!.id;
  if (ctx.delivery.pricingProposedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as proposer" }); return;
  }
  const delivery = await transition(ctx.delivery.id, ctx.delivery.status, {
    pricingApprovedById: userId,
    pricingApprovedAt: new Date(),
    currentStageOrder: (ctx.next?.orderIdx ?? ctx.current.orderIdx) as number,
    status: nextStatusAfter(ctx.next),
  }, req.authedUser, "pricing.approve", { pricePerKg: num(ctx.delivery.pricePerKg), totalValue: num(ctx.delivery.totalValue), stageId: ctx.current.id });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

// ---------- REJECTION ----------

const REJECTION_STATUS: Record<string, string> = {
  CORRECTION: "rejected_correction",
  COMMODITY: "rejected_commodity",
  ESCALATE: "rejected_escalate",
  PARTIAL: "partial_rejection",
  SUSPEND: "suspended",
};

function stageOf(status: string): "weight" | "qc" | "pricing" | "final" {
  if (status.includes("weight")) return "weight";
  if (status.includes("qc")) return "qc";
  if (status.includes("pricing")) return "pricing";
  return "final";
}

// Map a logical "stage" label (weight/qc/pricing) to the workflow stage kind that opens that
// step (i.e. the SUBMIT/PROPOSE side, which is what CORRECTION returns to).
const REWIND_KIND_FOR_STAGE: Record<string, string> = {
  weight: "WEIGHT_SUBMIT",
  qc: "QC_SUBMIT",
  pricing: "PRICING_PROPOSE",
};

// Terminal states cannot be re-rejected, re-submitted, or resumed. Approved deliveries are
// archival; COMMODITY (rejected outright as wrong/contaminated commodity) and SUSPEND (operations
// frozen pending investigation) are also terminal per product policy.
const TERMINAL_STATUSES = ["approved", "rejected_commodity", "suspended"];

router.post("/procurement/deliveries/:deliveryId/reject", requirePermission("procurement.reject"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = RejectDeliveryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (TERMINAL_STATUSES.includes(current.status)) {
    res.status(409).json({ error: `Cannot reject from terminal status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  const newStatus = REJECTION_STATUS[parsed.data.rejectionType];
  const stage = stageOf(current.status);
  const updates: Partial<typeof deliveriesTable.$inferInsert> = {
    status: newStatus,
    rejectionType: parsed.data.rejectionType,
    rejectionStage: stage,
    rejectionReason: parsed.data.reason,
    rejectionById: userId,
    rejectionAt: new Date(),
  };
  // CORRECTION returns the delivery to the matching submit step (looked up from the workflow,
  // since the workflow may have skipped that stage entirely) and clears both actor refs AND the
  // stale stage payload, so the resubmission starts clean.
  if (parsed.data.rejectionType === "CORRECTION") {
    let rewindOrder: number | null = null;
    if (current.workflowId) {
      const stages = await getWorkflowStages(current.workflowId);
      const targetKind = REWIND_KIND_FOR_STAGE[stage] ?? "PRICING_PROPOSE";
      const target = stages.find((s) => s.isActive && s.stageKind === targetKind);
      if (target) {
        rewindOrder = target.orderIdx;
      } else {
        // The workflow no longer has an active stage of the kind we'd rewind to.
        // Refuse rather than leave currentStageOrder pointing at a different kind.
        res.status(409).json({
          error: `Workflow has no active ${targetKind} stage to rewind to. Re-enable the stage or use a different rejection type.`,
        });
        return;
      }
    }
    if (stage === "weight") {
      updates.status = "pending_weight_submit";
      if (rewindOrder != null) updates.currentStageOrder = rewindOrder;
      updates.weightApproved = false;
      updates.weightSubmittedById = null;
      updates.weightSubmittedAt = null;
      updates.weightApprovedById = null;
      updates.weightApprovedAt = null;
      updates.grossWeightKg = null;
      updates.tareWeightKg = null;
      updates.netWeightKg = null;
      updates.weightVarianceKg = null;
    } else if (stage === "qc") {
      updates.status = "pending_qc_submit";
      if (rewindOrder != null) updates.currentStageOrder = rewindOrder;
      updates.qcApproved = false;
      updates.qcSubmittedById = null;
      updates.qcSubmittedAt = null;
      updates.qcApprovedById = null;
      updates.qcApprovedAt = null;
      updates.moistureContent = null;
      updates.defectCount = null;
      updates.cupScore = null;
      updates.grade = null;
    } else if (stage === "pricing") {
      updates.status = "pending_pricing_propose";
      if (rewindOrder != null) updates.currentStageOrder = rewindOrder;
      updates.pricingProposedById = null;
      updates.pricingProposedAt = null;
      updates.pricingApprovedById = null;
      updates.pricingApprovedAt = null;
      updates.pricePerKg = null;
      updates.totalValue = null;
      updates.pricingDeductions = null;
      updates.pricingIncentives = null;
      // Intentionally KEEP contractId + floorPricePerKg so pricing/propose can pin to the
      // originally-resolved contract on the next attempt (per pin-if-active policy).
    } else if (stage === "final") {
      // CORRECTION raised against an already-approved or already-rejected delivery: there is no
      // earlier partial state to bounce back to. Treat it like pricing (most common late catch).
      updates.status = "pending_pricing_propose";
      if (rewindOrder != null) updates.currentStageOrder = rewindOrder;
      updates.pricingApprovedById = null;
      updates.pricingApprovedAt = null;
    }
  }
  const delivery = await transition(deliveryId as string, current.status, updates, req.authedUser, "reject", {
    rejectionType: parsed.data.rejectionType, stage, reason: parsed.data.reason,
  });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

// ---------- RESUME (PARTIAL / ESCALATE) ----------
//
// PARTIAL and ESCALATE are recoverable rejection types per product policy:
//   - PARTIAL: a portion of the delivery was rejected; the buyer wants to keep & approve the
//     remainder. We send it back to the stage that was being worked on so the kept portion
//     re-enters the normal approval chain.
//   - ESCALATE: a manager review unblocks the gate. Same routing: bounce to the matching submit
//     step so the supervised actor can re-do the contested step with management oversight.
//
// CORRECTION already auto-routes back via the reject handler; COMMODITY and SUSPEND are terminal.
router.post("/procurement/deliveries/:deliveryId/resume", requirePermission("procurement.resume"), async (req: AuthedRequest, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (!["partial_rejection", "rejected_escalate"].includes(current.status)) {
    res.status(409).json({ error: `Resume only applies to PARTIAL or ESCALATE rejections; current status is ${current.status}` }); return;
  }
  const stage = current.rejectionStage ?? "pricing";
  // Look up the stage in the workflow so resume jumps to the right currentStageOrder.
  let resumeOrder: number | null = null;
  if (current.workflowId) {
    const stages = await getWorkflowStages(current.workflowId);
    const targetKind = REWIND_KIND_FOR_STAGE[stage] ?? "PRICING_PROPOSE";
    const target = stages.find((s) => s.isActive && s.stageKind === targetKind);
    if (target) {
      resumeOrder = target.orderIdx;
    } else {
      res.status(409).json({
        error: `Workflow has no active ${targetKind} stage to resume into. Re-enable the stage in the workflow before resuming.`,
      });
      return;
    }
  }
  const next =
    stage === "weight" ? "pending_weight_submit"
    : stage === "qc" ? "pending_qc_submit"
    : stage === "pricing" ? "pending_pricing_propose"
    : "pending_pricing_propose";

  const reason = (req.body?.note as string | undefined) ?? null;
  const delivery = await transition(deliveryId as string, current.status, {
    status: next,
    currentStageOrder: resumeOrder ?? current.currentStageOrder,
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "resume", { fromStatus: current.status, toStatus: next, originalRejectionType: current.rejectionType, originalReason: current.rejectionReason, resumeNote: reason });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

export default router;

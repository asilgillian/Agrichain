import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  deliveriesTable,
  batchesTable,
  auditLogsTable,
  procurementContractsTable,
  usersTable,
} from "@workspace/db";
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
    const lotTag = generateLotTag();
    const [delivery] = await tx.insert(deliveriesTable).values({
      lotTag,
      batchId: batch.id,
      stationId: parsed.data.stationId,
      truckPlate: parsed.data.truckPlate,
      driverName: parsed.data.driverName,
      preOffloadSampleTaken: parsed.data.preOffloadSampleTaken ?? false,
      qualifyingStreams: batch.qualifyingStreams,
      status: "pending_weight_submit",
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
  res.json({
    ...shapeDelivery(delivery, names),
    batch: batch ? { ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0") } : null,
    contract: contract ? { ...contract, floorPricePerKg: num(contract.floorPricePerKg) } : null,
    auditTrail,
  });
});

// ---------- DUAL-ACTOR GATES ----------

router.post("/procurement/deliveries/:deliveryId/weight/submit", requirePermission("procurement.weight.submit"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = SubmitDeliveryWeightBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_weight_submit") {
    res.status(409).json({ error: `Cannot submit weight from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  const net = (parsed.data.grossWeightKg - parsed.data.tareWeightKg).toFixed(3);
  const delivery = await transition(deliveryId as string, "pending_weight_submit", {
    grossWeightKg: parsed.data.grossWeightKg.toString(),
    tareWeightKg: parsed.data.tareWeightKg.toString(),
    netWeightKg: net,
    weightSubmittedById: userId,
    weightSubmittedAt: new Date(),
    weightApproved: false,
    weightApprovedById: null,
    weightApprovedAt: null,
    status: "pending_weight_approve",
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "weight.submit", { grossWeightKg: parsed.data.grossWeightKg, tareWeightKg: parsed.data.tareWeightKg, netWeightKg: parseFloat(net) });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/weight/approve", requirePermission("procurement.weight.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_weight_approve") {
    res.status(409).json({ error: `Cannot approve weight from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  if (current.weightSubmittedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as submitter" }); return;
  }
  const delivery = await transition(deliveryId as string, "pending_weight_approve", {
    weightApproved: true,
    weightApprovedById: userId,
    weightApprovedAt: new Date(),
    status: "pending_qc_submit",
  }, req.authedUser, "weight.approve", {});
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/qc/submit", requirePermission("procurement.qc.submit"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = SubmitDeliveryQcBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_qc_submit") {
    res.status(409).json({ error: `Cannot submit QC from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  const grade = determineGrade(parsed.data.moistureContent, parsed.data.defectCount, parsed.data.cupScore ?? undefined);
  const sampleId = (parsed.data as any).sampleId ?? null; // populated when QC values originate from a Sampling Module sample
  const delivery = await transition(deliveryId as string, "pending_qc_submit", {
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
    status: "pending_qc_approve",
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "qc.submit", { moistureContent: parsed.data.moistureContent, defectCount: parsed.data.defectCount, cupScore: parsed.data.cupScore, grade, sampleId });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/qc/approve", requirePermission("procurement.qc.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_qc_approve") {
    res.status(409).json({ error: `Cannot approve QC from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  if (current.qcSubmittedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as submitter" }); return;
  }
  const delivery = await transition(deliveryId as string, "pending_qc_approve", {
    qcApproved: true,
    qcApprovedById: userId,
    qcApprovedAt: new Date(),
    status: "pending_pricing_propose",
  }, req.authedUser, "qc.approve", {});
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/pricing/propose", requirePermission("procurement.pricing.propose"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = ProposeDeliveryPricingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_pricing_propose") {
    res.status(409).json({ error: `Cannot propose pricing from status ${current.status}` }); return;
  }
  if (!current.weightApproved || !current.qcApproved) {
    res.status(400).json({ error: "Weight and QC must both be approved before pricing" }); return;
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
  const delivery = await transition(deliveryId as string, "pending_pricing_propose", {
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
    status: "pending_pricing_approve",
    // Clear any leftover rejection metadata from a prior pricing rejection
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "pricing.propose", { pricePerKg: parsed.data.pricePerKg, totalValue, floorPricePerKg: floor, contractId });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/pricing/approve", requirePermission("procurement.pricing.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_pricing_approve") {
    res.status(409).json({ error: `Cannot approve pricing from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  if (current.pricingProposedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as proposer" }); return;
  }
  const delivery = await transition(deliveryId as string, "pending_pricing_approve", {
    pricingApprovedById: userId,
    pricingApprovedAt: new Date(),
    status: "approved",
  }, req.authedUser, "pricing.approve", { pricePerKg: num(current.pricePerKg), totalValue: num(current.totalValue) });
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
  // CORRECTION returns the delivery to the matching submit step and clears
  // both actor refs AND the stale stage payload, so the resubmission starts clean.
  if (parsed.data.rejectionType === "CORRECTION") {
    if (stage === "weight") {
      updates.status = "pending_weight_submit";
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
  const next =
    stage === "weight" ? "pending_weight_submit"
    : stage === "qc" ? "pending_qc_submit"
    : stage === "pricing" ? "pending_pricing_propose"
    : "pending_pricing_propose"; // 'final' falls through to pricing as the most common late catch

  const reason = (req.body?.note as string | undefined) ?? null;
  const delivery = await transition(deliveryId as string, current.status, {
    status: next,
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
  }, req.authedUser, "resume", { fromStatus: current.status, toStatus: next, originalRejectionType: current.rejectionType, originalReason: current.rejectionReason, resumeNote: reason });
  if (!delivery) { res.status(409).json({ error: "Delivery state changed concurrently — refresh and retry" }); return; }
  res.json(shapeDelivery(delivery));
});

export default router;

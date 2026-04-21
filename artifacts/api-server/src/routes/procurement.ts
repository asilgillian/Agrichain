import { Router, type IRouter, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
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

async function audit(
  entityId: string,
  action: string,
  user: AuthedRequest["authedUser"] | undefined,
  metadata: Record<string, unknown>,
) {
  await db.insert(auditLogsTable).values({
    entityType: "delivery",
    entityId,
    action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    after: metadata,
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
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.batchTag, parsed.data.batchTag));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  const lotTag = generateLotTag();
  const [delivery] = await db.insert(deliveriesTable).values({
    lotTag,
    batchId: batch.id,
    stationId: parsed.data.stationId,
    truckPlate: parsed.data.truckPlate,
    driverName: parsed.data.driverName,
    preOffloadSampleTaken: parsed.data.preOffloadSampleTaken ?? false,
    qualifyingStreams: batch.qualifyingStreams,
    status: "pending_weight_submit",
  }).returning();
  await audit(delivery.id, "delivery.create", req.authedUser, { lotTag, batchTag: parsed.data.batchTag });
  res.status(201).json(shapeDelivery(delivery));
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
    res.status(400).json({ error: `Cannot submit weight from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  const net = (parsed.data.grossWeightKg - parsed.data.tareWeightKg).toFixed(3);
  const [delivery] = await db.update(deliveriesTable).set({
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
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  await audit(delivery.id, "weight.submit", req.authedUser, { grossWeightKg: parsed.data.grossWeightKg, tareWeightKg: parsed.data.tareWeightKg, netWeightKg: parseFloat(net) });
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/weight/approve", requirePermission("procurement.weight.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_weight_approve") {
    res.status(400).json({ error: `Cannot approve weight from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  if (current.weightSubmittedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as submitter" }); return;
  }
  const [delivery] = await db.update(deliveriesTable).set({
    weightApproved: true,
    weightApprovedById: userId,
    weightApprovedAt: new Date(),
    status: "pending_qc_submit",
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  await audit(delivery.id, "weight.approve", req.authedUser, {});
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/qc/submit", requirePermission("procurement.qc.submit"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = SubmitDeliveryQcBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_qc_submit") {
    res.status(400).json({ error: `Cannot submit QC from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  const grade = determineGrade(parsed.data.moistureContent, parsed.data.defectCount, parsed.data.cupScore ?? undefined);
  const [delivery] = await db.update(deliveriesTable).set({
    moistureContent: parsed.data.moistureContent.toString(),
    defectCount: parsed.data.defectCount.toString(),
    cupScore: parsed.data.cupScore?.toString(),
    grade,
    qcSubmittedById: userId,
    qcSubmittedAt: new Date(),
    qcApproved: false,
    qcApprovedById: null,
    qcApprovedAt: null,
    status: "pending_qc_approve",
    rejectionType: null, rejectionStage: null, rejectionReason: null, rejectionById: null, rejectionAt: null,
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  await audit(delivery.id, "qc.submit", req.authedUser, { moistureContent: parsed.data.moistureContent, defectCount: parsed.data.defectCount, cupScore: parsed.data.cupScore, grade });
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/qc/approve", requirePermission("procurement.qc.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_qc_approve") {
    res.status(400).json({ error: `Cannot approve QC from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  if (current.qcSubmittedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as submitter" }); return;
  }
  const [delivery] = await db.update(deliveriesTable).set({
    qcApproved: true,
    qcApprovedById: userId,
    qcApprovedAt: new Date(),
    status: "pending_pricing_propose",
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  await audit(delivery.id, "qc.approve", req.authedUser, {});
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/pricing/propose", requirePermission("procurement.pricing.propose"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = ProposeDeliveryPricingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_pricing_propose") {
    res.status(400).json({ error: `Cannot propose pricing from status ${current.status}` }); return;
  }
  if (!current.weightApproved || !current.qcApproved) {
    res.status(400).json({ error: "Weight and QC must both be approved before pricing" }); return;
  }
  // Floor-price enforcement via active PRE_SEASON contract
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, current.batchId));
  let floor: number | null = null;
  let contractId: string | null = null;
  if (batch?.groupId) {
    const candidates = await db.select().from(procurementContractsTable).where(and(
      eq(procurementContractsTable.groupId, batch.groupId),
      eq(procurementContractsTable.commodityType, batch.cropType ?? ""),
      eq(procurementContractsTable.status, "ACTIVE"),
    ));
    const preSeason = candidates
      .filter(c => c.contractType === "PRE_SEASON" && c.floorPricePerKg)
      .sort((a, b) => parseFloat(b.floorPricePerKg!) - parseFloat(a.floorPricePerKg!))[0];
    if (preSeason && preSeason.floorPricePerKg) {
      floor = parseFloat(preSeason.floorPricePerKg);
      contractId = preSeason.id;
      if (parsed.data.pricePerKg < floor) {
        res.status(400).json({ error: `Proposed price ${parsed.data.pricePerKg} below contract floor ${floor}`, floorPricePerKg: floor, contractId });
        return;
      }
    }
  }
  const userId = req.authedUser!.id;
  const netKg = parseFloat(current.netWeightKg ?? "0");
  const totalValue = (netKg * parsed.data.pricePerKg).toFixed(2);
  const [delivery] = await db.update(deliveriesTable).set({
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
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  await audit(delivery.id, "pricing.propose", req.authedUser, { pricePerKg: parsed.data.pricePerKg, totalValue, floorPricePerKg: floor, contractId });
  res.json(shapeDelivery(delivery));
});

router.post("/procurement/deliveries/:deliveryId/pricing/approve", requirePermission("procurement.pricing.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status !== "pending_pricing_approve") {
    res.status(400).json({ error: `Cannot approve pricing from status ${current.status}` }); return;
  }
  const userId = req.authedUser!.id;
  if (current.pricingProposedById === userId) {
    res.status(403).json({ error: "Approver cannot be the same person as proposer" }); return;
  }
  const [delivery] = await db.update(deliveriesTable).set({
    pricingApprovedById: userId,
    pricingApprovedAt: new Date(),
    status: "approved",
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  await audit(delivery.id, "pricing.approve", req.authedUser, { pricePerKg: num(delivery.pricePerKg), totalValue: num(delivery.totalValue) });
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

router.post("/procurement/deliveries/:deliveryId/reject", requirePermission("procurement.reject"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = RejectDeliveryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { deliveryId } = req.params;
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (["approved", "rejected_commodity", "suspended"].includes(current.status)) {
    res.status(400).json({ error: `Cannot reject from terminal status ${current.status}` }); return;
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
    updatedAt: new Date(),
  };
  // CORRECTION returns to a submit step; clear stage payload + actor refs so the
  // UI/state machine treats it as a fresh submission slot.
  if (parsed.data.rejectionType === "CORRECTION") {
    if (stage === "weight") {
      updates.status = "pending_weight_submit";
      updates.weightApproved = false;
      updates.weightSubmittedById = null;
      updates.weightSubmittedAt = null;
      updates.weightApprovedById = null;
      updates.weightApprovedAt = null;
    } else if (stage === "qc") {
      updates.status = "pending_qc_submit";
      updates.qcApproved = false;
      updates.qcSubmittedById = null;
      updates.qcSubmittedAt = null;
      updates.qcApprovedById = null;
      updates.qcApprovedAt = null;
    } else if (stage === "pricing") {
      updates.status = "pending_pricing_propose";
      updates.pricingProposedById = null;
      updates.pricingProposedAt = null;
      updates.pricingApprovedById = null;
      updates.pricingApprovedAt = null;
    }
  }
  const [delivery] = await db.update(deliveriesTable).set(updates).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  await audit(delivery.id, "reject", req.authedUser, { rejectionType: parsed.data.rejectionType, stage, reason: parsed.data.reason });
  res.json(shapeDelivery(delivery));
});

export default router;

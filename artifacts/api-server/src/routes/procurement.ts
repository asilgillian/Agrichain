import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, deliveriesTable, batchesTable, lotsTable, auditLogsTable } from "@workspace/db";
import {
  CreateDeliveryBody,
  RecordDeliveryWeightBody,
  RecordDeliveryQCBody,
  SubmitDeliveryPricingBody,
  ApproveDeliveryBody,
  ListDeliveriesQueryParams,
} from "@workspace/api-zod";

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

function nextStatus(current: string, weightApproved: boolean, qcApproved: boolean): string {
  if (current === "pending_weight" && weightApproved) return "pending_qc";
  if (current === "pending_qc" && qcApproved) return "pending_pricing";
  if (current === "pending_pricing") return "pending_approval";
  return current;
}

router.get("/procurement/deliveries", async (req, res): Promise<void> => {
  const parsed = ListDeliveriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, stationId } = parsed.data;
  const conditions: any[] = [];
  if (status) conditions.push(eq(deliveriesTable.status, status));
  if (stationId) conditions.push(eq(deliveriesTable.stationId, stationId));

  const deliveries = conditions.length > 0
    ? await db.select().from(deliveriesTable).where(and(...conditions)).orderBy(desc(deliveriesTable.createdAt))
    : await db.select().from(deliveriesTable).orderBy(desc(deliveriesTable.createdAt));

  res.json(deliveries.map(d => ({
    ...d,
    netWeightKg: d.netWeightKg ? parseFloat(d.netWeightKg) : null,
    grossWeightKg: d.grossWeightKg ? parseFloat(d.grossWeightKg) : null,
    tareWeightKg: d.tareWeightKg ? parseFloat(d.tareWeightKg) : null,
    pricePerKg: d.pricePerKg ? parseFloat(d.pricePerKg) : null,
    totalValue: d.totalValue ? parseFloat(d.totalValue) : null,
  })));
});

router.post("/procurement/deliveries", async (req, res): Promise<void> => {
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
    qualifyingStreams: batch.qualifyingStreams,
  }).returning();
  res.status(201).json({ ...delivery, netWeightKg: null, grossWeightKg: null, pricePerKg: null, totalValue: null });
});

router.get("/procurement/deliveries/:deliveryId", async (req, res): Promise<void> => {
  const { deliveryId } = req.params;
  const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, delivery.batchId));
  const auditTrail = await db.select().from(auditLogsTable).where(eq(auditLogsTable.entityId, deliveryId as string));
  res.json({
    ...delivery,
    netWeightKg: delivery.netWeightKg ? parseFloat(delivery.netWeightKg) : null,
    grossWeightKg: delivery.grossWeightKg ? parseFloat(delivery.grossWeightKg) : null,
    pricePerKg: delivery.pricePerKg ? parseFloat(delivery.pricePerKg) : null,
    totalValue: delivery.totalValue ? parseFloat(delivery.totalValue) : null,
    batch: batch ? { ...batch, totalWeightKg: parseFloat(batch.totalWeightKg ?? "0"), agentName: "Field Agent" } : null,
    auditTrail: auditTrail.map(a => ({ ...a, timestamp: a.timestamp })),
  });
});

router.post("/procurement/deliveries/:deliveryId/weight", async (req, res): Promise<void> => {
  const { deliveryId } = req.params;
  const parsed = RecordDeliveryWeightBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const netWeightKg = (parsed.data.grossWeightKg - parsed.data.tareWeightKg).toFixed(3);
  const [delivery] = await db.update(deliveriesTable).set({
    grossWeightKg: parsed.data.grossWeightKg.toString(),
    tareWeightKg: parsed.data.tareWeightKg.toString(),
    netWeightKg,
    weightApproved: true,
    status: "pending_qc",
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  res.json({ ...delivery, netWeightKg: parseFloat(netWeightKg), grossWeightKg: parsed.data.grossWeightKg, pricePerKg: null, totalValue: null });
});

router.post("/procurement/deliveries/:deliveryId/qc", async (req, res): Promise<void> => {
  const { deliveryId } = req.params;
  const parsed = RecordDeliveryQCBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const grade = determineGrade(parsed.data.moistureContent, parsed.data.defectCount, parsed.data.cupScore ?? undefined);
  const [delivery] = await db.update(deliveriesTable).set({
    moistureContent: parsed.data.moistureContent.toString(),
    defectCount: parsed.data.defectCount.toString(),
    cupScore: parsed.data.cupScore?.toString(),
    grade,
    qcApproved: true,
    status: "pending_pricing",
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  res.json({ ...delivery, netWeightKg: delivery.netWeightKg ? parseFloat(delivery.netWeightKg) : null, pricePerKg: null, totalValue: null });
});

router.post("/procurement/deliveries/:deliveryId/pricing", async (req, res): Promise<void> => {
  const { deliveryId } = req.params;
  const parsed = SubmitDeliveryPricingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [current] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, deliveryId as string));
  if (!current) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  if (!current.weightApproved || !current.qcApproved) {
    res.status(400).json({ error: "Weight and QC must both be approved before pricing" });
    return;
  }
  const netKg = parseFloat(current.netWeightKg ?? "0");
  const totalValue = (netKg * parsed.data.pricePerKg).toFixed(2);
  const [delivery] = await db.update(deliveriesTable).set({
    pricePerKg: parsed.data.pricePerKg.toString(),
    totalValue,
    pricingDeductions: parsed.data.deductions,
    pricingIncentives: parsed.data.incentives,
    status: "pending_approval",
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  res.json({ ...delivery, netWeightKg: delivery.netWeightKg ? parseFloat(delivery.netWeightKg) : null, pricePerKg: parsed.data.pricePerKg, totalValue: parseFloat(totalValue) });
});

router.post("/procurement/deliveries/:deliveryId/approve", async (req, res): Promise<void> => {
  const { deliveryId } = req.params;
  const parsed = ApproveDeliveryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const newStatus = parsed.data.decision === "approved" ? "approved" : "rejected";
  const [delivery] = await db.update(deliveriesTable).set({
    status: newStatus,
    rejectionReason: parsed.data.decision === "rejected" ? parsed.data.comment : null,
    updatedAt: new Date(),
  }).where(eq(deliveriesTable.id, deliveryId as string)).returning();
  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  res.json({ ...delivery, netWeightKg: delivery.netWeightKg ? parseFloat(delivery.netWeightKg) : null, pricePerKg: delivery.pricePerKg ? parseFloat(delivery.pricePerKg) : null, totalValue: delivery.totalValue ? parseFloat(delivery.totalValue) : null });
});

export default router;

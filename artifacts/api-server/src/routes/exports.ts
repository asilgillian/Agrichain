import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, exportContractsTable, shipmentsTable, exportDocumentsTable } from "@workspace/db";
import { CreateExportContractBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/exports/contracts", async (req, res): Promise<void> => {
  const contracts = await db.select().from(exportContractsTable).orderBy(desc(exportContractsTable.createdAt));
  res.json(contracts.map(c => ({ ...c, quantityKg: parseFloat(c.quantityKg ?? "0"), pricePerKg: parseFloat(c.pricePerKg ?? "0") })));
});

router.post("/exports/contracts", async (req, res): Promise<void> => {
  const parsed = CreateExportContractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [contract] = await db.insert(exportContractsTable).values({
    ...parsed.data,
    quantityKg: parsed.data.quantityKg.toString(),
    pricePerKg: parsed.data.pricePerKg.toString(),
  }).returning();
  res.status(201).json({ ...contract, quantityKg: parsed.data.quantityKg, pricePerKg: parsed.data.pricePerKg });
});

router.get("/exports/shipments", async (req, res): Promise<void> => {
  const shipments = await db.select().from(shipmentsTable).orderBy(desc(shipmentsTable.createdAt));
  res.json(shipments.map(s => ({ ...s, totalWeightKg: s.totalWeightKg ? parseFloat(s.totalWeightKg) : null })));
});

router.get("/exports/shipments/:shipmentId", async (req, res): Promise<void> => {
  const { shipmentId } = req.params;
  const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId as string));
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const documents = await db.select().from(exportDocumentsTable).where(eq(exportDocumentsTable.shipmentId, shipmentId as string));
  res.json({ ...shipment, totalWeightKg: shipment.totalWeightKg ? parseFloat(shipment.totalWeightKg) : null, lots: [], documents });
});

router.get("/exports/shipments/:shipmentId/documents", async (req, res): Promise<void> => {
  const { shipmentId } = req.params;
  const documents = await db.select().from(exportDocumentsTable).where(eq(exportDocumentsTable.shipmentId, shipmentId as string));
  res.json(documents);
});

export default router;

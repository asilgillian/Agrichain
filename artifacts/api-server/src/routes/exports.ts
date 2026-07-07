import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, exportContractsTable, shipmentsTable, exportDocumentsTable } from "@workspace/db";
import { CreateExportContractBody, CreateShipmentBody } from "@workspace/api-zod";
import { drawDownCommodityStock, InsufficientStockError, UnknownCommodityTypeError } from "../lib/commodity-stock";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

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

router.post("/exports/shipments", async (req, res): Promise<void> => {
  const parsed = CreateShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { contractId, commodityTypeId, containerNumber, vesselName, portOfLoading, portOfDestination, shipmentDate, totalWeightKg } = parsed.data;

  const [contract] = await db.select().from(exportContractsTable).where(eq(exportContractsTable.id, contractId)).limit(1);
  if (!contract) { res.status(404).json({ error: "Export contract not found" }); return; }

  // Exporting graded stock directly: when a commodity type is attached, the shipment weight is
  // drawn down from the commodity stock ledger, so a positive weight is required.
  const weight = Number(totalWeightKg ?? 0);
  if (commodityTypeId) {
    if (!isUuid(commodityTypeId)) { res.status(400).json({ error: "commodityTypeId must be a valid id" }); return; }
    if (!Number.isFinite(weight) || weight <= 0) { res.status(400).json({ error: "totalWeightKg must be a positive number when shipping graded commodity stock" }); return; }
  }

  try {
    const shipment = await db.transaction(async (tx) => {
      const [created] = await tx.insert(shipmentsTable).values({
        contractId,
        commodityTypeId: commodityTypeId || null,
        containerNumber: containerNumber || null,
        vesselName: vesselName || null,
        portOfLoading: portOfLoading || null,
        portOfDestination: portOfDestination || null,
        shipmentDate: shipmentDate || null,
        totalWeightKg: totalWeightKg != null ? String(totalWeightKg) : null,
      }).returning();

      if (commodityTypeId) {
        await drawDownCommodityStock(tx, {
          commodityTypeId,
          weightKg: weight,
          movementType: "export_shipment",
          shipmentId: created.id,
          notes: `Exported via shipment for contract ${contract.contractNumber}`,
        });
      }
      return created;
    });
    res.status(201).json({ ...shipment, totalWeightKg: shipment.totalWeightKg ? parseFloat(shipment.totalWeightKg) : null });
  } catch (e) {
    if (e instanceof InsufficientStockError) {
      res.status(409).json({ error: e.message, availableKg: e.availableKg, requestedKg: e.requestedKg });
      return;
    }
    if (e instanceof UnknownCommodityTypeError) {
      res.status(400).json({ error: "commodityTypeId does not reference a known commodity type" });
      return;
    }
    throw e;
  }
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

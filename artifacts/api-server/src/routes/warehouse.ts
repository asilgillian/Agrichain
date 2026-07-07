import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, lotsTable, commodityStockMovementsTable, commodityTypesTable, commoditiesTable, gradingRunsTable, dispatchesTable, shipmentsTable } from "@workspace/db";
import { ListLotsQueryParams } from "@workspace/api-zod";
import { z } from "zod";

const router: IRouter = Router();

router.get("/warehouse/lots", async (req, res): Promise<void> => {
  const parsed = ListLotsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status } = parsed.data;
  const lots = status
    ? await db.select().from(lotsTable).where(eq(lotsTable.status, status))
    : await db.select().from(lotsTable);
  res.json(lots.map(l => ({ ...l, weightKg: parseFloat(l.weightKg ?? "0") })));
});

router.get("/warehouse/lots/:lotId", async (req, res): Promise<void> => {
  const { lotId } = req.params;
  const [lot] = await db.select().from(lotsTable).where(eq(lotsTable.id, lotId as string));
  if (!lot) {
    res.status(404).json({ error: "Lot not found" });
    return;
  }
  res.json({
    ...lot,
    weightKg: parseFloat(lot.weightKg ?? "0"),
    chainOfCustody: [
      { step: "Received at Warehouse", actor: "Warehouse Manager", timestamp: lot.receivedAt, notes: null },
    ],
  });
});

router.get("/warehouse/mass-balance", async (req, res): Promise<void> => {
  const lots = await db.select().from(lotsTable);
  const totalReceivedKg = lots.reduce((s, l) => s + parseFloat(l.weightKg ?? "0"), 0);
  const processedKg = lots.filter(l => ["processed", "allocated", "exported"].includes(l.status)).reduce((s, l) => s + parseFloat(l.weightKg ?? "0"), 0);
  const allocatedKg = lots.filter(l => ["allocated", "exported"].includes(l.status)).reduce((s, l) => s + parseFloat(l.weightKg ?? "0"), 0);
  const exportedKg = lots.filter(l => l.status === "exported").reduce((s, l) => s + parseFloat(l.weightKg ?? "0"), 0);

  const streamMap: Record<string, number> = {};
  lots.forEach(l => {
    l.certificationStreams.forEach(s => {
      streamMap[s] = (streamMap[s] ?? 0) + parseFloat(l.weightKg ?? "0");
    });
  });

  // Graded commodity stock — the net balance per commodity type in the stock ledger. Grading runs
  // book sellable outputs as positive stock and draw down consumed inputs as negative, so the sum
  // reflects the post-grading warehouse stock of each graded/consumed commodity type.
  const commodityStockRows = await db
    .select({
      commodityTypeId: commodityStockMovementsTable.commodityTypeId,
      commodityTypeName: commodityTypesTable.name,
      commodityName: commoditiesTable.name,
      netStockKg: sql<string>`sum(${commodityStockMovementsTable.weightKg})`,
    })
    .from(commodityStockMovementsTable)
    .innerJoin(commodityTypesTable, eq(commodityTypesTable.id, commodityStockMovementsTable.commodityTypeId))
    .innerJoin(commoditiesTable, eq(commoditiesTable.id, commodityTypesTable.commodityId))
    .groupBy(commodityStockMovementsTable.commodityTypeId, commodityTypesTable.name, commoditiesTable.name);

  const commodityStock = commodityStockRows.map(r => ({
    commodityTypeId: r.commodityTypeId,
    commodityTypeName: r.commodityTypeName,
    commodityName: r.commodityName,
    netStockKg: parseFloat(r.netStockKg ?? "0"),
  }));

  res.json({
    totalReceivedKg,
    totalProcessedKg: processedKg,
    totalAllocatedKg: allocatedKg,
    totalExportedKg: exportedKg,
    warehouseStockKg: totalReceivedKg - exportedKg,
    byStream: Object.entries(streamMap).map(([streamName, stockKg]) => ({ streamName, stockKg })),
    commodityStock,
  });
});

// Commodity stock ledger movement history. Each row is one signed movement (grading in/out, sale
// dispatch, export shipment) joined to its provenance record for a human-readable reference.
const ListStockMovementsQuery = z.object({ commodityTypeId: z.string().uuid().optional() });

router.get("/warehouse/stock-movements", async (req, res): Promise<void> => {
  const parsed = ListStockMovementsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { commodityTypeId } = parsed.data;

  const baseQuery = db
    .select({
      id: commodityStockMovementsTable.id,
      commodityTypeId: commodityStockMovementsTable.commodityTypeId,
      commodityTypeName: commodityTypesTable.name,
      commodityName: commoditiesTable.name,
      movementType: commodityStockMovementsTable.movementType,
      weightKg: commodityStockMovementsTable.weightKg,
      gradingRunId: commodityStockMovementsTable.gradingRunId,
      runNumber: gradingRunsTable.runNumber,
      dispatchId: commodityStockMovementsTable.dispatchId,
      dispatchNumber: dispatchesTable.dispatchNumber,
      dispatchContractId: dispatchesTable.contractId,
      shipmentId: commodityStockMovementsTable.shipmentId,
      shipmentContainer: shipmentsTable.containerNumber,
      shipmentVessel: shipmentsTable.vesselName,
      notes: commodityStockMovementsTable.notes,
      createdAt: commodityStockMovementsTable.createdAt,
    })
    .from(commodityStockMovementsTable)
    .innerJoin(commodityTypesTable, eq(commodityTypesTable.id, commodityStockMovementsTable.commodityTypeId))
    .innerJoin(commoditiesTable, eq(commoditiesTable.id, commodityTypesTable.commodityId))
    .leftJoin(gradingRunsTable, eq(gradingRunsTable.id, commodityStockMovementsTable.gradingRunId))
    .leftJoin(dispatchesTable, eq(dispatchesTable.id, commodityStockMovementsTable.dispatchId))
    .leftJoin(shipmentsTable, eq(shipmentsTable.id, commodityStockMovementsTable.shipmentId))
    .orderBy(desc(commodityStockMovementsTable.createdAt), desc(commodityStockMovementsTable.id));

  const rows = commodityTypeId
    ? await baseQuery.where(eq(commodityStockMovementsTable.commodityTypeId, commodityTypeId))
    : await baseQuery;

  res.json(rows.map(r => ({
    id: r.id,
    commodityTypeId: r.commodityTypeId,
    commodityTypeName: r.commodityTypeName,
    commodityName: r.commodityName,
    movementType: r.movementType,
    weightKg: parseFloat(r.weightKg ?? "0"),
    reference: r.runNumber ?? r.dispatchNumber ?? r.shipmentContainer ?? r.shipmentVessel ?? null,
    gradingRunId: r.gradingRunId,
    dispatchId: r.dispatchId,
    dispatchContractId: r.dispatchContractId,
    shipmentId: r.shipmentId,
    notes: r.notes,
    createdAt: r.createdAt,
  })));
});

export default router;

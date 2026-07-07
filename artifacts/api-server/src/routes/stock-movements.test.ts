import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  commoditiesTable,
  commodityTypesTable,
  commodityStockMovementsTable,
  dispatchesTable,
  shipmentsTable,
  exportContractsTable,
  gradingProfilesTable,
  gradingRunsTable,
} from "@workspace/db";
import warehouseRouter from "./warehouse";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Integration coverage for GET /warehouse/stock-movements:
//   - returns every ledger row with commodity type/name, signed weight, and a
//     human-readable reference (grading run number / dispatch number / shipment container)
//   - filters by commodityTypeId
//   - rejects a malformed commodityTypeId with 400
// Runs against the live dev Postgres (fixtures use randomized codes, cleaned up in afterAll).
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;

let commodityId: string;
let typeAId: string;
let typeBId: string;
let profileId: string;
let runId: string;
let dispatchId: string;
let shipmentId: string;
let exportContractId: string;

beforeAll(async () => {
  server = await startTestServer([warehouseRouter]);

  const [commodity] = await db
    .insert(commoditiesTable)
    .values({ name: `${tag} Coffee`, code: `${tag}_COF` })
    .returning();
  commodityId = commodity.id;

  const [a] = await db
    .insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} Screen 18`, code: `${tag}_S18`, stage: "finished" })
    .returning();
  typeAId = a.id;

  const [b] = await db
    .insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} Screen 15`, code: `${tag}_S15`, stage: "finished" })
    .returning();
  typeBId = b.id;

  const [profile] = await db
    .insert(gradingProfilesTable)
    .values({ name: `${tag} Profile`, inputCommodityTypeId: typeAId, effectiveDate: "2026-01-01" })
    .returning();
  profileId = profile.id;

  const [run] = await db
    .insert(gradingRunsTable)
    .values({
      runNumber: `${tag}_GR1`,
      gradingProfileId: profileId,
      inputCommodityTypeId: typeAId,
      inputWeightKg: "1000.00",
      totalOutputKg: "900.00",
      lossKg: "100.00",
      lossPct: "10.000",
    })
    .returning();
  runId = run.id;

  const [dispatch] = await db
    .insert(dispatchesTable)
    .values({ dispatchNumber: `${tag}_DSP1`, commodityTypeId: typeAId, dispatchWeightKg: "300.00" })
    .returning();
  dispatchId = dispatch.id;

  const [contract] = await db
    .insert(exportContractsTable)
    .values({
      contractNumber: `${tag}_EXP1`,
      buyer: `${tag} Buyer`,
      destination: "Hamburg",
      cropType: "coffee",
      quantityKg: "20000",
      pricePerKg: "4.20",
    })
    .returning();
  exportContractId = contract.id;

  const [shipment] = await db
    .insert(shipmentsTable)
    .values({ contractId: exportContractId, commodityTypeId: typeAId, containerNumber: `${tag}_CNT1`, totalWeightKg: "200.000" })
    .returning();
  shipmentId = shipment.id;

  // Ledger rows: grading output books in, dispatch/shipment draw down; type B has its own row.
  await db.insert(commodityStockMovementsTable).values([
    { commodityTypeId: typeAId, weightKg: "900.00", movementType: "grading_output", gradingRunId: runId },
    { commodityTypeId: typeAId, weightKg: "-300.00", movementType: "sale_dispatch", dispatchId },
    { commodityTypeId: typeAId, weightKg: "-200.00", movementType: "export_shipment", shipmentId },
    { commodityTypeId: typeBId, weightKg: "50.00", movementType: "grading_output", gradingRunId: runId },
  ]);
});

afterAll(async () => {
  const typeIds = [typeAId, typeBId].filter(Boolean);
  if (typeIds.length) {
    await db.delete(commodityStockMovementsTable).where(inArray(commodityStockMovementsTable.commodityTypeId, typeIds));
  }
  if (shipmentId) await db.delete(shipmentsTable).where(eq(shipmentsTable.id, shipmentId));
  if (exportContractId) await db.delete(exportContractsTable).where(eq(exportContractsTable.id, exportContractId));
  if (dispatchId) await db.delete(dispatchesTable).where(eq(dispatchesTable.id, dispatchId));
  if (runId) await db.delete(gradingRunsTable).where(eq(gradingRunsTable.id, runId));
  if (profileId) await db.delete(gradingProfilesTable).where(eq(gradingProfilesTable.id, profileId));
  if (typeIds.length) await db.delete(commodityTypesTable).where(inArray(commodityTypesTable.id, typeIds));
  if (commodityId) await db.delete(commoditiesTable).where(eq(commoditiesTable.id, commodityId));
  await server?.close();
});

type MovementEntry = {
  id: string;
  commodityTypeId: string;
  commodityTypeName: string;
  movementType: string;
  weightKg: number;
  reference: string | null;
  dispatchId: string | null;
  shipmentId: string | null;
  gradingRunId: string | null;
};

describe("GET /warehouse/stock-movements", () => {
  it("lists all movements with signed weights and provenance references", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/warehouse/stock-movements`);
    expect(status).toBe(200);
    const mine = (body as MovementEntry[]).filter(m => m.commodityTypeName.startsWith(tag));
    expect(mine).toHaveLength(4);

    const gradingRows = mine.filter(m => m.movementType === "grading_output");
    expect(gradingRows).toHaveLength(2);
    for (const g of gradingRows) expect(g.reference).toBe(`${tag}_GR1`);

    const sale = mine.find(m => m.movementType === "sale_dispatch");
    expect(sale).toBeDefined();
    expect(sale!.weightKg).toBe(-300);
    expect(sale!.reference).toBe(`${tag}_DSP1`);
    expect(sale!.dispatchId).toBe(dispatchId);

    const ship = mine.find(m => m.movementType === "export_shipment");
    expect(ship).toBeDefined();
    expect(ship!.weightKg).toBe(-200);
    expect(ship!.reference).toBe(`${tag}_CNT1`);
    expect(ship!.shipmentId).toBe(shipmentId);
  });

  it("filters by commodityTypeId", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/warehouse/stock-movements?commodityTypeId=${typeBId}`);
    expect(status).toBe(200);
    expect((body as MovementEntry[]).every(m => m.commodityTypeId === typeBId)).toBe(true);
    expect(body).toHaveLength(1);
    expect((body as MovementEntry[])[0].weightKg).toBe(50);
  });

  it("rejects a malformed commodityTypeId with 400", async () => {
    const { status } = await jsonRequest(`${server.baseUrl}/warehouse/stock-movements?commodityTypeId=not-a-uuid`);
    expect(status).toBe(400);
  });
});

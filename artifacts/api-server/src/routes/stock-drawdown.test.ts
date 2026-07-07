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
} from "@workspace/db";
import salesRouter from "./sales";
import exportsRouter from "./exports";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Integration coverage for selling/exporting graded commodity stock:
//   - POST /dispatches with a commodityTypeId writes a negative 'sale_dispatch' ledger row
//   - POST /exports/shipments with a commodityTypeId writes a negative 'export_shipment' row
//   - both reject drawdowns that exceed the net stock balance with 409
//   - the net balance (sum of weightKg) decreases by exactly the sold/shipped weight
// Runs against the live dev Postgres (fixtures use randomized codes, cleaned up in afterAll).
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;

let commodityId: string;
let typeAId: string; // graded type with 1000 kg booked stock
let typeBId: string; // graded type with zero stock
let exportContractId: string;

const seededMovementIds: string[] = [];

async function netStock(commodityTypeId: string): Promise<number> {
  const rows = await db
    .select({ weightKg: commodityStockMovementsTable.weightKg })
    .from(commodityStockMovementsTable)
    .where(eq(commodityStockMovementsTable.commodityTypeId, commodityTypeId));
  return rows.reduce((s, r) => s + parseFloat(r.weightKg), 0);
}

beforeAll(async () => {
  server = await startTestServer([salesRouter, exportsRouter]);

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

  // Seed 1000 kg of graded stock for type A (as a grading run would).
  const [seed] = await db
    .insert(commodityStockMovementsTable)
    .values({ commodityTypeId: typeAId, weightKg: "1000.00", movementType: "grading_output", notes: `${tag} seed` })
    .returning();
  seededMovementIds.push(seed.id);

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
});

afterAll(async () => {
  const typeIds = [typeAId, typeBId].filter(Boolean);
  if (typeIds.length) {
    await db.delete(commodityStockMovementsTable).where(inArray(commodityStockMovementsTable.commodityTypeId, typeIds));
  }
  await db.delete(shipmentsTable).where(eq(shipmentsTable.contractId, exportContractId));
  await db.delete(exportContractsTable).where(eq(exportContractsTable.id, exportContractId));
  // Dispatches created through the API reference type A via commodityTypeId.
  await db.delete(dispatchesTable).where(inArray(dispatchesTable.commodityTypeId, typeIds));
  if (typeIds.length) await db.delete(commodityTypesTable).where(inArray(commodityTypesTable.id, typeIds));
  if (commodityId) await db.delete(commoditiesTable).where(eq(commoditiesTable.id, commodityId));
  await server?.close();
});

describe("POST /dispatches — graded stock sale", () => {
  it("records a negative sale_dispatch movement and decreases net stock", async () => {
    const before = await netStock(typeAId);
    const { status, body } = await jsonRequest(`${server.baseUrl}/dispatches`, {
      method: "POST",
      body: { commodityTypeId: typeAId, dispatchWeightKg: 300, driverName: "Test Driver" },
    });
    expect(status).toBe(201);
    expect(body.commodityTypeId).toBe(typeAId);

    const movements = await db
      .select()
      .from(commodityStockMovementsTable)
      .where(eq(commodityStockMovementsTable.dispatchId, body.id));
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe("sale_dispatch");
    expect(parseFloat(movements[0].weightKg)).toBe(-300);

    const after = await netStock(typeAId);
    expect(after).toBeCloseTo(before - 300, 2);
  });

  it("rejects selling more than the available stock with 409 and writes nothing", async () => {
    const before = await netStock(typeAId);
    const { status, body } = await jsonRequest(`${server.baseUrl}/dispatches`, {
      method: "POST",
      body: { commodityTypeId: typeAId, dispatchWeightKg: before + 1 },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/insufficient graded stock/i);
    expect(body.availableKg).toBeCloseTo(before, 2);

    const after = await netStock(typeAId);
    expect(after).toBeCloseTo(before, 2);
    const orphaned = await db
      .select()
      .from(dispatchesTable)
      .where(eq(dispatchesTable.commodityTypeId, typeAId));
    // Only the successful dispatch from the previous test remains — the failed one rolled back.
    expect(orphaned).toHaveLength(1);
  });

  it("rejects a zero-stock commodity type with 409", async () => {
    const { status } = await jsonRequest(`${server.baseUrl}/dispatches`, {
      method: "POST",
      body: { commodityTypeId: typeBId, dispatchWeightKg: 1 },
    });
    expect(status).toBe(409);
  });

  it("requires a positive weight when a commodity type is attached (400)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/dispatches`, {
      method: "POST",
      body: { commodityTypeId: typeAId },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/positive/i);
  });

  it("still creates plain dispatches without stock drawdown", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/dispatches`, {
      method: "POST",
      body: { driverName: `${tag} plain`, dispatchWeightKg: 500 },
    });
    expect(status).toBe(201);
    const movements = await db
      .select()
      .from(commodityStockMovementsTable)
      .where(eq(commodityStockMovementsTable.dispatchId, body.id));
    expect(movements).toHaveLength(0);
    await db.delete(dispatchesTable).where(eq(dispatchesTable.id, body.id));
  });
});

describe("POST /exports/shipments — graded stock export", () => {
  it("records a negative export_shipment movement and decreases net stock", async () => {
    const before = await netStock(typeAId);
    const { status, body } = await jsonRequest(`${server.baseUrl}/exports/shipments`, {
      method: "POST",
      body: { contractId: exportContractId, commodityTypeId: typeAId, totalWeightKg: 250, vesselName: "MV Test" },
    });
    expect(status).toBe(201);
    expect(body.commodityTypeId).toBe(typeAId);

    const movements = await db
      .select()
      .from(commodityStockMovementsTable)
      .where(eq(commodityStockMovementsTable.shipmentId, body.id));
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe("export_shipment");
    expect(parseFloat(movements[0].weightKg)).toBe(-250);

    const after = await netStock(typeAId);
    expect(after).toBeCloseTo(before - 250, 2);
  });

  it("rejects exporting more than the available stock with 409 and rolls back", async () => {
    const before = await netStock(typeAId);
    const { status, body } = await jsonRequest(`${server.baseUrl}/exports/shipments`, {
      method: "POST",
      body: { contractId: exportContractId, commodityTypeId: typeAId, totalWeightKg: before + 5 },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/insufficient graded stock/i);

    const after = await netStock(typeAId);
    expect(after).toBeCloseTo(before, 2);
  });

  it("returns 404 for an unknown export contract", async () => {
    const { status } = await jsonRequest(`${server.baseUrl}/exports/shipments`, {
      method: "POST",
      body: { contractId: "00000000-0000-0000-0000-000000000000", commodityTypeId: typeAId, totalWeightKg: 10 },
    });
    expect(status).toBe(404);
  });

  it("still creates shipments without a commodity type (no drawdown)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/exports/shipments`, {
      method: "POST",
      body: { contractId: exportContractId, totalWeightKg: 100 },
    });
    expect(status).toBe(201);
    const movements = await db
      .select()
      .from(commodityStockMovementsTable)
      .where(eq(commodityStockMovementsTable.shipmentId, body.id));
    expect(movements).toHaveLength(0);
  });

  it("serializes concurrent drawdowns so stock is never oversold", async () => {
    const before = await netStock(typeAId);
    // Two concurrent requests each asking for more than half the remaining stock: at most one may win.
    const ask = Math.floor(before * 0.6);
    const [r1, r2] = await Promise.all([
      jsonRequest(`${server.baseUrl}/dispatches`, { method: "POST", body: { commodityTypeId: typeAId, dispatchWeightKg: ask } }),
      jsonRequest(`${server.baseUrl}/dispatches`, { method: "POST", body: { commodityTypeId: typeAId, dispatchWeightKg: ask } }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const after = await netStock(typeAId);
    expect(after).toBeCloseTo(before - ask, 2);
    expect(after).toBeGreaterThanOrEqual(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  farmersTable,
  suppliersTable,
  deliveriesTable,
  auditLogsTable,
} from "@workspace/db";
import procurementRouter from "./procurement";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Integration coverage for the delivery-capture seller invariant: a delivery
// references EXACTLY ONE of farmerId | supplierId — enforced both by the route
// (API 400) and the DB CHECK delivery_seller_exactly_one. Runs against the live
// dev Postgres, so fixtures use randomized refs and are cleaned up in afterAll.
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;
let farmerId: string;
let activeSupplierId: string;
let inactiveSupplierId: string;
const createdDeliveryIds: string[] = [];

beforeAll(async () => {
  server = await startTestServer([procurementRouter]);

  const [farmer] = await db
    .insert(farmersTable)
    .values({
      referenceNumber: `${tag}_F`,
      firstName: "Test",
      lastName: "Farmer",
      groupId: randomUUID(),
      regionId: randomUUID(),
      registrationStage: "fully_registered",
    })
    .returning();
  farmerId = farmer.id;

  const [activeSupplier] = await db
    .insert(suppliersTable)
    .values({
      referenceNumber: `${tag}_SUP_A`,
      sellerType: "business",
      businessName: `${tag} Active Traders`,
      status: "active",
    })
    .returning();
  activeSupplierId = activeSupplier.id;

  const [inactiveSupplier] = await db
    .insert(suppliersTable)
    .values({
      referenceNumber: `${tag}_SUP_I`,
      sellerType: "business",
      businessName: `${tag} Dormant Traders`,
      status: "inactive",
    })
    .returning();
  inactiveSupplierId = inactiveSupplier.id;
});

afterAll(async () => {
  if (createdDeliveryIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, createdDeliveryIds));
    await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, createdDeliveryIds));
  }
  if (activeSupplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, activeSupplierId));
  if (inactiveSupplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, inactiveSupplierId));
  if (farmerId) await db.delete(farmersTable).where(eq(farmersTable.id, farmerId));
  await server?.close();
});

describe("POST /procurement/deliveries — seller XOR invariant", () => {
  it("rejects a delivery that names BOTH a farmer and a supplier (400)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/procurement/deliveries`, {
      method: "POST",
      body: { farmerId, supplierId: activeSupplierId, cropType: "coffee", weightKg: 100 },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/exactly one/i);
  });

  it("rejects a delivery that names NEITHER a farmer nor a supplier (400)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/procurement/deliveries`, {
      method: "POST",
      body: { cropType: "coffee", weightKg: 100 },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/exactly one/i);
  });

  it("captures a farmer-only delivery (201)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/procurement/deliveries`, {
      method: "POST",
      body: { farmerId, cropType: "coffee", weightKg: 120 },
    });
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.farmerId?.toLowerCase()).toBe(farmerId.toLowerCase());
    expect(body.supplierId).toBeNull();
    createdDeliveryIds.push(body.id);
  });

  it("captures a supplier-only delivery when the supplier is active (201)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/procurement/deliveries`, {
      method: "POST",
      body: { supplierId: activeSupplierId, cropType: "coffee", weightKg: 80 },
    });
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.supplierId?.toLowerCase()).toBe(activeSupplierId.toLowerCase());
    expect(body.farmerId).toBeNull();
    createdDeliveryIds.push(body.id);
  });

  it("refuses a delivery for an inactive supplier (403)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/procurement/deliveries`, {
      method: "POST",
      body: { supplierId: inactiveSupplierId, cropType: "coffee", weightKg: 80 },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("SUPPLIER_NOT_ACTIVE");
  });
});

describe("DB CHECK delivery_seller_exactly_one", () => {
  // The route guards the invariant, but the DB CHECK is the race-safe last word.
  // A raw insert that violates it must be rejected by Postgres regardless of the
  // application layer.
  it("rejects a raw insert naming both a farmer and a supplier", async () => {
    await expect(
      db.insert(deliveriesTable).values({
        lotTag: `${tag}_LOT_BOTH`,
        deliveryNumber: `${tag}_DLV_BOTH`,
        farmerId,
        supplierId: activeSupplierId,
        cropType: "coffee",
        capturedWeightKg: "100",
      }),
    ).rejects.toThrow();
  });

  it("rejects a raw insert naming neither a farmer nor a supplier", async () => {
    await expect(
      db.insert(deliveriesTable).values({
        lotTag: `${tag}_LOT_NONE`,
        deliveryNumber: `${tag}_DLV_NONE`,
        farmerId: null,
        supplierId: null,
        cropType: "coffee",
        capturedWeightKg: "100",
      }),
    ).rejects.toThrow();
  });
});

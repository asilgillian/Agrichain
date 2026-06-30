import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, farmersTable, suppliersTable, auditLogsTable } from "@workspace/db";
import suppliersRouter from "./suppliers";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Coverage for the optional supplier→farmer link: set a valid link, clear it,
// reject a non-existent farmer (400), and reject linking a farmer that is
// already linked to another supplier (409). Live dev Postgres → randomized
// fixtures + cleanup.
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;
let farmerAId: string;
let farmerBId: string;
const supplierIds: string[] = [];

beforeAll(async () => {
  server = await startTestServer([suppliersRouter]);

  const [a] = await db.insert(farmersTable).values({
    referenceNumber: `${tag}_FA`,
    firstName: "Linkable",
    lastName: "FarmerA",
    groupId: randomUUID(),
    regionId: randomUUID(),
    registrationStage: "fully_registered",
  }).returning();
  farmerAId = a.id;

  const [b] = await db.insert(farmersTable).values({
    referenceNumber: `${tag}_FB`,
    firstName: "Linkable",
    lastName: "FarmerB",
    groupId: randomUUID(),
    regionId: randomUUID(),
    registrationStage: "fully_registered",
  }).returning();
  farmerBId = b.id;
});

afterAll(async () => {
  if (supplierIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, supplierIds));
    await db.delete(suppliersTable).where(inArray(suppliersTable.id, supplierIds));
  }
  const farmerIds = [farmerAId, farmerBId].filter(Boolean);
  if (farmerIds.length) await db.delete(farmersTable).where(inArray(farmersTable.id, farmerIds));
  await server?.close();
});

function businessBody(extra: Record<string, unknown> = {}) {
  return { sellerType: "business", businessName: `${tag} Traders`, ...extra };
}

describe("Supplier ↔ farmer link", () => {
  it("creates a supplier linked to an existing farmer (201)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/suppliers`, {
      method: "POST",
      body: businessBody({ farmerId: farmerAId }),
    });
    expect(status).toBe(201);
    expect(body.farmerId).toBe(farmerAId);
    supplierIds.push(body.id);
  });

  it("rejects a link to a non-existent farmer (400)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/suppliers`, {
      method: "POST",
      body: businessBody({ farmerId: randomUUID() }),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/farmer not found/i);
  });

  it("clears the link with farmerId: null (200)", async () => {
    const supplierId = supplierIds[0];
    const { status, body } = await jsonRequest(`${server.baseUrl}/suppliers/${supplierId}`, {
      method: "PATCH",
      body: { farmerId: null },
    });
    expect(status).toBe(200);
    expect(body.farmerId).toBeNull();
  });

  it("rejects linking a farmer already linked to another supplier (409)", async () => {
    // First supplier takes farmer B.
    const first = await jsonRequest(`${server.baseUrl}/suppliers`, {
      method: "POST",
      body: businessBody({ farmerId: farmerBId }),
    });
    expect(first.status).toBe(201);
    supplierIds.push(first.body.id);

    // Second supplier attempts the same farmer → unique violation.
    const second = await jsonRequest(`${server.baseUrl}/suppliers`, {
      method: "POST",
      body: businessBody({ farmerId: farmerBId }),
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already linked to another supplier/i);
    if (second.body?.id) supplierIds.push(second.body.id);
  });
});

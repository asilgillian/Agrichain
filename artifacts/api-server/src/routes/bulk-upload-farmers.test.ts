import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db, farmersTable } from "@workspace/db";
import adminRouter from "./admin";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Integration coverage for bulk-uploaded farmer reference numbers:
//   - references follow FARM-YYYY-XXXXXX
//   - two concurrent uploads both succeed with distinct reference numbers (retry on 23505, no
//     failed rows from a reference-number collision)
// Runs against the live dev Postgres; all fixtures are cleaned up in afterAll.
// Note: farmers.groupId/regionId have no FK constraints, so random UUIDs suffice as anchors.
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;
const createdFarmerIds: string[] = [];

beforeAll(async () => {
  server = await startTestServer([adminRouter]);
});

afterAll(async () => {
  if (createdFarmerIds.length) {
    await db.delete(farmersTable).where(inArray(farmersTable.id, createdFarmerIds));
  }
  await server?.close();
});

function farmerRow(n: number) {
  return {
    firstName: `${tag} First${n}`,
    lastName: `Last${n}`,
    nationalId: `${tag}_NIN_${n}`,
    groupId: "00000000-0000-4000-8000-000000000010",
    regionId: "00000000-0000-4000-8000-000000000011",
  };
}

describe("POST /admin/bulk-upload (farmers) — reference numbering", () => {
  it("survives concurrent farmer uploads with distinct reference numbers (no failed rows)", async () => {
    // Two uploads fired at the same instant must both succeed; a reference-number collision is
    // retried with a regenerated number instead of failing the row.
    const results = await Promise.all([
      jsonRequest(`${server.baseUrl}/admin/bulk-upload`, {
        method: "POST",
        body: { entityType: "farmers", rows: [farmerRow(1)] },
      }),
      jsonRequest(`${server.baseUrl}/admin/bulk-upload`, {
        method: "POST",
        body: { entityType: "farmers", rows: [farmerRow(2)] },
      }),
    ]);

    const refs: string[] = [];
    for (const r of results) {
      expect(r.status).toBe(201);
      expect(r.body.errorCount).toBe(0);
      expect(r.body.createdCount).toBe(1);
      const farmer = r.body.created[0];
      expect(farmer.referenceNumber).toMatch(/^FARM-\d{4}-[A-Z0-9]{6}$/);
      refs.push(farmer.referenceNumber);
      createdFarmerIds.push(farmer.id);
    }
    expect(refs[0]).not.toBe(refs[1]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, and } from "drizzle-orm";
import { db, farmersTable, auditLogsTable } from "@workspace/db";
import farmersRouter from "./farmers";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Coverage for the entrepreneur upgrade gate: only fully/partially registered
// farmers may be flagged as entrepreneurs (pre-registered → 409), and a
// successful upgrade is audited. Live dev Postgres → randomized fixtures + cleanup.
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;
let registeredFarmerId: string;
let preRegisteredFarmerId: string;

beforeAll(async () => {
  server = await startTestServer([farmersRouter]);

  const [registered] = await db
    .insert(farmersTable)
    .values({
      referenceNumber: `${tag}_REG`,
      firstName: "Reg",
      lastName: "Farmer",
      groupId: randomUUID(),
      regionId: randomUUID(),
      registrationStage: "fully_registered",
    })
    .returning();
  registeredFarmerId = registered.id;

  const [pre] = await db
    .insert(farmersTable)
    .values({
      referenceNumber: `${tag}_PRE`,
      firstName: "Pre",
      lastName: "Farmer",
      groupId: randomUUID(),
      regionId: randomUUID(),
      registrationStage: "pre_registered",
    })
    .returning();
  preRegisteredFarmerId = pre.id;
});

afterAll(async () => {
  const ids = [registeredFarmerId, preRegisteredFarmerId].filter(Boolean);
  if (ids.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, ids));
    await db.delete(farmersTable).where(inArray(farmersTable.id, ids));
  }
  await server?.close();
});

describe("POST /farmers/:id/entrepreneur — registration gate", () => {
  it("rejects marking a PRE-REGISTERED farmer as an entrepreneur (409)", async () => {
    const { status, body } = await jsonRequest(
      `${server.baseUrl}/farmers/${preRegisteredFarmerId}/entrepreneur`,
      { method: "POST" },
    );
    expect(status).toBe(409);
    expect(body.error).toMatch(/registered farmers/i);

    const [row] = await db.select().from(farmersTable).where(eq(farmersTable.id, preRegisteredFarmerId));
    expect(row.isEntrepreneur).toBe(false);
  });

  it("marks a REGISTERED farmer as an entrepreneur and writes an audit row (200)", async () => {
    const { status, body } = await jsonRequest(
      `${server.baseUrl}/farmers/${registeredFarmerId}/entrepreneur`,
      { method: "POST" },
    );
    expect(status).toBe(200);
    expect(body.isEntrepreneur).toBe(true);

    const [row] = await db.select().from(farmersTable).where(eq(farmersTable.id, registeredFarmerId));
    expect(row.isEntrepreneur).toBe(true);
    expect(row.entrepreneurSince).not.toBeNull();

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.entityId, registeredFarmerId),
        eq(auditLogsTable.action, "farmer.entrepreneur.upgrade"),
      ));
    expect(audits.length).toBeGreaterThan(0);
  });

  it("removes the entrepreneur flag and audits it (200)", async () => {
    const { status, body } = await jsonRequest(
      `${server.baseUrl}/farmers/${registeredFarmerId}/entrepreneur`,
      { method: "DELETE" },
    );
    expect(status).toBe(200);
    expect(body.isEntrepreneur).toBe(false);

    const [row] = await db.select().from(farmersTable).where(eq(farmersTable.id, registeredFarmerId));
    expect(row.isEntrepreneur).toBe(false);
    expect(row.entrepreneurSince).toBeNull();
  });
});

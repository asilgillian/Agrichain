import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  commoditiesTable,
  commodityTypesTable,
  samplesTable,
  usersTable,
  auditLogsTable,
} from "@workspace/db";
import samplesRouter from "./samples";
import { startTestServer, jsonRequest, adminUser, type TestServer } from "../test-helpers/test-server";

// Integration coverage for sample creation + code numbering:
//   - codes follow SMP-YYYY-NNNNNN and increment from the highest existing suffix
//   - two concurrent creations both succeed with distinct codes (retry on 23505, no 500)
// Runs against the live dev Postgres; all fixtures are cleaned up in afterAll.
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;

let commodityId: string;
let typeId: string;
let collectorUserId: string;
const createdSampleIds: string[] = [];

beforeAll(async () => {
  server = await startTestServer([samplesRouter]);

  // samples.collector_id has an FK to users, so the authed test user must exist as a real row.
  const [user] = await db.insert(usersTable)
    .values({ firstName: `${tag}`, lastName: "Collector", email: `${tag}@example.com`, role: "SystemAdministrator" })
    .returning();
  collectorUserId = user.id;
  server.setUser(adminUser({ id: collectorUserId }));

  const [commodity] = await db.insert(commoditiesTable).values({ name: `${tag} Coffee`, code: `${tag}_COF` }).returning();
  commodityId = commodity.id;

  const [type] = await db.insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} Cherry`, code: `${tag}_CHY`, stage: "raw" }).returning();
  typeId = type.id;
});

afterAll(async () => {
  if (createdSampleIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, createdSampleIds));
    await db.delete(samplesTable).where(inArray(samplesTable.id, createdSampleIds));
  }
  if (typeId) await db.delete(commodityTypesTable).where(eq(commodityTypesTable.id, typeId));
  if (commodityId) await db.delete(commoditiesTable).where(eq(commoditiesTable.id, commodityId));
  if (collectorUserId) await db.delete(usersTable).where(eq(usersTable.id, collectorUserId));
  await server?.close();
});

// A minimal valid field-stage sample body (field stage must link to a farmer).
function sampleBody() {
  return {
    commodityTypeId: typeId,
    stage: "field",
    linkedEntityType: "farmer",
    linkedEntityId: "00000000-0000-4000-8000-000000000001",
    samplingMethod: "grab",
    collectionDate: new Date().toISOString(),
  };
}

describe("POST /samples — code numbering", () => {
  it("assigns SMP-YYYY-NNNNNN codes that increment (201)", async () => {
    const first = await jsonRequest(`${server.baseUrl}/samples`, { method: "POST", body: sampleBody() });
    expect(first.status).toBe(201);
    createdSampleIds.push(first.body.id);

    const second = await jsonRequest(`${server.baseUrl}/samples`, { method: "POST", body: sampleBody() });
    expect(second.status).toBe(201);
    createdSampleIds.push(second.body.id);

    const re = /^SMP-(\d{4})-(\d{6})$/;
    expect(first.body.sampleCode).toMatch(re);
    expect(second.body.sampleCode).toMatch(re);

    const [, year1, seq1] = re.exec(first.body.sampleCode)!;
    const [, year2, seq2] = re.exec(second.body.sampleCode)!;
    expect(year2).toBe(year1);
    expect(Number(seq2)).toBe(Number(seq1) + 1);
  });

  it("survives concurrent sample creations with distinct codes (no 500)", async () => {
    // Two samples fired at the same instant compute the same per-year suffix; without retry the
    // second insert would violate samples_code_uniq and return a 500. Both must now succeed.
    const results = await Promise.all([
      jsonRequest(`${server.baseUrl}/samples`, { method: "POST", body: sampleBody() }),
      jsonRequest(`${server.baseUrl}/samples`, { method: "POST", body: sampleBody() }),
    ]);

    for (const r of results) {
      expect(r.status).toBe(201);
      createdSampleIds.push(r.body.id);
    }

    const re = /^SMP-\d{4}-\d{6}$/;
    const [a, b] = results;
    expect(a.body.sampleCode).toMatch(re);
    expect(b.body.sampleCode).toMatch(re);
    expect(a.body.sampleCode).not.toBe(b.body.sampleCode);
  });
});

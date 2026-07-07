import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  silosTable,
  siloBatchesTable,
  commoditiesTable,
  commodityTypesTable,
  gradingProfilesTable,
  gradingProfileOutputsTable,
  gradingRunsTable,
  gradingRunOutputsTable,
  commodityStockMovementsTable,
  auditLogsTable,
} from "@workspace/db";
import siloBatchesRouter from "./silo-batches";
import gradingRouter from "./grading";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Integration coverage for launching grading runs from a silo batch:
//   - creating a silo + silo batch (auto SB-YYYYMMDD-XXXXX number)
//   - a fresh batch reports availableWeightKg == inputWeightKg
//   - grading a batch draws down its available weight (available = input − Σ run.inputWeightKg)
//   - a batch's remaining available weight cannot be over-consumed conceptually (available floors at 0)
//   - the grading run records the siloBatchId link and lists siloBatchNumber
// Runs against the live dev Postgres; all fixtures are cleaned up in afterAll.
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;

let commodityId: string;
let inputTypeId: string;
let sellableA: string;

const createdProfileIds: string[] = [];
const createdRunIds: string[] = [];
const createdSiloIds: string[] = [];
const createdBatchIds: string[] = [];
let profileId: string;
let outputAId: string;

beforeAll(async () => {
  server = await startTestServer([siloBatchesRouter, gradingRouter]);

  const [commodity] = await db.insert(commoditiesTable).values({ name: `${tag} Coffee`, code: `${tag}_COF` }).returning();
  commodityId = commodity.id;

  const [input] = await db.insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} FAQ Green`, code: `${tag}_FAQ`, stage: "intermediate" }).returning();
  inputTypeId = input.id;

  const [a] = await db.insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} Screen 18`, code: `${tag}_S18`, stage: "finished" }).returning();
  sellableA = a.id;

  // A grading profile whose only sellable output maps to sellableA; loss makes up the rest.
  const { status, body } = await jsonRequest(`${server.baseUrl}/grading-profiles`, {
    method: "POST",
    body: {
      name: `${tag} Coffee Grading`,
      inputCommodityTypeId: inputTypeId,
      outputs: [
        { outputCommodityTypeId: sellableA, expectedYieldPct: 80, isSellable: true },
        { label: "Process loss", expectedYieldPct: 20, isSellable: false },
      ],
    },
  });
  expect(status).toBe(201);
  profileId = body.id;
  createdProfileIds.push(profileId);
  outputAId = body.outputs.find((o: any) => o.outputCommodityTypeId?.toLowerCase() === sellableA.toLowerCase()).id;
});

afterAll(async () => {
  if (createdRunIds.length) {
    await db.delete(commodityStockMovementsTable).where(inArray(commodityStockMovementsTable.gradingRunId, createdRunIds));
    await db.delete(gradingRunOutputsTable).where(inArray(gradingRunOutputsTable.gradingRunId, createdRunIds));
    await db.delete(gradingRunsTable).where(inArray(gradingRunsTable.id, createdRunIds));
  }
  if (createdProfileIds.length) {
    await db.delete(gradingProfileOutputsTable).where(inArray(gradingProfileOutputsTable.gradingProfileId, createdProfileIds));
    await db.delete(gradingProfilesTable).where(inArray(gradingProfilesTable.id, createdProfileIds));
  }
  if (createdBatchIds.length) await db.delete(siloBatchesTable).where(inArray(siloBatchesTable.id, createdBatchIds));
  if (createdSiloIds.length) await db.delete(silosTable).where(inArray(silosTable.id, createdSiloIds));
  const typeIds = [inputTypeId, sellableA].filter(Boolean);
  if (typeIds.length) await db.delete(commodityTypesTable).where(inArray(commodityTypesTable.id, typeIds));
  if (commodityId) await db.delete(commoditiesTable).where(eq(commoditiesTable.id, commodityId));
  const auditIds = [...createdProfileIds, ...createdRunIds, ...createdBatchIds, ...createdSiloIds];
  if (auditIds.length) await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, auditIds));
  await server?.close();
});

async function createSilo() {
  const { status, body } = await jsonRequest(`${server.baseUrl}/silos`, {
    method: "POST",
    body: { name: `${tag} Silo`, stream: "Organic", commodityType: "Coffee" },
  });
  expect(status).toBe(201);
  createdSiloIds.push(body.id);
  return body;
}

async function createBatch(siloId: string, inputWeightKg: number) {
  const { status, body } = await jsonRequest(`${server.baseUrl}/silo-batches`, {
    method: "POST",
    body: { siloId, inputWeightKg },
  });
  expect(status).toBe(201);
  createdBatchIds.push(body.id);
  return body;
}

describe("POST /silo-batches — creation + available weight", () => {
  it("auto-assigns an SB-YYYYMMDD-XXXXX number and defaults streams to the silo stream", async () => {
    const silo = await createSilo();
    const batch = await createBatch(silo.id, 1000);
    expect(batch.batchNumber).toMatch(/^SB-\d{8}-\d{5}$/);
    expect(batch.siloName).toBe(`${tag} Silo`);
    expect(batch.streams).toEqual(["Organic"]);
    // A fresh batch has consumed nothing → available == input.
    expect(Number(batch.availableWeightKg)).toBeCloseTo(1000, 2);
    expect(Number(batch.consumedWeightKg)).toBeCloseTo(0, 2);
  });

  it("rejects a non-positive input weight (400)", async () => {
    const silo = await createSilo();
    const { status, body } = await jsonRequest(`${server.baseUrl}/silo-batches`, {
      method: "POST",
      body: { siloId: silo.id, inputWeightKg: 0 },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/positive number/i);
  });

  it("survives concurrent batch creations with distinct batch numbers (no 500)", async () => {
    // Two batches fired at the same instant compute the same per-day suffix; without retry the
    // second insert would violate the batch_number unique constraint and return a 500.
    const silo = await createSilo();
    const results = await Promise.all([
      jsonRequest(`${server.baseUrl}/silo-batches`, { method: "POST", body: { siloId: silo.id, inputWeightKg: 100 } }),
      jsonRequest(`${server.baseUrl}/silo-batches`, { method: "POST", body: { siloId: silo.id, inputWeightKg: 200 } }),
    ]);

    for (const r of results) {
      expect(r.status).toBe(201);
      createdBatchIds.push(r.body.id);
    }

    const re = /^SB-\d{8}-\d{5}$/;
    const [a, b] = results;
    expect(a.body.batchNumber).toMatch(re);
    expect(b.body.batchNumber).toMatch(re);
    expect(a.body.batchNumber).not.toBe(b.body.batchNumber);
  });
});

describe("Grading from a silo batch draws down available weight", () => {
  it("records siloBatchId and reduces availableWeightKg by the run input", async () => {
    const silo = await createSilo();
    const batch = await createBatch(silo.id, 500);

    // Grade 300kg of the 500kg batch.
    const run = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        siloBatchId: batch.id,
        inputWeightKg: 300,
        outputs: [{ gradingProfileOutputId: outputAId, actualWeightKg: 240 }],
      },
    });
    expect(run.status).toBe(201);
    createdRunIds.push(run.body.id);
    expect(run.body.siloBatchId?.toLowerCase()).toBe(batch.id.toLowerCase());

    // The batch now reports 200kg available (500 − 300 consumed).
    const detail = await jsonRequest(`${server.baseUrl}/silo-batches/${batch.id}`, { method: "GET" });
    expect(detail.status).toBe(200);
    expect(Number(detail.body.consumedWeightKg)).toBeCloseTo(300, 2);
    expect(Number(detail.body.availableWeightKg)).toBeCloseTo(200, 2);

    // A second run consuming the remaining 200kg floors available at 0.
    const run2 = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        siloBatchId: batch.id,
        inputWeightKg: 200,
        outputs: [{ gradingProfileOutputId: outputAId, actualWeightKg: 160 }],
      },
    });
    expect(run2.status).toBe(201);
    createdRunIds.push(run2.body.id);

    const detail2 = await jsonRequest(`${server.baseUrl}/silo-batches/${batch.id}`, { method: "GET" });
    expect(Number(detail2.body.consumedWeightKg)).toBeCloseTo(500, 2);
    expect(Number(detail2.body.availableWeightKg)).toBeCloseTo(0, 2);
  });

  it("lists grading runs filtered by silo batch with the batch number attached", async () => {
    const silo = await createSilo();
    const batch = await createBatch(silo.id, 100);
    const run = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        siloBatchId: batch.id,
        inputWeightKg: 100,
        outputs: [{ gradingProfileOutputId: outputAId, actualWeightKg: 80 }],
      },
    });
    expect(run.status).toBe(201);
    createdRunIds.push(run.body.id);

    const list = await jsonRequest(`${server.baseUrl}/grading-runs?siloBatchId=${batch.id}`, { method: "GET" });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(run.body.id);
    expect(list.body[0].siloBatchNumber).toBe(batch.batchNumber);
  });
});

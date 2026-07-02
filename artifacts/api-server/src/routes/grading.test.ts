import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  commoditiesTable,
  commodityTypesTable,
  gradingProfilesTable,
  gradingProfileOutputsTable,
  gradingRunsTable,
  gradingRunOutputsTable,
  auditLogsTable,
} from "@workspace/db";
import gradingRouter from "./grading";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Integration coverage for the grading math + validation invariants:
//   - profile expected yields must sum to ~100%
//   - sellable grades require an output commodity type
//   - every output commodity type must share the input type's commodity
//   - a run's graded outputs may not exceed the input weight
//   - loss = input − sum(graded outputs); variance = actual% − expected%
//   - run numbers follow GRD-YYYYMMDD-XXXXX
// Runs against the live dev Postgres (fixtures use randomized codes, cleaned up in afterAll).
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;

let commodityId: string; // Coffee (input + sellable outputs live here)
let otherCommodityId: string; // Maize (foreign output type)
let inputTypeId: string;
let sellableA: string;
let sellableB: string;
let foreignTypeId: string; // belongs to otherCommodity

const createdProfileIds: string[] = [];
const createdRunIds: string[] = [];

beforeAll(async () => {
  server = await startTestServer([gradingRouter]);

  const [commodity] = await db
    .insert(commoditiesTable)
    .values({ name: `${tag} Coffee`, code: `${tag}_COF` })
    .returning();
  commodityId = commodity.id;

  const [otherCommodity] = await db
    .insert(commoditiesTable)
    .values({ name: `${tag} Maize`, code: `${tag}_MAZ` })
    .returning();
  otherCommodityId = otherCommodity.id;

  const [input] = await db
    .insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} FAQ Green`, code: `${tag}_FAQ`, stage: "intermediate" })
    .returning();
  inputTypeId = input.id;

  const [a] = await db
    .insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} Screen 18`, code: `${tag}_S18`, stage: "finished" })
    .returning();
  sellableA = a.id;

  const [b] = await db
    .insert(commodityTypesTable)
    .values({ commodityId, name: `${tag} Screen 15`, code: `${tag}_S15`, stage: "finished" })
    .returning();
  sellableB = b.id;

  const [foreign] = await db
    .insert(commodityTypesTable)
    .values({ commodityId: otherCommodityId, name: `${tag} Maize Grade A`, code: `${tag}_MGA`, stage: "finished" })
    .returning();
  foreignTypeId = foreign.id;
});

afterAll(async () => {
  if (createdRunIds.length) {
    await db.delete(gradingRunOutputsTable).where(inArray(gradingRunOutputsTable.gradingRunId, createdRunIds));
    await db.delete(gradingRunsTable).where(inArray(gradingRunsTable.id, createdRunIds));
  }
  if (createdProfileIds.length) {
    await db.delete(gradingProfileOutputsTable).where(inArray(gradingProfileOutputsTable.gradingProfileId, createdProfileIds));
    await db.delete(gradingProfilesTable).where(inArray(gradingProfilesTable.id, createdProfileIds));
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, [...createdProfileIds, ...createdRunIds]));
  }
  const typeIds = [inputTypeId, sellableA, sellableB, foreignTypeId].filter(Boolean);
  if (typeIds.length) await db.delete(commodityTypesTable).where(inArray(commodityTypesTable.id, typeIds));
  const commIds = [commodityId, otherCommodityId].filter(Boolean);
  if (commIds.length) await db.delete(commoditiesTable).where(inArray(commoditiesTable.id, commIds));
  await server?.close();
});

// A well-formed 3-output profile body (60/30/10, sums to 100). Callers tweak fields for negatives.
function validProfileBody() {
  return {
    name: `${tag} Coffee Grading`,
    inputCommodityTypeId: inputTypeId,
    outputs: [
      { outputCommodityTypeId: sellableA, expectedYieldPct: 60, isSellable: true },
      { outputCommodityTypeId: sellableB, expectedYieldPct: 30, isSellable: true },
      { label: "Process loss", expectedYieldPct: 10, isSellable: false },
    ],
  };
}

describe("POST /grading-profiles — validation", () => {
  it("rejects expected yields that do not sum to ~100% (400)", async () => {
    const body = validProfileBody();
    body.outputs[0].expectedYieldPct = 40; // 40 + 30 + 10 = 80
    const { status, body: res } = await jsonRequest(`${server.baseUrl}/grading-profiles`, {
      method: "POST",
      body,
    });
    expect(status).toBe(400);
    expect(res.error).toMatch(/sum to ~100%/i);
  });

  it("rejects a sellable grade with no output commodity type (400)", async () => {
    const body = validProfileBody();
    // Drop the commodity type from the first sellable row; keep sums at 100.
    (body.outputs[0] as Record<string, unknown>).outputCommodityTypeId = undefined;
    const { status, body: res } = await jsonRequest(`${server.baseUrl}/grading-profiles`, {
      method: "POST",
      body,
    });
    expect(status).toBe(400);
    expect(res.error).toMatch(/sellable grades require a valid outputCommodityTypeId/i);
  });

  it("rejects an output commodity type from a different commodity (400)", async () => {
    const body = validProfileBody();
    body.outputs[0].outputCommodityTypeId = foreignTypeId; // Maize grade under a Coffee input
    const { status, body: res } = await jsonRequest(`${server.baseUrl}/grading-profiles`, {
      method: "POST",
      body,
    });
    expect(status).toBe(400);
    expect(res.error).toMatch(/same commodity as the input/i);
  });

  it("creates a valid profile (201) with a small float-drift tolerance", async () => {
    const body = validProfileBody();
    // 59.9 + 30 + 10 = 99.9 → within the ±0.5 tolerance band.
    body.outputs[0].expectedYieldPct = 59.9;
    const { status, body: res } = await jsonRequest(`${server.baseUrl}/grading-profiles`, {
      method: "POST",
      body,
    });
    expect(status).toBe(201);
    expect(res.id).toBeTruthy();
    expect(res.outputs).toHaveLength(3);
    createdProfileIds.push(res.id);
  });
});

describe("POST /grading-runs — math + numbering", () => {
  let profileId: string;
  let outputIds: { a: string; b: string; loss: string };

  beforeAll(async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-profiles`, {
      method: "POST",
      body: validProfileBody(),
    });
    expect(status).toBe(201);
    profileId = body.id;
    createdProfileIds.push(profileId);
    outputIds = {
      a: body.outputs.find((o: any) => o.outputCommodityTypeId?.toLowerCase() === sellableA.toLowerCase()).id,
      b: body.outputs.find((o: any) => o.outputCommodityTypeId?.toLowerCase() === sellableB.toLowerCase()).id,
      loss: body.outputs.find((o: any) => !o.isSellable).id,
    };
  });

  it("rejects graded outputs that exceed the input weight (400)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        inputWeightKg: 100,
        outputs: [
          { gradingProfileOutputId: outputIds.a, actualWeightKg: 70 },
          { gradingProfileOutputId: outputIds.b, actualWeightKg: 45 }, // 115 > 100
        ],
      },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/cannot exceed input/i);
  });

  it("rejects a non-positive input weight (400)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        inputWeightKg: 0,
        outputs: [{ gradingProfileOutputId: outputIds.a, actualWeightKg: 0 }],
      },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/positive number/i);
  });

  it("computes loss and per-grade variance correctly (201)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        inputWeightKg: 100,
        outputs: [
          { gradingProfileOutputId: outputIds.a, actualWeightKg: 66 }, // expected 60% → +6
          { gradingProfileOutputId: outputIds.b, actualWeightKg: 24 }, // expected 30% → -6
        ],
      },
    });
    expect(status).toBe(201);
    createdRunIds.push(body.id);

    // loss = input − sum(graded) = 100 − 90 = 10; lossPct = 10%.
    expect(Number(body.totalOutputKg)).toBeCloseTo(90, 2);
    expect(Number(body.lossKg)).toBeCloseTo(10, 2);
    expect(Number(body.lossPct)).toBeCloseTo(10, 3);

    const byId = new Map<string, any>(body.outputs.map((o: any) => [o.gradingProfileOutputId, o]));
    const a = byId.get(outputIds.a);
    const b = byId.get(outputIds.b);
    const loss = byId.get(outputIds.loss);

    // variance = actual% − expected%
    expect(Number(a.actualYieldPct)).toBeCloseTo(66, 3);
    expect(Number(a.variancePct)).toBeCloseTo(6, 3);
    expect(Number(b.actualYieldPct)).toBeCloseTo(24, 3);
    expect(Number(b.variancePct)).toBeCloseTo(-6, 3);
    // The loss row got no submitted weight → actual 0%, variance = 0 − 10 = −10.
    expect(Number(loss.actualWeightKg)).toBeCloseTo(0, 2);
    expect(Number(loss.variancePct)).toBeCloseTo(-10, 3);
  });

  it("assigns GRD-YYYYMMDD-XXXXX run numbers that increment (201)", async () => {
    const first = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        inputWeightKg: 50,
        outputs: [{ gradingProfileOutputId: outputIds.a, actualWeightKg: 30 }],
      },
    });
    expect(first.status).toBe(201);
    createdRunIds.push(first.body.id);

    const second = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        inputWeightKg: 50,
        outputs: [{ gradingProfileOutputId: outputIds.a, actualWeightKg: 30 }],
      },
    });
    expect(second.status).toBe(201);
    createdRunIds.push(second.body.id);

    const re = /^GRD-(\d{8})-(\d{5})$/;
    expect(first.body.runNumber).toMatch(re);
    expect(second.body.runNumber).toMatch(re);

    const [, day1, seq1] = re.exec(first.body.runNumber)!;
    const [, day2, seq2] = re.exec(second.body.runNumber)!;
    expect(day2).toBe(day1);
    expect(Number(seq2)).toBe(Number(seq1) + 1);
  });
});

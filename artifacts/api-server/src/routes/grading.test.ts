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
  commodityStockMovementsTable,
  auditLogsTable,
} from "@workspace/db";
import gradingRouter from "./grading";
import warehouseRouter from "./warehouse";
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
  server = await startTestServer([gradingRouter, warehouseRouter]);

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
    await db.delete(commodityStockMovementsTable).where(inArray(commodityStockMovementsTable.gradingRunId, createdRunIds));
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

  it("survives concurrent run creations with distinct run numbers (no 500)", async () => {
    // Two runs fired at the same instant compute the same per-day suffix; without retry the second
    // insert would violate grading_runs_run_number_uniq and return a 500. Both must now succeed.
    const makeBody = () => ({
      gradingProfileId: profileId,
      inputWeightKg: 40,
      outputs: [{ gradingProfileOutputId: outputIds.a, actualWeightKg: 20 }],
    });

    const results = await Promise.all([
      jsonRequest(`${server.baseUrl}/grading-runs`, { method: "POST", body: makeBody() }),
      jsonRequest(`${server.baseUrl}/grading-runs`, { method: "POST", body: makeBody() }),
    ]);

    for (const r of results) {
      expect(r.status).toBe(201);
      createdRunIds.push(r.body.id);
    }

    const re = /^GRD-(\d{8})-(\d{5})$/;
    const [a, b] = results;
    expect(a.body.runNumber).toMatch(re);
    expect(b.body.runNumber).toMatch(re);
    // Distinct run numbers despite the concurrent creation.
    expect(a.body.runNumber).not.toBe(b.body.runNumber);
  });
});

describe("POST /grading-runs — books commodity stock movements", () => {
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

  it("draws down the input and books each sellable output as stock; excludes loss (201)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        inputWeightKg: 200,
        outputs: [
          { gradingProfileOutputId: outputIds.a, actualWeightKg: 120 }, // sellable A
          { gradingProfileOutputId: outputIds.b, actualWeightKg: 60 },  // sellable B
          // loss row left unsubmitted → 0 kg, must NOT create a movement
        ],
      },
    });
    expect(status).toBe(201);
    createdRunIds.push(body.id);

    const movements = await db
      .select()
      .from(commodityStockMovementsTable)
      .where(eq(commodityStockMovementsTable.gradingRunId, body.id));

    // One negative input movement + two positive sellable outputs = 3 rows (loss excluded).
    expect(movements).toHaveLength(3);

    const input = movements.find(m => m.movementType === "grading_input")!;
    expect(input).toBeTruthy();
    expect(input.commodityTypeId.toLowerCase()).toBe(inputTypeId.toLowerCase());
    expect(Number(input.weightKg)).toBeCloseTo(-200, 2); // drawn down

    const outputs = movements.filter(m => m.movementType === "grading_output");
    expect(outputs).toHaveLength(2);

    const a = outputs.find(m => m.commodityTypeId.toLowerCase() === sellableA.toLowerCase())!;
    const b = outputs.find(m => m.commodityTypeId.toLowerCase() === sellableB.toLowerCase())!;
    expect(Number(a.weightKg)).toBeCloseTo(120, 2); // booked in
    expect(Number(b.weightKg)).toBeCloseTo(60, 2);

    // No movement should reference the (zero-weight) loss commodity — loss has no commodity type.
    expect(outputs.every(m => m.gradingRunOutputId !== outputIds.loss)).toBe(true);
  });
});

describe("DELETE /grading-runs/:runId — void a run and reverse its stock", () => {
  let profileId: string;
  let outputIds: { a: string; b: string };

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
    };
  });

  async function netStock(typeId: string): Promise<number> {
    const rows = await db
      .select()
      .from(commodityStockMovementsTable)
      .where(eq(commodityStockMovementsTable.commodityTypeId, typeId));
    return rows.reduce((s, r) => s + Number(r.weightKg), 0);
  }

  async function createRun(inputKg: number, aKg: number, bKg: number) {
    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: profileId,
        inputWeightKg: inputKg,
        outputs: [
          { gradingProfileOutputId: outputIds.a, actualWeightKg: aKg },
          { gradingProfileOutputId: outputIds.b, actualWeightKg: bKg },
        ],
      },
    });
    expect(status).toBe(201);
    return body;
  }

  it("returns 404 for an unknown run", async () => {
    const { status } = await jsonRequest(
      `${server.baseUrl}/grading-runs/00000000-0000-4000-8000-000000000000`,
      { method: "DELETE" },
    );
    expect(status).toBe(404);
  });

  it("voids a run: movements reversed, stock returns to pre-run values, run + outputs gone, audited", async () => {
    const beforeInput = await netStock(inputTypeId);
    const beforeA = await netStock(sellableA);
    const beforeB = await netStock(sellableB);

    const run = await createRun(100, 60, 30);

    // Sanity: run booked movements.
    expect(await netStock(inputTypeId)).toBeCloseTo(beforeInput - 100, 2);
    expect(await netStock(sellableA)).toBeCloseTo(beforeA + 60, 2);

    const { status } = await jsonRequest(`${server.baseUrl}/grading-runs/${run.id}`, { method: "DELETE" });
    expect(status).toBe(204);

    // Stock figures are back to their pre-run values.
    expect(await netStock(inputTypeId)).toBeCloseTo(beforeInput, 2);
    expect(await netStock(sellableA)).toBeCloseTo(beforeA, 2);
    expect(await netStock(sellableB)).toBeCloseTo(beforeB, 2);

    // Run, outputs, and movements are gone.
    const runs = await db.select().from(gradingRunsTable).where(eq(gradingRunsTable.id, run.id));
    expect(runs).toHaveLength(0);
    const outs = await db.select().from(gradingRunOutputsTable).where(eq(gradingRunOutputsTable.gradingRunId, run.id));
    expect(outs).toHaveLength(0);
    const movs = await db.select().from(commodityStockMovementsTable).where(eq(commodityStockMovementsTable.gradingRunId, run.id));
    expect(movs).toHaveLength(0);

    // Audit trail records the void with a full before-snapshot.
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.entityId, run.id));
    const del = logs.find(l => l.action === "grading_run.delete");
    expect(del).toBeTruthy();
    expect((del!.before as any).run.runNumber).toBe(run.runNumber);
    expect((del!.before as any).movements.length).toBeGreaterThan(0);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, run.id));

    // GET now 404s.
    const after = await jsonRequest(`${server.baseUrl}/grading-runs/${run.id}`, { method: "GET" });
    expect(after.status).toBe(404);
  });

  it("blocks the void (409) when graded output stock was already consumed downstream", async () => {
    const run = await createRun(100, 50, 40);
    createdRunIds.push(run.id);

    // Simulate a downstream dispatch consuming ALL of sellable A stock.
    const currentA = await netStock(sellableA);
    const [drawdown] = await db.insert(commodityStockMovementsTable).values({
      commodityTypeId: sellableA,
      weightKg: (-currentA).toFixed(2),
      movementType: "sale_dispatch",
      notes: `${tag} simulated dispatch`,
    }).returning();

    try {
      const { status, body } = await jsonRequest(`${server.baseUrl}/grading-runs/${run.id}`, { method: "DELETE" });
      expect(status).toBe(409);
      expect(body.error).toMatch(/already been consumed/i);

      // Nothing was deleted.
      const runs = await db.select().from(gradingRunsTable).where(eq(gradingRunsTable.id, run.id));
      expect(runs).toHaveLength(1);
      const movs = await db.select().from(commodityStockMovementsTable).where(eq(commodityStockMovementsTable.gradingRunId, run.id));
      expect(movs.length).toBeGreaterThan(0);

      // Once the drawdown is removed, the void succeeds.
      await db.delete(commodityStockMovementsTable).where(eq(commodityStockMovementsTable.id, drawdown.id));
      const retry = await jsonRequest(`${server.baseUrl}/grading-runs/${run.id}`, { method: "DELETE" });
      expect(retry.status).toBe(204);
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, run.id));
    } finally {
      await db.delete(commodityStockMovementsTable).where(eq(commodityStockMovementsTable.id, drawdown.id)).catch(() => {});
    }
  });
});

describe("GET /warehouse/mass-balance — commodityStock nets across repeated grading runs", () => {
  // Block-local fixtures so the aggregated nets start from a clean zero baseline —
  // the shared types above already accumulate movements from earlier tests.
  let mbCommodityId: string;
  let mbInputTypeId: string;
  let mbSellableX: string;
  let mbSellableY: string;
  let mbProfileId: string;
  let mbOutputIds: { x: string; y: string };
  const mbRunIds: string[] = [];

  beforeAll(async () => {
    const [commodity] = await db
      .insert(commoditiesTable)
      .values({ name: `${tag} MB Cocoa`, code: `${tag}_MBC` })
      .returning();
    mbCommodityId = commodity.id;

    const [input] = await db
      .insert(commodityTypesTable)
      .values({ commodityId: mbCommodityId, name: `${tag} MB Wet Beans`, code: `${tag}_MBW`, stage: "intermediate" })
      .returning();
    mbInputTypeId = input.id;

    const [x] = await db
      .insert(commodityTypesTable)
      .values({ commodityId: mbCommodityId, name: `${tag} MB Grade X`, code: `${tag}_MBX`, stage: "finished" })
      .returning();
    mbSellableX = x.id;

    const [y] = await db
      .insert(commodityTypesTable)
      .values({ commodityId: mbCommodityId, name: `${tag} MB Grade Y`, code: `${tag}_MBY`, stage: "finished" })
      .returning();
    mbSellableY = y.id;

    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-profiles`, {
      method: "POST",
      body: {
        name: `${tag} MB Cocoa Grading`,
        inputCommodityTypeId: mbInputTypeId,
        outputs: [
          { outputCommodityTypeId: mbSellableX, expectedYieldPct: 60, isSellable: true },
          { outputCommodityTypeId: mbSellableY, expectedYieldPct: 30, isSellable: true },
          { label: "Process loss", expectedYieldPct: 10, isSellable: false },
        ],
      },
    });
    expect(status).toBe(201);
    mbProfileId = body.id;
    mbOutputIds = {
      x: body.outputs.find((o: any) => o.outputCommodityTypeId?.toLowerCase() === mbSellableX.toLowerCase()).id,
      y: body.outputs.find((o: any) => o.outputCommodityTypeId?.toLowerCase() === mbSellableY.toLowerCase()).id,
    };
  });

  afterAll(async () => {
    // Clean up everything block-local in dependency order (movements → outputs → runs → profile → types → commodity).
    if (mbRunIds.length) {
      await db.delete(commodityStockMovementsTable).where(inArray(commodityStockMovementsTable.gradingRunId, mbRunIds));
      await db.delete(gradingRunOutputsTable).where(inArray(gradingRunOutputsTable.gradingRunId, mbRunIds));
      await db.delete(gradingRunsTable).where(inArray(gradingRunsTable.id, mbRunIds));
    }
    if (mbProfileId) {
      await db.delete(gradingProfileOutputsTable).where(eq(gradingProfileOutputsTable.gradingProfileId, mbProfileId));
      await db.delete(gradingProfilesTable).where(eq(gradingProfilesTable.id, mbProfileId));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, [mbProfileId, ...mbRunIds]));
    }
    const typeIds = [mbInputTypeId, mbSellableX, mbSellableY].filter(Boolean);
    if (typeIds.length) await db.delete(commodityTypesTable).where(inArray(commodityTypesTable.id, typeIds));
    if (mbCommodityId) await db.delete(commoditiesTable).where(eq(commoditiesTable.id, mbCommodityId));
  });

  async function createRun(inputKg: number, xKg: number, yKg: number) {
    const { status, body } = await jsonRequest(`${server.baseUrl}/grading-runs`, {
      method: "POST",
      body: {
        gradingProfileId: mbProfileId,
        inputWeightKg: inputKg,
        outputs: [
          { gradingProfileOutputId: mbOutputIds.x, actualWeightKg: xKg },
          { gradingProfileOutputId: mbOutputIds.y, actualWeightKg: yKg },
        ],
      },
    });
    expect(status).toBe(201);
    mbRunIds.push(body.id);
    return body;
  }

  async function fetchStockRows() {
    const { status, body } = await jsonRequest(`${server.baseUrl}/warehouse/mass-balance`);
    expect(status).toBe(200);
    const rows: any[] = body.commodityStock;
    expect(Array.isArray(rows)).toBe(true);
    const byType = new Map<string, any>(rows.map(r => [String(r.commodityTypeId).toLowerCase(), r]));
    return byType;
  }

  it("nets input drawdown and sellable outputs correctly after one run", async () => {
    await createRun(100, 60, 30);

    const byType = await fetchStockRows();
    const input = byType.get(mbInputTypeId.toLowerCase())!;
    const x = byType.get(mbSellableX.toLowerCase())!;
    const y = byType.get(mbSellableY.toLowerCase())!;

    expect(input).toBeTruthy();
    expect(x).toBeTruthy();
    expect(y).toBeTruthy();

    // Nothing was ever booked INTO the input type here, so its net goes negative.
    expect(input.netStockKg).toBeCloseTo(-100, 2);
    expect(x.netStockKg).toBeCloseTo(60, 2);
    expect(y.netStockKg).toBeCloseTo(30, 2);

    // Rows carry the joined display names.
    expect(input.commodityTypeName).toBe(`${tag} MB Wet Beans`);
    expect(input.commodityName).toBe(`${tag} MB Cocoa`);
    expect(x.commodityTypeName).toBe(`${tag} MB Grade X`);
  });

  it("accumulates across a second run on the same input type: drawdown deepens, outputs sum", async () => {
    await createRun(200, 110, 70);

    const byType = await fetchStockRows();
    // Input drawdown accumulates: -100 + -200 = -300 (net negative deepens).
    expect(byType.get(mbInputTypeId.toLowerCase())!.netStockKg).toBeCloseTo(-300, 2);
    // Sellable outputs sum across both runs: 60+110 and 30+70.
    expect(byType.get(mbSellableX.toLowerCase())!.netStockKg).toBeCloseTo(170, 2);
    expect(byType.get(mbSellableY.toLowerCase())!.netStockKg).toBeCloseTo(100, 2);
  });

  it("voiding one run rolls the aggregated nets back to the single-run figures", async () => {
    const third = await createRun(50, 30, 15);

    let byType = await fetchStockRows();
    expect(byType.get(mbInputTypeId.toLowerCase())!.netStockKg).toBeCloseTo(-350, 2);
    expect(byType.get(mbSellableX.toLowerCase())!.netStockKg).toBeCloseTo(200, 2);

    const { status } = await jsonRequest(`${server.baseUrl}/grading-runs/${third.id}`, { method: "DELETE" });
    expect(status).toBe(204);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, third.id));

    byType = await fetchStockRows();
    expect(byType.get(mbInputTypeId.toLowerCase())!.netStockKg).toBeCloseTo(-300, 2);
    expect(byType.get(mbSellableX.toLowerCase())!.netStockKg).toBeCloseTo(170, 2);
    expect(byType.get(mbSellableY.toLowerCase())!.netStockKg).toBeCloseTo(100, 2);
  });
});

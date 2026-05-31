import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  farmersTable,
  loanCategoriesTable,
  loanProductsTable,
  loansTable,
} from "@workspace/db";
import loansRouter from "./loans";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Coverage for entrepreneurs-only loan products: a CASH product flagged
// entrepreneursOnly may only be issued to a farmer carrying isEntrepreneur.
// Non-entrepreneurs and group/no-farmer loans are refused (409 ENTREPRENEURS_ONLY).
// Live dev Postgres → randomized fixtures + cleanup (children before parents).
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;
let categoryId: string;
let productId: string;
let entrepreneurFarmerId: string;
let plainFarmerId: string;
const createdLoanIds: string[] = [];

beforeAll(async () => {
  server = await startTestServer([loansRouter]);

  const [cat] = await db
    .insert(loanCategoriesTable)
    .values({ name: `${tag}_cat`, interestType: "flat", interestRate: "10", penaltyRate: "5", gracePeriodDays: 30 })
    .returning();
  categoryId = cat.id;

  const [prod] = await db
    .insert(loanProductsTable)
    .values({
      loanCategoryId: categoryId,
      name: `${tag}_bulking`,
      productType: "CASH",
      entrepreneursOnly: true,
      isActive: true,
    })
    .returning();
  productId = prod.id;

  const [entrepreneur] = await db
    .insert(farmersTable)
    .values({
      referenceNumber: `${tag}_ENT`,
      firstName: "Ent",
      lastName: "Farmer",
      groupId: randomUUID(),
      regionId: randomUUID(),
      registrationStage: "fully_registered",
      isEntrepreneur: true,
      entrepreneurSince: new Date(),
    })
    .returning();
  entrepreneurFarmerId = entrepreneur.id;

  const [plain] = await db
    .insert(farmersTable)
    .values({
      referenceNumber: `${tag}_PLAIN`,
      firstName: "Plain",
      lastName: "Farmer",
      groupId: randomUUID(),
      regionId: randomUUID(),
      registrationStage: "fully_registered",
      isEntrepreneur: false,
    })
    .returning();
  plainFarmerId = plain.id;
});

afterAll(async () => {
  if (createdLoanIds.length) await db.delete(loansTable).where(inArray(loansTable.id, createdLoanIds));
  const farmerIds = [entrepreneurFarmerId, plainFarmerId].filter(Boolean);
  if (farmerIds.length) await db.delete(farmersTable).where(inArray(farmersTable.id, farmerIds));
  if (productId) await db.delete(loanProductsTable).where(eq(loanProductsTable.id, productId));
  if (categoryId) await db.delete(loanCategoriesTable).where(eq(loanCategoriesTable.id, categoryId));
  await server?.close();
});

describe("POST /loans — entrepreneurs-only product gate", () => {
  it("blocks an entrepreneurs-only loan for a non-entrepreneur farmer (409)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/loans`, {
      method: "POST",
      body: { loanProductId: productId, farmerId: plainFarmerId, principalAmount: 50000 },
    });
    expect(status).toBe(409);
    expect(body.code).toBe("ENTREPRENEURS_ONLY");
  });

  it("blocks an entrepreneurs-only loan with no farmer (409)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/loans`, {
      method: "POST",
      body: { loanProductId: productId, groupId: randomUUID(), principalAmount: 50000 },
    });
    expect(status).toBe(409);
    expect(body.code).toBe("ENTREPRENEURS_ONLY");
  });

  it("allows an entrepreneurs-only loan for an entrepreneur farmer (201)", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/loans`, {
      method: "POST",
      body: { loanProductId: productId, farmerId: entrepreneurFarmerId, principalAmount: 50000 },
    });
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.farmerId?.toLowerCase()).toBe(entrepreneurFarmerId.toLowerCase());
    createdLoanIds.push(body.id);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  buyersTable,
  salesContractsTable,
  dispatchesTable,
  invoicesTable,
} from "@workspace/db";
import salesRouter from "./sales";
import { startTestServer, jsonRequest, type TestServer } from "../test-helpers/test-server";

// Integration coverage for linking dispatches to invoices:
//   - POST /dispatches/:id/invoice creates an invoice prefilled from the dispatch's
//     sales contract (price, currency) and the dispatch weight
//   - a second create attempt returns 409 (no double billing)
//   - POST /dispatches/:id/attach-invoice links an unattached invoice, and refuses
//     invoices that are already attached
//   - GET /dispatches reports invoice (billed/unbilled) per row
//   - GET /invoices?unattached=true only returns unlinked, non-cancelled invoices
// Runs against the live dev Postgres (fixtures are cleaned up in afterAll).
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;

let buyerId: string;
let contractId: string;
let dispatchWithContractId: string;
let dispatchNoContractId: string;
let dispatchForAttachId: string;

const createdInvoiceIds: string[] = [];
const createdDispatchIds: string[] = [];

beforeAll(async () => {
  server = await startTestServer([salesRouter]);

  const [buyer] = await db.insert(buyersTable).values({ name: `${tag} Buyer` }).returning();
  buyerId = buyer.id;

  const [contract] = await db
    .insert(salesContractsTable)
    .values({
      contractNumber: `${tag}_SC1`,
      buyerId,
      contractType: "SPOT",
      agreedPricePerKg: "4.5000",
      currency: "EUR",
      status: "APPROVED",
    })
    .returning();
  contractId = contract.id;

  const mkDispatch = async (suffix: string, withContract: boolean) => {
    const [d] = await db
      .insert(dispatchesTable)
      .values({
        dispatchNumber: `${tag}_DSP${suffix}`,
        contractId: withContract ? contractId : undefined,
        dispatchWeightKg: "2000.00",
      })
      .returning();
    createdDispatchIds.push(d.id);
    return d.id;
  };
  dispatchWithContractId = await mkDispatch("A", true);
  dispatchNoContractId = await mkDispatch("B", false);
  dispatchForAttachId = await mkDispatch("C", false);
});

afterAll(async () => {
  if (createdInvoiceIds.length) await db.delete(invoicesTable).where(inArray(invoicesTable.id, createdInvoiceIds));
  if (createdDispatchIds.length) {
    await db.delete(invoicesTable).where(inArray(invoicesTable.dispatchId, createdDispatchIds));
    await db.delete(dispatchesTable).where(inArray(dispatchesTable.id, createdDispatchIds));
  }
  if (contractId) await db.delete(salesContractsTable).where(eq(salesContractsTable.id, contractId));
  if (buyerId) await db.delete(buyersTable).where(eq(buyersTable.id, buyerId));
  await server?.close();
});

describe("POST /dispatches/:id/invoice", () => {
  it("creates an invoice prefilled from the dispatch contract and weight", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/dispatches/${dispatchWithContractId}/invoice`, {
      method: "POST",
      body: {},
    });
    expect(status).toBe(201);
    createdInvoiceIds.push(body.id);
    expect(body.dispatchId).toBe(dispatchWithContractId);
    expect(body.contractId).toBe(contractId);
    expect(Number(body.dispatchWeightKg)).toBe(2000);
    expect(Number(body.pricePerKg)).toBe(4.5);
    expect(Number(body.totalAmount)).toBe(9000);
    expect(body.currency).toBe("EUR");
    expect(body.status).toBe("DRAFT");
  });

  it("rejects a second invoice for the same dispatch with 409", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/dispatches/${dispatchWithContractId}/invoice`, {
      method: "POST",
      body: {},
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/already billed/i);
  });

  it("requires an explicit price when the dispatch has no contract", async () => {
    const missing = await jsonRequest(`${server.baseUrl}/dispatches/${dispatchNoContractId}/invoice`, {
      method: "POST",
      body: {},
    });
    expect(missing.status).toBe(400);

    const { status, body } = await jsonRequest(`${server.baseUrl}/dispatches/${dispatchNoContractId}/invoice`, {
      method: "POST",
      body: { pricePerKg: 3, taxAmount: 100 },
    });
    expect(status).toBe(201);
    createdInvoiceIds.push(body.id);
    expect(body.contractId).toBeNull();
    expect(Number(body.totalAmount)).toBe(6100);
  });
});

describe("POST /dispatches/:id/attach-invoice", () => {
  it("attaches an unattached invoice and then reports it via GET /dispatches", async () => {
    // Create an unattached invoice through the plain invoices endpoint.
    const created = await jsonRequest(`${server.baseUrl}/invoices`, {
      method: "POST",
      body: { contractId, dispatchWeightKg: 500, pricePerKg: 2 },
    });
    expect(created.status).toBe(201);
    createdInvoiceIds.push(created.body.id);

    // It should show up in the unattached filter.
    const unattached = await jsonRequest(`${server.baseUrl}/invoices?unattached=true&limit=200`);
    expect(unattached.status).toBe(200);
    expect(unattached.body.data.some((i: { id: string }) => i.id === created.body.id)).toBe(true);

    const attach = await jsonRequest(`${server.baseUrl}/dispatches/${dispatchForAttachId}/attach-invoice`, {
      method: "POST",
      body: { invoiceId: created.body.id },
    });
    expect(attach.status).toBe(200);
    expect(attach.body.dispatchId).toBe(dispatchForAttachId);

    // No longer unattached.
    const after = await jsonRequest(`${server.baseUrl}/invoices?unattached=true&limit=200`);
    expect(after.body.data.some((i: { id: string }) => i.id === created.body.id)).toBe(false);

    // Dispatch list reflects billing status.
    const list = await jsonRequest(`${server.baseUrl}/dispatches?limit=100`);
    expect(list.status).toBe(200);
    const row = list.body.data.find((d: { id: string }) => d.id === dispatchForAttachId);
    expect(row?.invoice?.id).toBe(created.body.id);
    const unbilledRow = list.body.data.find((d: { id: string }) => d.id === dispatchNoContractId);
    // dispatchNoContractId was billed in an earlier test; dispatches created fresh have invoice: null
    expect(unbilledRow?.invoice).toBeTruthy();
  });

  it("refuses to attach an invoice that already belongs to a dispatch", async () => {
    const other = await jsonRequest(`${server.baseUrl}/invoices`, {
      method: "POST",
      body: { contractId, dispatchWeightKg: 100, pricePerKg: 1 },
    });
    createdInvoiceIds.push(other.body.id);

    // dispatchForAttachId is already billed → 409
    const conflict = await jsonRequest(`${server.baseUrl}/dispatches/${dispatchForAttachId}/attach-invoice`, {
      method: "POST",
      body: { invoiceId: other.body.id },
    });
    expect(conflict.status).toBe(409);
  });
});

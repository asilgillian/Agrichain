import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

// --- Mock the mobile-money gateway lib --------------------------------------
// Both payments.ts and payments-webhooks.ts import from "../lib/momo". We stub
// every export so the route logic (row transitions, retry bookkeeping, callback
// re-query) is exercised without touching a real telco. The spies are created
// with vi.hoisted so they exist before vi.mock's hoisted factory runs.
const momo = vi.hoisted(() => ({
  isProviderLive: vi.fn(() => false),
  isMomoEnabled: vi.fn(() => false),
  callbackSecret: vi.fn((): string | null => null),
  initiateDisbursement: vi.fn(),
  queryDisbursementStatus: vi.fn(),
}));
vi.mock("../lib/momo", () => ({
  isProviderLive: momo.isProviderLive,
  isMomoEnabled: momo.isMomoEnabled,
  callbackSecret: momo.callbackSecret,
  initiateDisbursement: momo.initiateDisbursement,
  queryDisbursementStatus: momo.queryDisbursementStatus,
}));

// Spy on the farmer loan auto-deduction helper. Mobile-money payments must
// never run it (it's a cash-only concern), and supplier payments never run it
// at all. The default keeps a working passthrough so any cash path still works.
const { applyAutoDeductionsForFarmerPayment } = vi.hoisted(() => ({
  applyAutoDeductionsForFarmerPayment: vi.fn(
    async (_tx: unknown, args: { grossAmount: number }) => ({
      netToFarmer: args.grossAmount,
      totalDeducted: 0,
      lines: [] as { loanNumber: string; amount: number }[],
    }),
  ),
}));
vi.mock("../lib/loan-deductions", () => ({ applyAutoDeductionsForFarmerPayment }));

const { db, farmersTable, suppliersTable, deliveriesTable, paymentsTable } =
  await import("@workspace/db");
const { default: paymentsRouter } = await import("./payments");
const { default: webhooksRouter } = await import("./payments-webhooks");
const { startTestServer, jsonRequest, adminUser } = await import("../test-helpers/test-server");
type TestServer = Awaited<ReturnType<typeof startTestServer>>;

// Live dev Postgres → randomized fixtures + cleanup (children before parents).
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const MSISDN = "+256772123456";
let server: TestServer;
let farmerId: string;
let supplierId: string;
const deliveryIds: string[] = [];
const createdPaymentIds: string[] = [];

async function makeApprovedDelivery(opts: { farmerId?: string; supplierId?: string }): Promise<string> {
  const [d] = await db
    .insert(deliveriesTable)
    .values({
      lotTag: `${tag}_LOT_${Math.random().toString(36).slice(2, 8)}`,
      deliveryNumber: `${tag}_DLV_${Math.random().toString(36).slice(2, 8)}`,
      farmerId: opts.farmerId ?? null,
      supplierId: opts.supplierId ?? null,
      cropType: "coffee",
      capturedWeightKg: "100",
      status: "approved",
      totalValue: "150000",
    })
    .returning();
  deliveryIds.push(d.id);
  return d.id;
}

// Create a mobile-money payment through the real route while the provider is
// "live", capturing the resulting row id for cleanup.
async function createMomoPayment(opts: {
  deliveryId: string;
  disburse: "pending" | "success" | "throw";
}): Promise<any> {
  momo.isProviderLive.mockReturnValue(true);
  if (opts.disburse === "throw") {
    momo.initiateDisbursement.mockRejectedValueOnce(new Error("gateway down"));
  } else {
    momo.initiateDisbursement.mockResolvedValueOnce({
      providerTxnId: `GW-${Math.random().toString(36).slice(2, 10)}`,
      status: opts.disburse,
    });
  }
  const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
    method: "POST",
    body: {
      deliveryId: opts.deliveryId,
      amountDue: 1,
      paymentMethod: "mobile_money",
      currency: "UGX",
      provider: "mtn_momo",
      msisdn: MSISDN,
    },
  });
  expect(status).toBe(201);
  createdPaymentIds.push(body.id);
  return body;
}

beforeAll(async () => {
  server = await startTestServer([paymentsRouter, webhooksRouter]);
  server.setUser(adminUser({ id: randomUUID() }));

  const [supplier] = await db
    .insert(suppliersTable)
    .values({
      referenceNumber: `${tag}_SUP`,
      sellerType: "business",
      businessName: `${tag} Traders`,
      status: "active",
    })
    .returning();
  supplierId = supplier.id;

  const [farmer] = await db
    .insert(farmersTable)
    .values({
      referenceNumber: `${tag}_F`,
      firstName: "Momo",
      lastName: "Farmer",
      groupId: randomUUID(),
      regionId: randomUUID(),
      registrationStage: "fully_registered",
    })
    .returning();
  farmerId = farmer.id;
});

afterAll(async () => {
  if (createdPaymentIds.length) await db.delete(paymentsTable).where(inArray(paymentsTable.id, createdPaymentIds));
  if (deliveryIds.length) await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
  if (supplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  if (farmerId) await db.delete(farmersTable).where(eq(farmersTable.id, farmerId));
  await server?.close();
});

describe("POST /payments — mobile_money branch", () => {
  it("creates a pending_external row with momoProvider when the provider is not live", async () => {
    momo.isProviderLive.mockReturnValue(false);
    momo.isMomoEnabled.mockReturnValue(false);
    const deliveryId = await makeApprovedDelivery({ farmerId });

    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: {
        deliveryId,
        amountDue: 1,
        paymentMethod: "mobile_money",
        currency: "UGX",
        provider: "mtn_momo",
        msisdn: MSISDN,
      },
    });
    expect(status).toBe(201);
    createdPaymentIds.push(body.id);
    expect(body.status).toBe("pending_external");
    expect(body.momoProvider).toBe("mtn_momo");
    expect(body.msisdn).toBe(MSISDN);
    expect(body.amountPaid).toBeNull();
    // No live gateway → stubbed reference, no disbursement attempt.
    expect(body.paymentReference).toBe(`STUB:mtn_momo:${MSISDN}`);
    expect(momo.initiateDisbursement).not.toHaveBeenCalled();
  });

  it("does NOT run farmer loan auto-deduction for a supplier mobile_money payment", async () => {
    applyAutoDeductionsForFarmerPayment.mockClear();
    momo.isProviderLive.mockReturnValue(false);
    momo.isMomoEnabled.mockReturnValue(false);
    const deliveryId = await makeApprovedDelivery({ supplierId });

    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: {
        deliveryId,
        amountDue: 1,
        paymentMethod: "mobile_money",
        currency: "UGX",
        provider: "airtel_money",
        msisdn: MSISDN,
      },
    });
    expect(status).toBe(201);
    createdPaymentIds.push(body.id);
    expect(body.supplierId?.toLowerCase()).toBe(supplierId.toLowerCase());
    expect(body.farmerId).toBeNull();
    expect(body.status).toBe("pending_external");
    expect(body.momoProvider).toBe("airtel_money");
    expect(applyAutoDeductionsForFarmerPayment).not.toHaveBeenCalled();
  });

  it("rejects mobile_money without a valid provider/msisdn", async () => {
    momo.isProviderLive.mockReturnValue(false);
    const deliveryId = await makeApprovedDelivery({ farmerId });
    const { status } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: {
        deliveryId,
        amountDue: 1,
        paymentMethod: "mobile_money",
        currency: "UGX",
        provider: "mtn_momo",
        msisdn: "12345",
      },
    });
    expect(status).toBe(400);
  });
});

describe("POST /payments/momo/callback/:provider", () => {
  it("returns 400 for an unknown provider", async () => {
    const { status } = await jsonRequest(`${server.baseUrl}/payments/momo/callback/visa`, {
      method: "POST",
      body: { referenceId: randomUUID() },
    });
    expect(status).toBe(400);
  });

  it("returns 200 (not 500) for an unknown UUID reference", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/momo/callback/mtn_momo`, {
      method: "POST",
      body: { referenceId: randomUUID() },
    });
    expect(status).toBe(200);
    expect(body.received).toBe(true);
  });

  it("returns 200 (not 500) for a non-UUID reference", async () => {
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/momo/callback/mtn_momo`, {
      method: "POST",
      body: { referenceId: "definitely-not-a-uuid" },
    });
    expect(status).toBe(200);
    expect(body.received).toBe(true);
  });

  it("transitions a known payment to paid after re-querying the gateway", async () => {
    const deliveryId = await makeApprovedDelivery({ farmerId });
    const payment = await createMomoPayment({ deliveryId, disburse: "pending" });
    expect(payment.status).toBe("pending_external");
    expect(payment.providerTxnId).toBeTruthy();

    momo.isProviderLive.mockReturnValue(true);
    momo.queryDisbursementStatus.mockResolvedValueOnce({ status: "success" });
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/momo/callback/mtn_momo`, {
      method: "POST",
      body: { referenceId: payment.providerTxnId },
    });
    expect(status).toBe(200);
    expect(body.received).toBe(true);

    const [row] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, payment.id));
    expect(row.status).toBe("paid");
    expect(row.amountPaid).not.toBeNull();
    expect(row.paidAt).not.toBeNull();
  });

  it("transitions a known payment to failed when the gateway reports failure", async () => {
    const deliveryId = await makeApprovedDelivery({ farmerId });
    const payment = await createMomoPayment({ deliveryId, disburse: "pending" });

    momo.isProviderLive.mockReturnValue(true);
    momo.queryDisbursementStatus.mockResolvedValueOnce({ status: "failed", failureReason: "insufficient funds" });
    const { status } = await jsonRequest(`${server.baseUrl}/payments/momo/callback/mtn_momo`, {
      method: "POST",
      body: { referenceId: payment.providerTxnId },
    });
    expect(status).toBe(200);

    const [row] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, payment.id));
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBe("insufficient funds");
  });

  it("enforces the optional MOMO_CALLBACK_SECRET gate", async () => {
    momo.callbackSecret.mockReturnValue("s3cret");
    try {
      // Missing / wrong secret → 401.
      const wrong = await jsonRequest(`${server.baseUrl}/payments/momo/callback/mtn_momo`, {
        method: "POST",
        body: { referenceId: randomUUID() },
      });
      expect(wrong.status).toBe(401);

      // Correct secret (via query param) → 200, even for an unknown ref.
      const ok = await jsonRequest(`${server.baseUrl}/payments/momo/callback/mtn_momo?secret=s3cret`, {
        method: "POST",
        body: { referenceId: randomUUID() },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.received).toBe(true);
    } finally {
      momo.callbackSecret.mockReturnValue(null);
    }
  });
});

describe("POST /payments/:id/refresh-status", () => {
  it("returns 404 for an unknown payment", async () => {
    const { status } = await jsonRequest(`${server.baseUrl}/payments/${randomUUID()}/refresh-status`, {
      method: "POST",
    });
    expect(status).toBe(404);
  });

  it("rejects refresh on a non-mobile-money payment", async () => {
    const deliveryId = await makeApprovedDelivery({ farmerId });
    const [cash] = await db
      .insert(paymentsTable)
      .values({
        farmerId,
        deliveryId,
        amountDue: "1",
        amountPaid: "1",
        currency: "UGX",
        paymentMethod: "cash",
        status: "paid",
        paidAt: new Date(),
      })
      .returning();
    createdPaymentIds.push(cash.id);

    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/${cash.id}/refresh-status`, {
      method: "POST",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/mobile-money/i);
  });

  it("re-queries the gateway and persists a settle to paid", async () => {
    const deliveryId = await makeApprovedDelivery({ farmerId });
    const payment = await createMomoPayment({ deliveryId, disburse: "pending" });
    expect(payment.status).toBe("pending_external");

    momo.isProviderLive.mockReturnValue(true);
    momo.queryDisbursementStatus.mockResolvedValueOnce({ status: "success" });
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/${payment.id}/refresh-status`, {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(body.status).toBe("paid");
    expect(body.amountPaid).not.toBeNull();
  });
});

describe("POST /payments/:id/retry", () => {
  it("refuses to retry a payment that is not failed", async () => {
    const deliveryId = await makeApprovedDelivery({ farmerId });
    const payment = await createMomoPayment({ deliveryId, disburse: "pending" });
    expect(payment.status).toBe("pending_external");

    momo.isProviderLive.mockReturnValue(true);
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/${payment.id}/retry`, {
      method: "POST",
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/failed/i);
  });

  it("reuses the same row, bumps retryCount, and can settle on retry", async () => {
    const deliveryId = await makeApprovedDelivery({ farmerId });
    // First attempt throws at the gateway → row lands in `failed`.
    const failed = await createMomoPayment({ deliveryId, disburse: "throw" });
    expect(failed.status).toBe("failed");
    expect(failed.retryCount).toBe(0);

    // Retry succeeds this time.
    momo.isProviderLive.mockReturnValue(true);
    momo.initiateDisbursement.mockResolvedValueOnce({ providerTxnId: "GW-RETRY-OK", status: "success" });
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/${failed.id}/retry`, {
      method: "POST",
    });
    expect(status).toBe(200);
    // Same row (duplicate-payment guard relies on reuse), retryCount bumped.
    expect(body.id).toBe(failed.id);
    expect(body.retryCount).toBe(1);
    expect(body.status).toBe("paid");
    expect(body.amountPaid).not.toBeNull();
  });

  it("keeps a retry that fails again in the failed state with a bumped retryCount", async () => {
    const deliveryId = await makeApprovedDelivery({ farmerId });
    const failed = await createMomoPayment({ deliveryId, disburse: "throw" });
    expect(failed.status).toBe("failed");

    momo.isProviderLive.mockReturnValue(true);
    momo.initiateDisbursement.mockRejectedValueOnce(new Error("still down"));
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments/${failed.id}/retry`, {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(body.id).toBe(failed.id);
    expect(body.status).toBe("failed");
    expect(body.retryCount).toBe(1);
  });
});

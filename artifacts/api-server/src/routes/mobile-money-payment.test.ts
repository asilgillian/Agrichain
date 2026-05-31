import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

// Mock the mobile-money gateway module so we can deterministically flip the
// "provider is live" / MOMO_ENABLED state and assert WHETHER a real
// disbursement is attempted — without any live telco credentials.
//   - momoState.live === false  → stub path: row stays pending_external, no
//     gateway call (this is the default, MOMO_ENABLED-off behaviour).
//   - momoState.live === true   → live path: initiateDisbursement is fired.
// vi.hoisted ensures the spies exist before vi.mock's hoisted factory runs.
const {
  momoState,
  initiateDisbursement,
  queryDisbursementStatus,
  isProviderLive,
  isMomoEnabled,
} = vi.hoisted(() => {
  const momoState = { live: false, enabled: false };
  return {
    momoState,
    initiateDisbursement: vi.fn(async (_args: unknown) => ({
      providerTxnId: "TXN-TEST-123",
      status: "pending" as const,
    })),
    queryDisbursementStatus: vi.fn(),
    isProviderLive: vi.fn((_p: string) => momoState.live),
    isMomoEnabled: vi.fn(() => momoState.enabled),
  };
});
vi.mock("../lib/momo", () => ({
  initiateDisbursement,
  queryDisbursementStatus,
  isProviderLive,
  isMomoEnabled,
}));

const {
  db,
  farmersTable,
  deliveriesTable,
  paymentsTable,
  agentCashFloatsTable,
  cashFloatTransactionsTable,
} = await import("@workspace/db");
const { default: paymentsRouter } = await import("./payments");
const { startTestServer, jsonRequest, adminUser } = await import("../test-helpers/test-server");
type TestServer = Awaited<ReturnType<typeof startTestServer>>;

// Live dev Postgres → randomized fixtures + cleanup (children before parents).
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let server: TestServer;
const agentId = randomUUID();
let floatId: string;
let farmerId: string;
const deliveryIds: string[] = [];
const createdPaymentIds: string[] = [];

const VALID_MSISDN = "+256772123456";

async function makeApprovedDelivery(): Promise<string> {
  const [d] = await db
    .insert(deliveriesTable)
    .values({
      lotTag: `${tag}_LOT_${Math.random().toString(36).slice(2, 8)}`,
      deliveryNumber: `${tag}_DLV_${Math.random().toString(36).slice(2, 8)}`,
      farmerId,
      cropType: "coffee",
      capturedWeightKg: "100",
      status: "approved",
      totalValue: "150000",
    })
    .returning();
  deliveryIds.push(d.id);
  return d.id;
}

async function floatBalance(): Promise<number> {
  const [f] = await db.select().from(agentCashFloatsTable).where(eq(agentCashFloatsTable.id, floatId));
  return Number(f.currentBalance);
}

beforeAll(async () => {
  server = await startTestServer([paymentsRouter]);
  // The cash float belongs to the authenticated agent — make the test user that agent.
  server.setUser(adminUser({ id: agentId }));

  const [float] = await db
    .insert(agentCashFloatsTable)
    .values({ agentId, currentBalance: "1000000", currency: "UGX" })
    .returning();
  floatId = float.id;

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
  if (floatId) await db.delete(cashFloatTransactionsTable).where(eq(cashFloatTransactionsTable.floatId, floatId));
  if (deliveryIds.length) await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
  if (floatId) await db.delete(agentCashFloatsTable).where(eq(agentCashFloatsTable.id, floatId));
  if (farmerId) await db.delete(farmersTable).where(eq(farmersTable.id, farmerId));
  await server?.close();
});

describe("POST /payments — mobile-money validation", () => {
  it("rejects a mobile-money payment with no provider (400)", async () => {
    const deliveryId = await makeApprovedDelivery();
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: { deliveryId, amountDue: 1, paymentMethod: "mobile_money", currency: "UGX", msisdn: VALID_MSISDN },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/provider/i);
    expect(initiateDisbursement).not.toHaveBeenCalled();
  });

  it("rejects a mobile-money payment with an unknown provider (400)", async () => {
    const deliveryId = await makeApprovedDelivery();
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: { deliveryId, amountDue: 1, paymentMethod: "mobile_money", currency: "UGX", provider: "vodafone", msisdn: VALID_MSISDN },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/provider/i);
  });

  it("rejects a mobile-money payment with a missing msisdn (400)", async () => {
    const deliveryId = await makeApprovedDelivery();
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: { deliveryId, amountDue: 1, paymentMethod: "mobile_money", currency: "UGX", provider: "mtn_momo" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/msisdn/i);
  });

  it("rejects a mobile-money payment with a malformed msisdn (400)", async () => {
    const deliveryId = await makeApprovedDelivery();
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: { deliveryId, amountDue: 1, paymentMethod: "mobile_money", currency: "UGX", provider: "mtn_momo", msisdn: "12345" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/msisdn/i);
  });
});

describe("POST /payments — mobile-money disbursement", () => {
  it("records a valid payment as pending_external WITHOUT moving the cash float (MOMO disabled)", async () => {
    momoState.live = false;
    momoState.enabled = false;
    initiateDisbursement.mockClear();
    const deliveryId = await makeApprovedDelivery();
    const before = await floatBalance();

    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: { deliveryId, amountDue: 1, paymentMethod: "mobile_money", currency: "UGX", provider: "mtn_momo", msisdn: VALID_MSISDN },
    });

    expect(status).toBe(201);
    expect(body.status).toBe("pending_external");
    expect(body.paymentMethod).toBe("mobile_money");
    expect(body.momoProvider).toBe("mtn_momo");
    // Nothing settled yet → no amountPaid.
    expect(body.amountPaid).toBeNull();
    // Authoritative amount comes from the delivery total, not the client.
    expect(body.amountDue).toBe(150000);
    // Provider isn't live → stubbed reference, no gateway call.
    expect(body.paymentReference).toMatch(/^STUB:mtn_momo:/);
    expect(initiateDisbursement).not.toHaveBeenCalled();
    // Mobile money must never touch the agent's cash float.
    expect(await floatBalance()).toBe(before);
    createdPaymentIds.push(body.id);
  });

  it("attempts a live disbursement when the provider is live (MOMO_ENABLED + configured)", async () => {
    momoState.live = true;
    momoState.enabled = true;
    initiateDisbursement.mockClear();
    const deliveryId = await makeApprovedDelivery();
    const before = await floatBalance();

    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: { deliveryId, amountDue: 1, paymentMethod: "mobile_money", currency: "UGX", provider: "airtel_money", msisdn: VALID_MSISDN },
    });

    expect(status).toBe(201);
    // Gateway accepted but not settled → still pending_external, with the real txn id.
    expect(body.status).toBe("pending_external");
    expect(body.paymentReference).toBe("TXN-TEST-123");
    expect(initiateDisbursement).toHaveBeenCalledTimes(1);
    const callArg = initiateDisbursement.mock.calls[0]?.[0] as { provider: string; msisdn: string; amount: number };
    expect(callArg.provider).toBe("airtel_money");
    expect(callArg.amount).toBe(150000);
    // Still no cash float impact on the live path either.
    expect(await floatBalance()).toBe(before);
    createdPaymentIds.push(body.id);

    momoState.live = false;
    momoState.enabled = false;
  });
});

describe("POST /payments — mobile-money permission gating", () => {
  it("rejects a mobile-money payment when the user lacks payments.disburse.momo (403)", async () => {
    const deliveryId = await makeApprovedDelivery();
    // A user that can write payments but is NOT allowed to disburse via momo.
    server.setUser(
      adminUser({
        id: agentId,
        role: "Cashier",
        roles: ["Cashier"],
        permissions: ["payments.read", "payments.write", "payments.disburse.cash"],
      }),
    );
    try {
      const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
        method: "POST",
        body: { deliveryId, amountDue: 1, paymentMethod: "mobile_money", currency: "UGX", provider: "mtn_momo", msisdn: VALID_MSISDN },
      });
      expect(status).toBe(403);
      expect(body.error).toMatch(/payments\.disburse\.momo/);
    } finally {
      // Restore the wildcard admin agent for any later tests.
      server.setUser(adminUser({ id: agentId }));
    }
  });
});

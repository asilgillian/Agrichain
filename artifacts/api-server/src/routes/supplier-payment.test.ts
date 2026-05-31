import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

// Spy on the farmer loan auto-deduction helper. Supplier payments MUST skip it
// entirely; farmer payments MUST call it. The mock keeps a working default so
// the farmer cash path still completes (net = full gross, no deductions).
// vi.hoisted ensures the spy exists before vi.mock's hoisted factory runs.
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

const {
  db,
  farmersTable,
  suppliersTable,
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
let supplierId: string;
let farmerId: string;
let supplierDeliveryId: string;
let farmerDeliveryId: string;
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
  return d.id;
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
      firstName: "Pay",
      lastName: "Farmer",
      groupId: randomUUID(),
      regionId: randomUUID(),
      registrationStage: "fully_registered",
    })
    .returning();
  farmerId = farmer.id;

  supplierDeliveryId = await makeApprovedDelivery({ supplierId });
  farmerDeliveryId = await makeApprovedDelivery({ farmerId });
});

afterAll(async () => {
  const deliveryIds = [supplierDeliveryId, farmerDeliveryId].filter(Boolean);
  if (createdPaymentIds.length) await db.delete(paymentsTable).where(inArray(paymentsTable.id, createdPaymentIds));
  if (floatId) await db.delete(cashFloatTransactionsTable).where(eq(cashFloatTransactionsTable.floatId, floatId));
  if (deliveryIds.length) await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
  if (floatId) await db.delete(agentCashFloatsTable).where(eq(agentCashFloatsTable.id, floatId));
  if (supplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  if (farmerId) await db.delete(farmersTable).where(eq(farmersTable.id, farmerId));
  await server?.close();
});

describe("POST /payments — supplier vs farmer loan deduction", () => {
  it("pays a supplier delivery WITHOUT applying farmer loan deductions", async () => {
    applyAutoDeductionsForFarmerPayment.mockClear();
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: {
        deliveryId: supplierDeliveryId,
        amountDue: 1,
        paymentMethod: "cash",
        currency: "UGX",
      },
    });
    expect(status).toBe(201);
    expect(body.supplierId?.toLowerCase()).toBe(supplierId.toLowerCase());
    expect(body.farmerId).toBeNull();
    // The whole point: suppliers have no loan account, so the deduction helper
    // is never invoked and nothing is withheld.
    expect(applyAutoDeductionsForFarmerPayment).not.toHaveBeenCalled();
    expect(body.loanDeductions?.totalDeducted).toBe(0);
    createdPaymentIds.push(body.id);
  });

  it("pays a farmer delivery and DOES run the loan auto-deduction path", async () => {
    applyAutoDeductionsForFarmerPayment.mockClear();
    const { status, body } = await jsonRequest(`${server.baseUrl}/payments`, {
      method: "POST",
      body: {
        deliveryId: farmerDeliveryId,
        amountDue: 1,
        paymentMethod: "cash",
        currency: "UGX",
      },
    });
    expect(status).toBe(201);
    expect(body.farmerId?.toLowerCase()).toBe(farmerId.toLowerCase());
    expect(body.supplierId).toBeNull();
    expect(applyAutoDeductionsForFarmerPayment).toHaveBeenCalledTimes(1);
    const callArg = applyAutoDeductionsForFarmerPayment.mock.calls[0]?.[1] as unknown as { farmerId: string };
    expect(callArg.farmerId.toLowerCase()).toBe(farmerId.toLowerCase());
    createdPaymentIds.push(body.id);
  });
});

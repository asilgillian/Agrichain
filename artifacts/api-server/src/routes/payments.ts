import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray, ne } from "drizzle-orm";
import {
  db,
  paymentsTable,
  farmersTable,
  agentCashFloatsTable,
  cashFloatTransactionsTable,
  deliveriesTable,
} from "@workspace/db";
import { InitiatePaymentBody, ListPaymentsQueryParams } from "@workspace/api-zod";
import { checkFarmerStageForTxn } from "../lib/transaction-access";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

// Mobile-money is gated behind this flag while we wire the real provider. When
// off, MoMo payments are recorded as `pending_external` (audit trail only).
const MOMO_ENABLED = process.env.MOMO_ENABLED === "true";

// Loose Uganda MSISDN check: +256 7XXXXXXXX or 07XXXXXXXX, exactly 9 digits
// after the leading 7. We don't pretend to validate carrier ranges.
function isValidUgMsisdn(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  return /^(256)?7\d{8}$/.test(digits);
}

router.get("/payments", requirePermission("payments.read"), async (req, res): Promise<void> => {
  const parsed = ListPaymentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { farmerId, status } = parsed.data;
  const conditions: any[] = [];
  if (farmerId) conditions.push(eq(paymentsTable.farmerId, farmerId));
  if (status) conditions.push(eq(paymentsTable.status, status));

  const payments = conditions.length > 0
    ? await db.select().from(paymentsTable).where(and(...conditions)).orderBy(desc(paymentsTable.createdAt))
    : await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));

  const enriched = await Promise.all(payments.map(async (p) => {
    const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, p.farmerId));
    return {
      ...p,
      farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
      amountDue: parseFloat(p.amountDue ?? "0"),
      amountPaid: p.amountPaid ? parseFloat(p.amountPaid) : null,
      lotTag: null,
    };
  }));
  res.json(enriched);
});

router.post("/payments", requirePermission("payments.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = InitiatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  // Admin-controlled gate: farmer must meet the registration-stage rule for "payment".
  const denial = await checkFarmerStageForTxn(data.farmerId, "payment");
  if (denial) { res.status(denial.status).json(denial.body); return; }

  // === Server-side payment integrity ===
  // The client may NOT dictate the amount, the farmer-delivery linkage, or pay
  // the same delivery+farmer twice. Everything authoritative here comes from
  // the delivery + its batch.
  if (!data.deliveryId) { res.status(400).json({ error: "deliveryId is required" }); return; }
  const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, data.deliveryId));
  if (!delivery) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (delivery.status !== "approved") {
    res.status(409).json({ error: `Delivery must be approved before payment (current: ${delivery.status})` }); return;
  }
  if (delivery.totalValue == null) {
    res.status(409).json({ error: "Delivery has no totalValue — pricing not finalized" }); return;
  }
  // Delivery-first model: every delivery has exactly one farmer. The caller
  // MUST address the same farmer the delivery was captured for — the legacy
  // multi-contributor split is gone.
  const deliveryFarmerId = (delivery.farmerId ?? "").toLowerCase();
  const requestedFarmerId = data.farmerId.toLowerCase();
  if (!deliveryFarmerId || deliveryFarmerId !== requestedFarmerId) {
    res.status(403).json({ error: "Farmer does not match the delivery's farmer" }); return;
  }
  // Idempotency: never create a second active payment for the same (delivery, farmer).
  // "Active" = anything except `failed`/`cancelled`.
  const existing = await db.select().from(paymentsTable).where(and(
    eq(paymentsTable.deliveryId, data.deliveryId),
    eq(paymentsTable.farmerId, data.farmerId),
    inArray(paymentsTable.status, ["paid", "pending", "pending_external"]),
  ));
  if (existing.length > 0) {
    res.status(409).json({ error: "Payment already exists for this delivery and farmer", paymentId: existing[0].id });
    return;
  }
  // Authoritative amount: the full delivery total. One farmer per delivery
  // means no split divisor is needed.
  const amount = Number(Number(delivery.totalValue).toFixed(2));
  if (!(amount > 0)) {
    res.status(409).json({ error: "Computed payable amount is zero" }); return;
  }
  // We override whatever the client sent for amountDue.
  data.amountDue = amount;

  // Method-specific perm + payload checks. We accept the openapi enum
  // (cash | mobile_money | bank_transfer) but treat `mobile_money` as the
  // MTN/Airtel-Money flow; the actual provider is carried in req.body.provider.
  const method = data.paymentMethod;
  const perms = req.authedUser?.permissions ?? [];
  const has = (k: string) => perms.includes("*") || perms.includes(k);
  if (method === "cash" && !has("payments.disburse.cash")) {
    res.status(403).json({ error: "Forbidden — requires payments.disburse.cash" }); return;
  }
  if (method === "mobile_money" && !has("payments.disburse.momo")) {
    res.status(403).json({ error: "Forbidden — requires payments.disburse.momo" }); return;
  }
  // bank_transfer is in the openapi enum but no disbursement path exists yet.
  // Refuse it explicitly so it can't slip past the per-method authz checks
  // and create a `pending_external` row that would then block legitimate
  // payments via the active-payments unique index.
  if (method !== "cash" && method !== "mobile_money") {
    res.status(400).json({ error: `Payment method '${method}' is not yet supported` }); return;
  }

  const rawProvider = typeof req.body?.provider === "string" ? req.body.provider : "";
  const provider = rawProvider === "mtn_momo" || rawProvider === "airtel_money" ? rawProvider : null;
  const rawMsisdn = typeof req.body?.msisdn === "string" ? req.body.msisdn.trim() : "";
  const msisdn = rawMsisdn ? rawMsisdn : null;

  if (method === "mobile_money") {
    if (!provider) { res.status(400).json({ error: "provider must be 'mtn_momo' or 'airtel_money'" }); return; }
    if (!msisdn || !isValidUgMsisdn(msisdn)) {
      res.status(400).json({ error: "msisdn must be a valid Ugandan number (+256 7XX XXX XXX)" }); return;
    }
  }

  // CASH path: deduct from the calling agent's float in a single tx. The
  // agent is whoever is initiating the payment in the field — that's the
  // authenticated user, not a passed-in id, so the float can never be
  // siphoned by addressing someone else's account.
  if (method === "cash") {
    const agentId = req.authedUser?.id;
    if (!agentId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const amt = Number(data.amountDue);
    if (!(amt > 0)) { res.status(400).json({ error: "amountDue must be > 0" }); return; }
    try {
      const result = await db.transaction(async (tx) => {
        // Ensure a float row exists. The insert is a no-op if one's already there
        // (idempotent because we look it up again right after).
        const existingFloat = await tx.select().from(agentCashFloatsTable).where(eq(agentCashFloatsTable.agentId, agentId)).limit(1);
        let floatId: string;
        if (existingFloat.length === 0) {
          const [created] = await tx.insert(agentCashFloatsTable).values({ agentId, currentBalance: "0" }).returning();
          floatId = created.id;
        } else {
          floatId = existingFloat[0].id;
        }
        // ATOMIC conditional decrement — the WHERE clause guarantees we never
        // over-disburse even under concurrent payouts. If two requests race,
        // only one of them satisfies `current_balance >= amt` and the other's
        // UPDATE matches zero rows.
        const updated = await tx
          .update(agentCashFloatsTable)
          .set({
            currentBalance: sql`(${agentCashFloatsTable.currentBalance})::numeric - ${String(amt)}::numeric`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(agentCashFloatsTable.id, floatId),
            sql`(${agentCashFloatsTable.currentBalance})::numeric >= ${String(amt)}::numeric`,
          ))
          .returning();
        if (updated.length === 0) {
          throw Object.assign(new Error("Insufficient cash float for this payment"), { status: 400 });
        }
        const newBalance = Number(updated[0].currentBalance);
        const [payment] = await tx.insert(paymentsTable).values({
          farmerId: data.farmerId,
          deliveryId: data.deliveryId,
          amountDue: amt.toString(),
          amountPaid: amt.toString(),
          currency: data.currency,
          paymentMethod: "cash",
          status: "paid",
          paidAt: new Date(),
        }).returning();
        await tx.insert(cashFloatTransactionsTable).values({
          floatId,
          type: "DEDUCTION",
          amount: amt.toString(),
          balanceAfter: String(newBalance),
          reference: payment.id,
          note: `Cash payment to farmer ${data.farmerId} for delivery ${data.deliveryId}`,
        });
        return payment;
      });

      const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, result.farmerId));
      res.status(201).json({
        ...result,
        farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
        amountDue: parseFloat(result.amountDue),
        amountPaid: result.amountPaid ? parseFloat(result.amountPaid) : null,
        lotTag: null,
      });
      return;
    } catch (e: any) {
      // Postgres unique_violation (23505) on the partial unique index =
      // somebody else's request beat us to creating an active payment for
      // this (delivery, farmer). Surface as 409.
      if (e?.code === "23505") {
        res.status(409).json({ error: "Payment already exists for this delivery and farmer" });
        return;
      }
      const status = e?.status ?? 500;
      res.status(status).json({ error: e?.message ?? "Payment failed" });
      return;
    }
  }

  // MOBILE-MONEY / BANK paths. Real gateway integration is not wired yet, so we
  // record the intent as `pending_external` with a clear stub reference. When
  // MOMO_ENABLED is flipped on we'll call the provider here and update status
  // synchronously (or via a webhook) — the rest of the app already understands
  // the pending_external state.
  const isMomo = method === "mobile_money";
  if (isMomo && MOMO_ENABLED) {
    req.log.warn({ provider, msisdn }, "MOMO_ENABLED is true but no provider client wired — falling through to stub");
  }
  const reference = isMomo
    ? `STUB:${provider}:${msisdn}`
    : `STUB:${method}`;
  let payment;
  try {
    [payment] = await db.insert(paymentsTable).values({
      farmerId: data.farmerId,
      deliveryId: data.deliveryId,
      amountDue: data.amountDue.toString(),
      currency: data.currency,
      paymentMethod: method,
      status: "pending_external",
      paymentReference: reference,
      msisdn: isMomo ? msisdn : null,
    }).returning();
  } catch (e: any) {
    if (e?.code === "23505") {
      res.status(409).json({ error: "Payment already exists for this delivery and farmer" });
      return;
    }
    throw e;
  }
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, payment.farmerId));
  res.status(201).json({
    ...payment,
    farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
    amountDue: parseFloat(payment.amountDue),
    amountPaid: null,
    lotTag: null,
  });
});

router.get("/payments/summary", requirePermission("payments.read"), async (_req, res): Promise<void> => {
  const all = await db.select().from(paymentsTable);
  const pending = all.filter(p => p.status === "pending" || p.status === "pending_external");
  const paid = all.filter(p => p.status === "paid");
  res.json({
    totalPending: pending.reduce((s, p) => s + parseFloat(p.amountDue), 0),
    totalPaid: paid.reduce((s, p) => s + parseFloat(p.amountDue), 0),
    pendingCount: pending.length,
    paidCount: paid.length,
    currency: "UGX",
  });
});

export default router;

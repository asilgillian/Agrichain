import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray, ne } from "drizzle-orm";
import {
  db,
  paymentsTable,
  farmersTable,
  suppliersTable,
  agentCashFloatsTable,
  cashFloatTransactionsTable,
  deliveriesTable,
} from "@workspace/db";
import { InitiatePaymentBody, ListPaymentsQueryParams } from "@workspace/api-zod";
import { checkFarmerStageForTxn } from "../lib/transaction-access";
import { applyAutoDeductionsForFarmerPayment } from "../lib/loan-deductions";
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

// A payment now belongs to either a farmer or a supplier. Resolve a human
// label for whichever one is set so the UI has a consistent "who got paid".
async function resolvePayeeName(farmerId: string | null, supplierId: string | null): Promise<string> {
  if (farmerId) {
    const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId));
    return farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown";
  }
  if (supplierId) {
    const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, supplierId));
    if (!supplier) return "Unknown";
    return supplier.sellerType === "business"
      ? (supplier.businessName ?? "Supplier")
      : `${supplier.firstName ?? ""} ${supplier.lastName ?? ""}`.trim() || "Supplier";
  }
  return "Unknown";
}

router.get("/payments", requirePermission("payments.read"), async (req, res): Promise<void> => {
  const parsed = ListPaymentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { farmerId, status } = parsed.data;
  const supplierIdFilter = typeof req.query.supplierId === "string" ? req.query.supplierId : null;
  const conditions: any[] = [];
  if (farmerId) conditions.push(eq(paymentsTable.farmerId, farmerId));
  if (supplierIdFilter) conditions.push(eq(paymentsTable.supplierId, supplierIdFilter));
  if (status) conditions.push(eq(paymentsTable.status, status));

  const payments = conditions.length > 0
    ? await db.select().from(paymentsTable).where(and(...conditions)).orderBy(desc(paymentsTable.createdAt))
    : await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));

  const enriched = await Promise.all(payments.map(async (p) => {
    const payeeName = await resolvePayeeName(p.farmerId, p.supplierId);
    return {
      ...p,
      payeeName,
      farmerName: payeeName,
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

  // === Server-side payment integrity ===
  // The client may NOT dictate the amount, the seller-delivery linkage, or pay
  // the same delivery+seller twice. Everything authoritative here comes from
  // the delivery itself — including WHO is being paid (farmer vs supplier).
  if (!data.deliveryId) { res.status(400).json({ error: "deliveryId is required" }); return; }
  const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, data.deliveryId));
  if (!delivery) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (delivery.status !== "approved") {
    res.status(409).json({ error: `Delivery must be approved before payment (current: ${delivery.status})` }); return;
  }
  if (delivery.totalValue == null) {
    res.status(409).json({ error: "Delivery has no totalValue — pricing not finalized" }); return;
  }

  // The delivery references exactly one seller (DB CHECK). Resolve it here and
  // pay that party — never trust the client's idea of who to pay.
  const deliveryFarmerId = delivery.farmerId ? delivery.farmerId.toLowerCase() : null;
  const deliverySupplierId = delivery.supplierId ? delivery.supplierId.toLowerCase() : null;
  const isSupplierPayment = deliverySupplierId !== null;

  if (isSupplierPayment) {
    // If the caller passed a supplierId it must match the delivery's supplier.
    if (data.supplierId && data.supplierId.toLowerCase() !== deliverySupplierId) {
      res.status(403).json({ error: "Supplier does not match the delivery's supplier" }); return;
    }
  } else {
    // Farmer payment. Admin-controlled stage gate applies to farmers only.
    if (!deliveryFarmerId) {
      res.status(409).json({ error: "Delivery has no seller" }); return;
    }
    const denial = await checkFarmerStageForTxn(deliveryFarmerId, "payment");
    if (denial) { res.status(denial.status).json(denial.body); return; }
    // If the caller passed a farmerId it must match the delivery's farmer.
    if (data.farmerId && data.farmerId.toLowerCase() !== deliveryFarmerId) {
      res.status(403).json({ error: "Farmer does not match the delivery's farmer" }); return;
    }
  }

  // Idempotency: never create a second active payment for the same (delivery, seller).
  // "Active" = anything except `failed`/`cancelled`.
  const existing = await db.select().from(paymentsTable).where(and(
    eq(paymentsTable.deliveryId, data.deliveryId),
    isSupplierPayment
      ? eq(paymentsTable.supplierId, deliverySupplierId!)
      : eq(paymentsTable.farmerId, deliveryFarmerId!),
    inArray(paymentsTable.status, ["paid", "pending", "pending_external"]),
  ));
  if (existing.length > 0) {
    res.status(409).json({ error: "Payment already exists for this delivery and seller", paymentId: existing[0].id });
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
        // Create the payment row first (status=paid; the gross amountPaid records
        // what the farmer was owed for the delivery, even if part of it was
        // auto-applied to outstanding loans rather than handed over in cash).
        const [payment] = await tx.insert(paymentsTable).values({
          farmerId: isSupplierPayment ? null : deliveryFarmerId,
          supplierId: isSupplierPayment ? deliverySupplierId : null,
          deliveryId: data.deliveryId,
          amountDue: amt.toString(),
          amountPaid: amt.toString(),
          currency: data.currency,
          paymentMethod: "cash",
          status: "paid",
          paidAt: new Date(),
        }).returning();

        // Phase 2b: auto-apply this payout against the farmer's open auto_deduct loans
        // (in product.recoveryPriority order). The net actually handed over in cash =
        // gross minus deductions. Suppliers have no loan account, so we skip
        // deductions entirely and hand over the full gross.
        const deductions = isSupplierPayment
          ? { netToFarmer: amt, totalDeducted: 0, lines: [] as { loanNumber: string; amount: number }[] }
          : await applyAutoDeductionsForFarmerPayment(tx, {
              farmerId: deliveryFarmerId!,
              grossAmount: amt,
              sourcePaymentId: payment.id,
              sourceDeliveryId: data.deliveryId ?? null,
              paymentDate: new Date().toISOString().slice(0, 10),
              collectedById: agentId,
            });
        const netCashHandedOver = deductions.netToFarmer;

        // ATOMIC conditional decrement against the NET handed over (not the gross).
        // The WHERE guard guarantees we never over-disburse under concurrent payouts.
        // When netCashHandedOver == 0 (loans consumed full payout), we still touch the
        // float row to bump updatedAt and confirm the row exists.
        const updated = await tx
          .update(agentCashFloatsTable)
          .set({
            currentBalance: sql`(${agentCashFloatsTable.currentBalance})::numeric - ${String(netCashHandedOver)}::numeric`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(agentCashFloatsTable.id, floatId),
            sql`(${agentCashFloatsTable.currentBalance})::numeric >= ${String(netCashHandedOver)}::numeric`,
          ))
          .returning();
        if (updated.length === 0) {
          throw Object.assign(new Error("Insufficient cash float for this payment"), { status: 400 });
        }
        const newBalance = Number(updated[0].currentBalance);

        // Float ledger entries. We ALWAYS write a DEDUCTION row for every cash
        // payment — even when net=0 — so reconciliation reports can count one
        // float-ledger row per cash payment. When loan auto-deductions absorbed
        // part of the gross, we also write a separate LOAN_RECOVERY row (zero
        // balance impact) so the gross/net breakdown is visible in the ledger.
        const noteParts = [`Cash payment to farmer ${data.farmerId} for delivery ${data.deliveryId}`];
        if (deductions.totalDeducted > 0) {
          noteParts.push(`(gross ${amt} - loan deductions ${deductions.totalDeducted} = ${netCashHandedOver})`);
        }
        await tx.insert(cashFloatTransactionsTable).values({
          floatId,
          type: "DEDUCTION",
          amount: String(netCashHandedOver),
          balanceAfter: String(newBalance),
          reference: payment.id,
          note: noteParts.join(" "),
        });
        if (deductions.totalDeducted > 0) {
          await tx.insert(cashFloatTransactionsTable).values({
            floatId,
            type: "LOAN_RECOVERY",
            amount: String(deductions.totalDeducted),
            balanceAfter: String(newBalance), // unchanged — informational only
            reference: payment.id,
            note: `Auto-applied to loans: ${deductions.lines.map(l => `${l.loanNumber}=${l.amount}`).join(", ")}`,
          });
        }
        return { ...payment, _deductions: deductions };
      });

      const { _deductions, ...paymentOnly } = result as any;
      const payeeName = await resolvePayeeName(paymentOnly.farmerId, paymentOnly.supplierId);
      res.status(201).json({
        ...paymentOnly,
        payeeName,
        farmerName: payeeName,
        amountDue: parseFloat(paymentOnly.amountDue),
        amountPaid: paymentOnly.amountPaid ? parseFloat(paymentOnly.amountPaid) : null,
        lotTag: null,
        loanDeductions: _deductions ?? null,
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
      farmerId: isSupplierPayment ? null : deliveryFarmerId,
      supplierId: isSupplierPayment ? deliverySupplierId : null,
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
      res.status(409).json({ error: "Payment already exists for this delivery and seller" });
      return;
    }
    throw e;
  }
  res.status(201).json({
    ...payment,
    payeeName: await resolvePayeeName(payment.farmerId, payment.supplierId),
    farmerName: await resolvePayeeName(payment.farmerId, payment.supplierId),
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

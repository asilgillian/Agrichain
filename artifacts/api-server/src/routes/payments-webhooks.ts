import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { queryDisbursementStatus, isProviderLive, callbackSecret, type MomoProvider } from "../lib/momo";

// PUBLIC router (mounted BEFORE requireAuth). Mobile-money providers post async
// settlement notifications here. We never trust the callback body — we use it
// only as a trigger to re-query the gateway for the authoritative status, which
// closes off spoofed-callback attacks.
const router: IRouter = Router();

router.post("/payments/momo/callback/:provider", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  if (provider !== "mtn_momo" && provider !== "airtel_money") {
    res.status(400).json({ error: "Unknown provider" });
    return;
  }

  // Optional shared-secret gate. When MOMO_CALLBACK_SECRET is set, the provider
  // must echo it via ?secret= or the X-Callback-Secret header.
  const expected = callbackSecret();
  if (expected) {
    const got = (typeof req.query.secret === "string" ? req.query.secret : "") || req.get("x-callback-secret") || "";
    if (got !== expected) {
      res.status(401).json({ error: "Invalid callback secret" });
      return;
    }
  }

  // Find the referenced payment. MTN echoes our X-Reference-Id; we also accept
  // a referenceId/reference/externalId field which maps to our payment id.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ref =
    (typeof body.referenceId === "string" && body.referenceId) ||
    (typeof body.reference === "string" && body.reference) ||
    (typeof body.externalId === "string" && body.externalId) ||
    (typeof body.transactionId === "string" && body.transactionId) ||
    null;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let payment = null;
  if (ref) {
    [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.providerTxnId, ref));
    if (!payment && UUID_RE.test(ref)) {
      // externalId is our payment id, so try that too — but only when the ref
      // is UUID-shaped, otherwise Postgres rejects the cast and 500s.
      [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, ref));
    }
  }
  if (!payment) {
    // Acknowledge so the provider stops retrying, but log the miss.
    req.log.warn({ provider, ref }, "momo callback for unknown payment");
    res.status(200).json({ received: true });
    return;
  }
  if (!payment.momoProvider || !payment.providerTxnId || !isProviderLive(payment.momoProvider as MomoProvider)) {
    res.status(200).json({ received: true });
    return;
  }

  try {
    const status = await queryDisbursementStatus({
      provider: payment.momoProvider as MomoProvider,
      providerTxnId: payment.providerTxnId,
    });
    if (status.status === "success") {
      await db.update(paymentsTable).set({
        status: "paid",
        amountPaid: payment.amountDue,
        paidAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      }).where(eq(paymentsTable.id, payment.id));
    } else if (status.status === "failed") {
      await db.update(paymentsTable).set({
        status: "failed",
        failureReason: status.failureReason ?? "Disbursement failed",
        updatedAt: new Date(),
      }).where(eq(paymentsTable.id, payment.id));
    }
    // pending -> leave as-is; a later callback/refresh will settle it.
  } catch (e: any) {
    req.log.error({ err: e, provider, paymentId: payment.id }, "momo callback status re-query failed");
    // Still 200 so the provider doesn't hammer us; refresh endpoint can recover.
  }
  res.status(200).json({ received: true });
});

export default router;

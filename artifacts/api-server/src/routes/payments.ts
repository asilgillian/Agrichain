import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, paymentsTable, farmersTable } from "@workspace/db";
import { InitiatePaymentBody, ListPaymentsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/payments", async (req, res): Promise<void> => {
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

router.post("/payments", async (req, res): Promise<void> => {
  const parsed = InitiatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [payment] = await db.insert(paymentsTable).values({
    farmerId: parsed.data.farmerId,
    deliveryId: parsed.data.deliveryId,
    amountDue: parsed.data.amountDue.toString(),
    currency: parsed.data.currency,
    paymentMethod: parsed.data.paymentMethod,
    status: "pending",
  }).returning();
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, payment.farmerId));
  res.status(201).json({
    ...payment,
    farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
    amountDue: parseFloat(payment.amountDue),
    amountPaid: null,
    lotTag: null,
  });
});

router.get("/payments/summary", async (req, res): Promise<void> => {
  const all = await db.select().from(paymentsTable);
  const pending = all.filter(p => p.status === "pending");
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

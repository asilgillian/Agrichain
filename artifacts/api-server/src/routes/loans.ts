import { Router } from "express";
import { db } from "@workspace/db";
import { loansTable, loanRepaymentsTable, loanGuarantorsTable } from "@workspace/db";
import { farmersTable, groupsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

const router = Router();

router.get("/loans", async (req, res): Promise<void> => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const status = req.query.status as string | undefined;
  const loanType = req.query.loanType as string | undefined;

  const conditions = [];
  if (status) conditions.push(eq(loansTable.status, status));
  if (loanType) conditions.push(eq(loansTable.loanType, loanType));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [loans, countResult] = await Promise.all([
    db.select().from(loansTable).where(whereClause).orderBy(desc(loansTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(loansTable).where(whereClause),
  ]);

  const farmerIds = [...new Set(loans.map(l => l.farmerId).filter(Boolean))];
  let farmerMap: Record<string, string> = {};
  if (farmerIds.length > 0) {
    const farmers = await db.select({ id: farmersTable.id, firstName: farmersTable.firstName, lastName: farmersTable.lastName }).from(farmersTable)
      .where(sql`${farmersTable.id} = ANY(ARRAY[${sql.join(farmerIds.map(id => sql`${id}::uuid`), sql`, `)}])`);
    farmerMap = Object.fromEntries(farmers.map(f => [f.id, `${f.firstName} ${f.lastName}`]));
  }

  const data = loans.map(l => ({ ...l, farmerName: l.farmerId ? (farmerMap[l.farmerId] ?? null) : null }));
  res.json({ data, total: countResult[0]?.count ?? 0, page, limit });
});

router.get("/loans/summary", async (_req, res): Promise<void> => {
  const result = await db.select({
    status: loansTable.status,
    count: sql<number>`count(*)::int`,
    totalPrincipal: sql<number>`COALESCE(SUM(${loansTable.principalAmount}::numeric), 0)::numeric`,
    totalOutstanding: sql<number>`COALESCE(SUM(${loansTable.outstandingBalance}::numeric), 0)::numeric`,
  }).from(loansTable).groupBy(loansTable.status);
  res.json(result);
});

router.get("/loans/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const loan = await db.select().from(loansTable).where(eq(loansTable.id, id)).limit(1);
  if (!loan[0]) { res.status(404).json({ error: "Loan not found" }); return; }

  const [repayments, guarantors] = await Promise.all([
    db.select().from(loanRepaymentsTable).where(eq(loanRepaymentsTable.loanId, id)).orderBy(desc(loanRepaymentsTable.paymentDate)),
    db.select().from(loanGuarantorsTable).where(eq(loanGuarantorsTable.loanId, id)),
  ]);

  let farmer = null;
  if (loan[0].farmerId) {
    const f = await db.select().from(farmersTable).where(eq(farmersTable.id, loan[0].farmerId!)).limit(1);
    farmer = f[0] ?? null;
  }

  res.json({ ...loan[0], farmer, repayments, guarantors });
});

router.post("/loans", async (req, res): Promise<void> => {
  const { farmerId, groupId, loanType, principalAmount, interestRatePct, purpose, collateral, dueDate, notes } = req.body;
  if (!loanType || !principalAmount) { res.status(400).json({ error: "loanType and principalAmount are required" }); return; }

  const seq = await db.select({ count: sql<number>`count(*)::int` }).from(loansTable);
  const loanNumber = `LN${new Date().getFullYear()}${String((seq[0]?.count ?? 0) + 1).padStart(4, "0")}`;
  const interestPct = Number(interestRatePct ?? 0);
  const principal = Number(principalAmount);
  const totalRepayable = principal * (1 + interestPct / 100);

  const [loan] = await db.insert(loansTable).values({
    loanNumber, farmerId, groupId, loanType, principalAmount: String(principal),
    interestRatePct: String(interestPct), totalRepayable: String(totalRepayable),
    outstandingBalance: String(totalRepayable), purpose, collateral, dueDate, notes,
    status: "PENDING",
  }).returning();
  res.status(201).json(loan);
});

router.post("/loans/:id/approve", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [loan] = await db.update(loansTable).set({ status: "APPROVED", approvedAt: new Date(), approvedById: req.body.userId }).where(eq(loansTable.id, id)).returning();
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  res.json(loan);
});

router.post("/loans/:id/disburse", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { disbursedAmount } = req.body;
  const [loan] = await db.update(loansTable).set({
    status: "DISBURSED", disbursedAt: new Date(), disbursedById: req.body.userId,
    disbursedAmount: String(disbursedAmount),
  }).where(eq(loansTable.id, id)).returning();
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  res.json(loan);
});

router.post("/loans/:id/repayments", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { amount, paymentDate, paymentMethod, reference, notes } = req.body;
  if (!amount || !paymentDate) { res.status(400).json({ error: "amount and paymentDate are required" }); return; }

  const [repayment] = await db.insert(loanRepaymentsTable).values({
    loanId: id, amount: String(amount), paymentDate, paymentMethod, reference, notes,
  }).returning();

  const loan = await db.select().from(loansTable).where(eq(loansTable.id, id)).limit(1);
  if (loan[0]) {
    const newBalance = Math.max(0, Number(loan[0].outstandingBalance ?? 0) - Number(amount));
    const newStatus = newBalance <= 0 ? "CLOSED" : "REPAYING";
    await db.update(loansTable).set({ outstandingBalance: String(newBalance), status: newStatus }).where(eq(loansTable.id, id));
  }
  res.status(201).json(repayment);
});

export default router;

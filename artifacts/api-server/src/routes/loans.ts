import { Router } from "express";
import { db } from "@workspace/db";
import {
  loansTable,
  loanRepaymentsTable,
  loanGuarantorsTable,
  loanProductsTable,
  loanCategoriesTable,
  farmersTable,
  auditLogsTable,
} from "@workspace/db";
import { checkFarmerStageForTxn } from "../lib/transaction-access";
import {
  resolveEffectiveRates,
  computeInputPrincipal,
  computeTotalRepayable,
  validateInputProductFields,
} from "../lib/loan-pricing";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { eq, desc, and, sql, inArray, lt } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();

// =================================================================================================
// Helpers
// =================================================================================================
const uuidSchema = z.string().uuid();
function parseUuid(value: unknown): string | null {
  const r = uuidSchema.safeParse(value);
  return r.success ? r.data : null;
}

const TERMINAL_STATUSES = new Set(["CLOSED", "WRITTEN_OFF"]);
const OPEN_STATUSES = ["DISBURSED", "REPAYING"] as const;
// Statuses where money is actually owed and the loan is "live" — used to gate
// repay / restructure / write-off so a user with those perms can't bypass the
// approve→disburse dual-control by acting on a PENDING/APPROVED loan.
const LIVE_STATUSES = new Set(["DISBURSED", "REPAYING", "DEFAULTED"]);

// Fire-and-forget audit log. We deliberately swallow errors — audit is for
// observability, never a gate on the business operation.
async function writeLoanAudit(
  action: string,
  loanId: string,
  user: AuthedRequest["authedUser"],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      entityType: "loan",
      entityId: loanId,
      action,
      actorId: user?.id ?? "system",
      actorName: user?.email ?? "system",
      actorRole: user?.role ?? "system",
      before: before as any,
      after: after as any,
    });
  } catch { /* swallow */ }
}

// =================================================================================================
// LIST + SUMMARY
// =================================================================================================
router.get("/loans", requirePermission("loans.read"), async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const loanType = typeof req.query.loanType === "string" ? req.query.loanType : undefined;
  const farmerIdParam = typeof req.query.farmerId === "string" ? req.query.farmerId : undefined;

  const conditions = [];
  if (status) conditions.push(eq(loansTable.status, status));
  if (loanType) conditions.push(eq(loansTable.loanType, loanType));
  if (farmerIdParam) {
    const fid = parseUuid(farmerIdParam);
    if (!fid) { res.status(400).json({ error: "Invalid farmerId" }); return; }
    conditions.push(eq(loansTable.farmerId, fid));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [loans, countResult] = await Promise.all([
    db.select().from(loansTable).where(whereClause).orderBy(desc(loansTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(loansTable).where(whereClause),
  ]);

  const farmerIds = [...new Set(loans.map(l => l.farmerId).filter(Boolean) as string[])];
  let farmerMap: Record<string, string> = {};
  if (farmerIds.length > 0) {
    const farmers = await db.select({ id: farmersTable.id, firstName: farmersTable.firstName, lastName: farmersTable.lastName }).from(farmersTable)
      .where(inArray(farmersTable.id, farmerIds));
    farmerMap = Object.fromEntries(farmers.map(f => [f.id, `${f.firstName} ${f.lastName}`]));
  }

  const data = loans.map(l => ({ ...l, farmerName: l.farmerId ? (farmerMap[l.farmerId] ?? null) : null }));
  res.json({ data, total: countResult[0]?.count ?? 0, page, limit });
});

router.get("/loans/summary", requirePermission("loans.read"), async (_req, res): Promise<void> => {
  const result = await db.select({
    status: loansTable.status,
    count: sql<number>`count(*)::int`,
    totalPrincipal: sql<number>`COALESCE(SUM(${loansTable.principalAmount}::numeric), 0)::numeric`,
    totalOutstanding: sql<number>`COALESCE(SUM(${loansTable.outstandingBalance}::numeric), 0)::numeric`,
  }).from(loansTable).groupBy(loansTable.status);
  res.json(result);
});

// Outstanding-loans lookup for a farmer (used by mobile farmer screens + UI hints).
router.get("/loans/farmer/:farmerId/outstanding", requirePermission("loans.read"), async (req, res): Promise<void> => {
  const farmerId = parseUuid(req.params.farmerId);
  if (!farmerId) { res.status(400).json({ error: "Invalid farmerId" }); return; }
  const rows = await db
    .select({
      id: loansTable.id,
      loanNumber: loansTable.loanNumber,
      loanType: loansTable.loanType,
      loanProductId: loansTable.loanProductId,
      productName: loanProductsTable.name,
      repaymentMethod: loanProductsTable.repaymentMethod,
      recoveryPriority: loanProductsTable.recoveryPriority,
      outstandingBalance: loansTable.outstandingBalance,
      currency: loansTable.currency,
      dueDate: loansTable.dueDate,
      status: loansTable.status,
    })
    .from(loansTable)
    .leftJoin(loanProductsTable, eq(loansTable.loanProductId, loanProductsTable.id))
    .where(and(
      eq(loansTable.farmerId, farmerId),
      inArray(loansTable.status, OPEN_STATUSES as unknown as string[]),
    ))
    .orderBy(desc(loansTable.disbursedAt));
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.outstandingBalance ?? 0), 0);
  res.json({ farmerId, totalOutstanding, loans: rows });
});

// =================================================================================================
// GET ONE
// =================================================================================================
router.get("/loans/:id", requirePermission("loans.read"), async (req, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [loan] = await db.select().from(loansTable).where(eq(loansTable.id, id)).limit(1);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }

  const [repayments, guarantors, product] = await Promise.all([
    db.select().from(loanRepaymentsTable).where(eq(loanRepaymentsTable.loanId, id)).orderBy(desc(loanRepaymentsTable.paymentDate)),
    db.select().from(loanGuarantorsTable).where(eq(loanGuarantorsTable.loanId, id)),
    loan.loanProductId
      ? db.select().from(loanProductsTable).where(eq(loanProductsTable.id, loan.loanProductId)).limit(1).then(r => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  let farmer = null;
  if (loan.farmerId) {
    const f = await db.select().from(farmersTable).where(eq(farmersTable.id, loan.farmerId)).limit(1);
    farmer = f[0] ?? null;
  }

  res.json({ ...loan, farmer, repayments, guarantors, product });
});

// =================================================================================================
// CREATE — requires a catalog product. Derives interest/penalty/grace from the product.
// =================================================================================================
const createLoanSchema = z.object({
  loanProductId: z.string().uuid(),
  farmerId: z.string().uuid().optional().nullable(),
  groupId: z.string().uuid().optional().nullable(),
  // INPUT loans: required (server computes principal = unitPrice × quantity).
  // CASH loans: ignored.
  quantity: z.number().positive().optional(),
  // CASH loans only: operator-entered principal. Ignored for INPUT.
  principalAmount: z.number().positive().optional(),
  // Optional overrides — only honoured when the product's allowFinanceOverride = true.
  interestRatePctOverride: z.number().min(0).max(1000).optional(),
  penaltyRatePctOverride: z.number().min(0).max(1000).optional(),
  gracePeriodDaysOverride: z.number().int().min(0).max(3650).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purpose: z.string().max(2000).optional(),
  collateral: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
});

router.post("/loans", requirePermission("loans.write"), async (req, res): Promise<void> => {
  const parsed = createLoanSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;

  // Resolve product — must be active. Also fetch its category so we can inherit
  // rate defaults for any rate fields the product leaves null.
  const [product] = await db.select().from(loanProductsTable).where(eq(loanProductsTable.id, d.loanProductId)).limit(1);
  if (!product) { res.status(404).json({ error: "Loan product not found" }); return; }
  if (!product.isActive) { res.status(409).json({ error: "Loan product is inactive" }); return; }
  const [category] = await db.select().from(loanCategoriesTable).where(eq(loanCategoriesTable.id, product.loanCategoryId)).limit(1);
  if (!category) { res.status(409).json({ error: "Loan product is orphaned from its category" }); return; }

  // Resolve principal + quantity based on product type.
  //   INPUT  → require quantity > 0; principal = product.unitPrice × quantity.
  //            Client-supplied principalAmount is ignored to prevent UI bugs
  //            from minting wrong-priced loans.
  //   CASH   → require client-supplied principalAmount (credit-limit gating
  //            is a Phase 4 concern).
  let principal: number;
  let quantity: number | null = null;
  if (product.productType === "INPUT") {
    // Guard against malformed/legacy product rows (e.g. blank unit after a
    // migration) before minting a loan against them.
    const cfgErr = validateInputProductFields({ productType: "INPUT", unitPrice: product.unitPrice, unit: product.unit });
    if (cfgErr) {
      res.status(409).json({ error: `Input product is misconfigured (${cfgErr}). Edit the product in Loans → Catalog.` }); return;
    }
    if (d.quantity == null || d.quantity <= 0) {
      res.status(400).json({ error: "quantity is required for INPUT products" }); return;
    }
    quantity = d.quantity;
    principal = computeInputPrincipal(product.unitPrice!, quantity);
  } else {
    if (d.principalAmount == null) {
      res.status(400).json({ error: "principalAmount is required for CASH products" }); return;
    }
    principal = d.principalAmount;
  }
  // Product-level principal cap (still enforced for CASH; vacuously true for
  // INPUT since the configured price is below or equal to its own cap by setup).
  if (product.maxAmount != null && principal > Number(product.maxAmount)) {
    res.status(409).json({ error: `Principal exceeds product max (${product.maxAmount})` }); return;
  }

  // Admin-controlled gate: farmer (when supplied) must meet the registration-stage rule for "loan".
  if (typeof d.farmerId === "string" && d.farmerId) {
    const denial = await checkFarmerStageForTxn(d.farmerId, "loan");
    if (denial) { res.status(denial.status).json(denial.body); return; }
  }

  // Entrepreneurs-only products (e.g. bulking loans) require the borrowing
  // farmer to carry the entrepreneur flag. Group loans without a farmer can't
  // satisfy this, so they're refused too.
  if (product.entrepreneursOnly) {
    if (!d.farmerId) {
      res.status(409).json({ error: "This loan product is restricted to farmer-entrepreneurs", code: "ENTREPRENEURS_ONLY" });
      return;
    }
    const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, d.farmerId)).limit(1);
    if (!farmer) { res.status(404).json({ error: "Farmer not found" }); return; }
    if (!farmer.isEntrepreneur) {
      res.status(409).json({ error: "This loan product is restricted to farmer-entrepreneurs", code: "ENTREPRENEURS_ONLY" });
      return;
    }
  }

  // Effective rates: product override (non-null) wins over the category default,
  // then a finance-officer override wins over that when the product permits it.
  const { interestType: effectiveInterestType, interestRate, penaltyRate, gracePeriodDays: gracePeriod } =
    resolveEffectiveRates(product, category, {
      allowFinanceOverride: product.allowFinanceOverride,
      interestRatePctOverride: d.interestRatePctOverride ?? null,
      penaltyRatePctOverride: d.penaltyRatePctOverride ?? null,
      gracePeriodDaysOverride: d.gracePeriodDaysOverride ?? null,
    });

  const seq = await db.select({ count: sql<number>`count(*)::int` }).from(loansTable);
  const loanNumber = `LN${new Date().getFullYear()}${String((seq[0]?.count ?? 0) + 1).padStart(4, "0")}`;
  // Flat-interest default; reducing-balance schedules belong to Phase 3 amortization work.
  const totalRepayable = computeTotalRepayable(principal, effectiveInterestType, interestRate);

  const [loan] = await db.insert(loansTable).values({
    loanNumber,
    farmerId: d.farmerId ?? null,
    groupId: d.groupId ?? null,
    loanProductId: product.id,
    loanType: product.name, // legacy column mirrors product name for back-compat
    quantity: quantity != null ? String(quantity) : null,
    principalAmount: String(principal),
    interestRatePct: String(interestRate),
    penaltyRatePct: String(penaltyRate),
    gracePeriodDays: gracePeriod,
    totalRepayable: String(totalRepayable),
    outstandingBalance: String(totalRepayable),
    currency: "UGX",
    purpose: d.purpose ?? null,
    collateral: d.collateral ?? null,
    dueDate: d.dueDate ?? null,
    originalDueDate: d.dueDate ?? null,
    notes: d.notes ?? null,
    status: "PENDING",
  }).returning();
  res.status(201).json(loan);
});

// =================================================================================================
// APPROVE / DISBURSE — split permissions per dual-control principle.
// =================================================================================================
router.post("/loans/:id/approve", requirePermission("loans.approve"), async (req: AuthedRequest, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(loansTable).where(eq(loansTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Loan not found" }); return; }
  // Atomic conditional transition — the status assertion lives inside the
  // UPDATE WHERE so two approvers racing this endpoint can't both win.
  const [loan] = await db.update(loansTable).set({
    status: "APPROVED",
    approvedAt: new Date(),
    approvedById: req.authedUser?.id ?? null,
    updatedAt: new Date(),
  }).where(and(eq(loansTable.id, id), eq(loansTable.status, "PENDING"))).returning();
  if (!loan) {
    res.status(409).json({ error: `Cannot approve loan in status ${existing.status} (must be PENDING)` }); return;
  }
  await writeLoanAudit("approve", id, req.authedUser, { status: existing.status }, { status: loan.status, approvedById: loan.approvedById });
  res.json(loan);
});

const disburseSchema = z.object({
  disbursedAmount: z.number().positive().optional(),
});

router.post("/loans/:id/disburse", requirePermission("loans.disburse"), async (req: AuthedRequest, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = disburseSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [existing] = await db.select().from(loansTable).where(eq(loansTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Loan not found" }); return; }
  if (existing.status !== "APPROVED") {
    res.status(409).json({ error: `Cannot disburse loan in status ${existing.status} (must be APPROVED)` }); return;
  }
  const amount = parsed.data.disbursedAmount ?? Number(existing.principalAmount);
  if (amount > Number(existing.principalAmount)) {
    res.status(409).json({ error: "Disbursed amount cannot exceed principal" }); return;
  }
  // Atomic conditional transition — status pinned in WHERE.
  const [loan] = await db.update(loansTable).set({
    status: "DISBURSED",
    disbursedAt: new Date(),
    disbursedById: req.authedUser?.id ?? null,
    disbursedAmount: String(amount),
    updatedAt: new Date(),
  }).where(and(eq(loansTable.id, id), eq(loansTable.status, "APPROVED"))).returning();
  if (!loan) { res.status(409).json({ error: "Loan status changed since fetch — retry" }); return; }
  await writeLoanAudit("disburse", id, req.authedUser, { status: existing.status }, { status: loan.status, disbursedAmount: loan.disbursedAmount });
  res.json(loan);
});

// =================================================================================================
// REPAYMENT (manual)
// =================================================================================================
const repaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.string().max(40).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

router.post("/loans/:id/repayments", requirePermission("loans.write"), async (req: AuthedRequest, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = repaymentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const [loan] = await tx.select().from(loansTable).where(eq(loansTable.id, id)).limit(1);
      if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });
      // Repayments are only meaningful once the loan is live (disbursed cash exists).
      // Blocks the loophole where a user with loans.write could close a PENDING/APPROVED
      // loan by "repaying" it without anyone approving + disbursing first.
      if (!LIVE_STATUSES.has(loan.status)) {
        throw Object.assign(new Error(`Cannot repay loan in status ${loan.status} — must be DISBURSED, REPAYING, or DEFAULTED`), { status: 409 });
      }
      const outstanding = Number(loan.outstandingBalance ?? 0);
      // Honor product.allowPartialRepayment when present.
      let allowPartial = true;
      if (loan.loanProductId) {
        const [p] = await tx.select({ allow: loanProductsTable.allowPartialRepayment })
          .from(loanProductsTable).where(eq(loanProductsTable.id, loan.loanProductId)).limit(1);
        if (p && p.allow === false) allowPartial = false;
      }
      if (!allowPartial && d.amount < outstanding) {
        throw Object.assign(new Error("Partial repayment not allowed for this loan product"), { status: 409 });
      }
      const applied = Math.min(d.amount, outstanding); // never over-repay
      const newBalance = Number((outstanding - applied).toFixed(2));
      const newStatus = newBalance <= 0 ? "CLOSED" : "REPAYING";

      const [repayment] = await tx.insert(loanRepaymentsTable).values({
        loanId: id,
        amount: String(applied),
        paymentDate: d.paymentDate,
        paymentMethod: d.paymentMethod ?? null,
        reference: d.reference ?? null,
        collectedById: req.authedUser?.id ?? null,
        notes: d.notes ?? null,
      }).returning();

      await tx.update(loansTable).set({
        outstandingBalance: String(newBalance),
        status: newStatus,
        updatedAt: new Date(),
      }).where(eq(loansTable.id, id));

      return { repayment, newBalance, status: newStatus, applied };
    });
    res.status(201).json(result);
  } catch (e: any) {
    res.status(e?.status ?? 500).json({ error: e?.message ?? "Failed to record repayment" });
  }
});

// =================================================================================================
// RESTRUCTURE — extend the due date, optionally capitalize accrued interest into the balance.
// Capped by product.maxRestructures.
// =================================================================================================
const restructureSchema = z.object({
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  additionalInterest: z.number().min(0).optional(), // UGX added to outstanding (capitalized interest)
  reason: z.string().min(1).max(2000),
});

router.post("/loans/:id/restructure", requirePermission("loans.restructure"), async (req: AuthedRequest, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = restructureSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // FOR UPDATE row lock — serializes two concurrent restructure requests so
      // they can't both pass the maxRestructures cap check and both apply edits.
      const locked = await tx.execute(sql`
        SELECT * FROM loans WHERE id = ${id} FOR UPDATE
      `);
      const loan = ((locked as any).rows ?? locked)[0] as any;
      if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });
      // Restructuring is a workout tool for live loans; a PENDING/APPROVED loan
      // should be cancelled or have its principal edited instead.
      if (!LIVE_STATUSES.has(loan.status)) {
        throw Object.assign(new Error(`Cannot restructure loan in status ${loan.status} — must be DISBURSED, REPAYING, or DEFAULTED`), { status: 409 });
      }
      const currentRestructureCount = Number(loan.restructure_count ?? 0);
      if (loan.loan_product_id) {
        const [p] = await tx.select({ max: loanProductsTable.maxRestructures })
          .from(loanProductsTable).where(eq(loanProductsTable.id, loan.loan_product_id)).limit(1);
        const maxAllowed = p?.max ?? 0;
        if (currentRestructureCount >= maxAllowed) {
          throw Object.assign(new Error(`Product allows only ${maxAllowed} restructure(s); already at limit`), { status: 409 });
        }
      }
      const addInterest = Number((d.additionalInterest ?? 0).toFixed(2));
      const newOutstanding = Number((Number(loan.outstanding_balance ?? 0) + addInterest).toFixed(2));
      const newTotalRepayable = Number((Number(loan.total_repayable ?? 0) + addInterest).toFixed(2));

      // Conditional update — restructure_count assertion is defence-in-depth on
      // top of the row lock, so even if the lock semantics ever change, two
      // restructures still can't double-increment the counter.
      const updated = await tx.update(loansTable).set({
        dueDate: d.newDueDate,
        outstandingBalance: String(newOutstanding),
        totalRepayable: String(newTotalRepayable),
        restructureCount: currentRestructureCount + 1,
        // If the loan was already DEFAULTED, restructuring brings it back to REPAYING/DISBURSED.
        status: loan.status === "DEFAULTED" ? (Number(loan.disbursed_amount ?? 0) > 0 ? "REPAYING" : "DISBURSED") : loan.status,
        notes: [loan.notes, `Restructured on ${new Date().toISOString().slice(0,10)} by ${req.authedUser?.id ?? "system"}: ${d.reason}`].filter(Boolean).join("\n"),
        updatedAt: new Date(),
      }).where(and(eq(loansTable.id, id), eq(loansTable.restructureCount, currentRestructureCount))).returning();
      if (updated.length === 0) {
        throw Object.assign(new Error("Restructure conflict — loan changed concurrently"), { status: 409 });
      }
      return { updated: updated[0], before: { status: loan.status, dueDate: loan.due_date, outstandingBalance: loan.outstanding_balance, restructureCount: currentRestructureCount } };
    });
    await writeLoanAudit("restructure", id, req.authedUser,
      { status: result.before.status, dueDate: result.before.dueDate, outstandingBalance: result.before.outstandingBalance, restructureCount: result.before.restructureCount },
      { status: result.updated.status, dueDate: result.updated.dueDate, outstandingBalance: result.updated.outstandingBalance, restructureCount: result.updated.restructureCount, reason: d.reason },
    );
    res.json(result.updated);
  } catch (e: any) {
    res.status(e?.status ?? 500).json({ error: e?.message ?? "Failed to restructure loan" });
  }
});

// =================================================================================================
// WRITE-OFF
// =================================================================================================
const writeOffSchema = z.object({
  reason: z.string().min(1).max(2000),
});

router.post("/loans/:id/write-off", requirePermission("loans.writeoff"), async (req: AuthedRequest, res): Promise<void> => {
  const id = parseUuid(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = writeOffSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [loan] = await db.select().from(loansTable).where(eq(loansTable.id, id)).limit(1);
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  // Write-off only applies to LIVE loans (cash actually went out the door). For
  // PENDING/APPROVED, the correct action is to cancel — not pollute the audit
  // trail with a write-off of money that never moved.
  if (!LIVE_STATUSES.has(loan.status)) {
    res.status(409).json({ error: `Cannot write off loan in status ${loan.status} — only live (DISBURSED/REPAYING/DEFAULTED) loans can be written off` }); return;
  }
  // Status pinned in WHERE for atomic transition.
  const [updated] = await db.update(loansTable).set({
    status: "WRITTEN_OFF",
    writtenOffAt: new Date(),
    writtenOffById: req.authedUser?.id ?? null,
    writeOffReason: parsed.data.reason,
    updatedAt: new Date(),
  }).where(and(eq(loansTable.id, id), inArray(loansTable.status, ["DISBURSED", "REPAYING", "DEFAULTED"]))).returning();
  if (!updated) { res.status(409).json({ error: "Loan status changed since fetch — retry" }); return; }
  await writeLoanAudit("write-off", id, req.authedUser,
    { status: loan.status, outstandingBalance: loan.outstandingBalance },
    { status: updated.status, writeOffReason: updated.writeOffReason },
  );
  res.json(updated);
});

// =================================================================================================
// FLAG OVERDUE — sweep loans past dueDate + grace and mark DEFAULTED. Returns the count.
// Intended for ops/cron use. Safe to re-run (idempotent — only flips OPEN→DEFAULTED).
// =================================================================================================
router.post("/loans/flag-overdue", requirePermission("loans.writeoff"), async (_req, res): Promise<void> => {
  // due_date + grace_period_days < today
  const today = new Date().toISOString().slice(0, 10);
  const updated = await db.update(loansTable).set({
    status: "DEFAULTED",
    defaultedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    inArray(loansTable.status, OPEN_STATUSES as unknown as string[]),
    sql`${loansTable.dueDate} IS NOT NULL`,
    lt(sql`(${loansTable.dueDate} + (COALESCE(${loansTable.gracePeriodDays}, 0) || ' days')::interval)::date`, sql`${today}::date`),
  )).returning({ id: loansTable.id, loanNumber: loansTable.loanNumber });
  res.json({ defaultedCount: updated.length, loans: updated });
});

export default router;

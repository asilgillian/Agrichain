import { eq, and, asc, inArray, sql } from "drizzle-orm";
import {
  loansTable,
  loanProductsTable,
  loanRepaymentsTable,
} from "@workspace/db";

// Hard ceiling on per-loan retries when concurrent writers shrink the outstanding
// balance mid-deduction. Keeps priority ordering intact without risk of runaway loops.
const MAX_RETRIES_PER_LOAN = 3;

// Status values that mean "loan still owes money" — anything else is closed/defaulted/written-off.
const OPEN_STATUSES = ["DISBURSED", "REPAYING"] as const;

export interface DeductionLine {
  loanId: string;
  loanNumber: string;
  loanProductId: string | null;
  amount: number; // UGX deducted from this payment toward this loan
  newOutstanding: number;
  closed: boolean;
}

/**
 * Compute and apply auto-deductions for a farmer's open loans against a gross payout.
 *
 * Behaviour:
 *  - Only loans whose product has repaymentMethod = 'auto_deduct' are eligible. Loans without
 *    a `loanProductId` (legacy rows) are skipped — they cannot opt in to auto-deduction.
 *  - Eligible loans are ordered by product.recoveryPriority ASC, then loan.disbursedAt ASC.
 *  - We never deduct more than the loan's outstanding balance, never more than gross remaining.
 *  - A loanRepayment row is created for each deduction, linked back via sourcePaymentId.
 *  - Loans that hit zero outstanding move to CLOSED; partial deductions move PENDING→REPAYING.
 *
 * MUST be called inside an open drizzle transaction (caller passes `tx`).
 */
export async function applyAutoDeductionsForFarmerPayment(
  tx: any,
  args: {
    farmerId: string;
    grossAmount: number;
    sourcePaymentId: string;
    sourceDeliveryId: string | null;
    paymentDate: string; // YYYY-MM-DD
    collectedById: string | null;
  },
): Promise<{ totalDeducted: number; netToFarmer: number; lines: DeductionLine[] }> {
  const { farmerId, grossAmount, sourcePaymentId, sourceDeliveryId, paymentDate, collectedById } = args;

  // Pull eligible loan IDs + product priority in priority order. We re-read the
  // actual loan inside the loop (with FOR UPDATE) so a concurrent writer can't
  // give us a stale outstanding balance to base the deduction on.
  const eligibleIds = await tx
    .select({
      loanId: loansTable.id,
      productName: loanProductsTable.name,
    })
    .from(loansTable)
    .leftJoin(loanProductsTable, eq(loansTable.loanProductId, loanProductsTable.id))
    .where(and(
      eq(loansTable.farmerId, farmerId),
      inArray(loansTable.status, OPEN_STATUSES as unknown as string[]),
      eq(loanProductsTable.repaymentMethod, "auto_deduct"),
    ))
    .orderBy(
      asc(loanProductsTable.recoveryPriority),
      asc(loansTable.disbursedAt),
    );

  let remaining = Number(grossAmount);
  const lines: DeductionLine[] = [];

  for (const { loanId, productName } of eligibleIds) {
    if (remaining <= 0) break;
    // Per-loan retry: a concurrent repayment may shrink outstanding between our
    // SELECT and UPDATE. Reload-with-lock + retry preserves recoveryPriority
    // ordering instead of skipping ahead to the next loan on contention.
    let attempts = 0;
    while (attempts < MAX_RETRIES_PER_LOAN && remaining > 0) {
      attempts += 1;
      // FOR UPDATE row lock — serializes concurrent writers against THIS row,
      // so the value we read is the value we'll write.
      const lockedRows = await tx.execute(sql`
        SELECT id, loan_number, loan_product_id, outstanding_balance, status
        FROM loans
        WHERE id = ${loanId}
          AND status IN ('DISBURSED', 'REPAYING')
        FOR UPDATE
      `);
      const locked = ((lockedRows as any).rows ?? lockedRows)[0];
      if (!locked) break; // loan closed/defaulted by a concurrent writer
      const outstanding = Number((locked as any).outstanding_balance ?? 0);
      if (outstanding <= 0) break;
      const take = Math.min(remaining, outstanding);
      if (take <= 0) break;
      const newOutstanding = Number((outstanding - take).toFixed(2));
      const closed = newOutstanding <= 0;

      const updated = await tx
        .update(loansTable)
        .set({
          outstandingBalance: String(newOutstanding),
          status: closed ? "CLOSED" : "REPAYING",
          updatedAt: new Date(),
        })
        .where(and(
          eq(loansTable.id, loanId),
          // Defence-in-depth: even with FOR UPDATE we re-assert no one drove
          // the balance below `take`.
          sql`(${loansTable.outstandingBalance})::numeric >= ${String(take)}::numeric`,
        ))
        .returning({ loanNumber: loansTable.loanNumber, loanProductId: loansTable.loanProductId });
      if (updated.length === 0) {
        // Lost the race despite the lock (shouldn't normally happen) — retry.
        continue;
      }

      await tx.insert(loanRepaymentsTable).values({
        loanId,
        amount: String(take),
        paymentDate,
        paymentMethod: "CROP_DEDUCTION",
        reference: `AUTO:${sourcePaymentId}`,
        collectedById,
        sourcePaymentId,
        sourceDeliveryId,
        notes: `Auto-deducted from delivery payout (product=${productName ?? "n/a"})`,
      });

      lines.push({
        loanId,
        loanNumber: updated[0].loanNumber,
        loanProductId: updated[0].loanProductId,
        amount: Number(take.toFixed(2)),
        newOutstanding,
        closed,
      });
      remaining = Number((remaining - take).toFixed(2));
      break; // success — move on to the next loan in priority order
    }
  }

  const totalDeducted = Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2));
  return {
    totalDeducted,
    netToFarmer: Number((grossAmount - totalDeducted).toFixed(2)),
    lines,
  };
}

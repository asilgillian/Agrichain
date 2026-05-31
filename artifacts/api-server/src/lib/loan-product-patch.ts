import { db, loanProductsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { validateInputProductFields } from "./loan-pricing";

/**
 * The fields of a product PATCH that can affect the INPUT invariant. A field is
 * `undefined` when the patch does not touch it (so the current row value stands).
 */
export interface LoanProductPatchIntent {
  productType?: "INPUT" | "CASH";
  unitPrice?: number | null;
  unit?: string | null;
}

/** Invariant violation — carries an HTTP status for the route layer. */
export class LoanProductInvariantError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "LoanProductInvariantError";
  }
}

/**
 * Lock-read + invariant-check + write in one transaction. The `FOR UPDATE`
 * serialises concurrent patches so two requests can't interleave into an
 * INPUT product with a null unitPrice/unit: e.g. request A reads CASH/null,
 * request B flips the type to INPUT and adds price+unit, then A's write lands
 * and wipes them. Re-reading the locked row and re-validating the *effective*
 * post-patch state closes that window.
 *
 * Returns the updated row, or null when no product matches `id`.
 * Throws {@link LoanProductInvariantError} when the resulting state would be invalid.
 */
export async function patchLoanProductWithInvariant(
  id: string,
  setClause: Record<string, unknown>,
  intent: LoanProductPatchIntent,
) {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT product_type, unit_price, unit FROM loan_products WHERE id = ${id} FOR UPDATE
    `);
    const current = ((locked as any).rows ?? locked)[0] as
      | { product_type: string; unit_price: string | null; unit: string | null }
      | undefined;
    if (!current) return null;

    // Only revalidate when type, price, or unit are actually in play.
    if (intent.productType !== undefined || intent.unitPrice !== undefined || intent.unit !== undefined) {
      const effectiveType = intent.productType ?? current.product_type;
      const effectiveUnitPrice = intent.unitPrice !== undefined
        ? intent.unitPrice
        : (current.unit_price != null ? Number(current.unit_price) : null);
      const effectiveUnit = intent.unit !== undefined ? intent.unit : current.unit;
      const err = validateInputProductFields({
        productType: effectiveType,
        unitPrice: effectiveUnitPrice,
        unit: effectiveUnit,
      });
      if (err) throw new LoanProductInvariantError(err);
    }

    const [r] = await tx.update(loanProductsTable).set(setClause).where(eq(loanProductsTable.id, id)).returning();
    return r ?? null;
  });
}

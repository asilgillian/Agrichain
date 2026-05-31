import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, loanCategoriesTable, loanProductsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { patchLoanProductWithInvariant, LoanProductInvariantError } from "./loan-product-patch";

// Integration tests — exercise the real FOR UPDATE invariant against the dev DB.
// A random suffix keeps fixture names from colliding with real data or the
// loan_categories/loan_products unique-name constraints.
const tag = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let categoryId: string;
let productId: string;

beforeAll(async () => {
  const [cat] = await db
    .insert(loanCategoriesTable)
    .values({ name: `${tag}_cat`, interestType: "flat", interestRate: "12", penaltyRate: "5", gracePeriodDays: 30 })
    .returning();
  categoryId = cat.id;
  const [prod] = await db
    .insert(loanProductsTable)
    .values({ loanCategoryId: categoryId, name: `${tag}_prod`, productType: "INPUT", unitPrice: "1500", unit: "50kg bag" })
    .returning();
  productId = prod.id;
});

afterAll(async () => {
  if (productId) await db.delete(loanProductsTable).where(eq(loanProductsTable.id, productId));
  if (categoryId) await db.delete(loanCategoriesTable).where(eq(loanCategoriesTable.id, categoryId));
});

describe("patchLoanProductWithInvariant — INPUT invariant", () => {
  it("returns null for a non-existent product", async () => {
    const row = await patchLoanProductWithInvariant(
      "00000000-0000-0000-0000-000000000000",
      { unit: "x" },
      { unit: "x" },
    );
    expect(row).toBeNull();
  });

  it("rejects nulling the unitPrice of an INPUT product", async () => {
    await expect(
      patchLoanProductWithInvariant(productId, { unitPrice: null }, { unitPrice: null }),
    ).rejects.toBeInstanceOf(LoanProductInvariantError);
  });

  it("rejects flipping a product to INPUT without a unit", async () => {
    await expect(
      patchLoanProductWithInvariant(productId, { productType: "INPUT", unit: null }, { productType: "INPUT", unit: null }),
    ).rejects.toBeInstanceOf(LoanProductInvariantError);
  });

  it("allows a valid edit that preserves the invariant", async () => {
    const row = await patchLoanProductWithInvariant(productId, { unit: "100kg sack" }, { unit: "100kg sack" });
    expect(row?.unit).toBe("100kg sack");
  });

  // Regression for the race the FOR UPDATE lock guards: a patch that would strand
  // the product (unitPrice -> null) must be rejected even when it runs concurrently
  // with another valid patch — and the product must remain in a valid state.
  it("holds the invariant under concurrent patches", async () => {
    const stranding = patchLoanProductWithInvariant(productId, { unitPrice: null }, { unitPrice: null });
    const benign = patchLoanProductWithInvariant(productId, { unit: "25kg bag" }, { unit: "25kg bag" });
    const [strandResult, benignResult] = await Promise.allSettled([stranding, benign]);

    expect(strandResult.status).toBe("rejected");
    if (strandResult.status === "rejected") {
      expect(strandResult.reason).toBeInstanceOf(LoanProductInvariantError);
    }
    expect(benignResult.status).toBe("fulfilled");

    const [final] = await db.select().from(loanProductsTable).where(eq(loanProductsTable.id, productId));
    expect(final.productType).toBe("INPUT");
    expect(final.unitPrice).not.toBeNull();
    expect(final.unit && final.unit.trim().length).toBeGreaterThan(0);
  });
});

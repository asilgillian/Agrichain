// Pure, DB-free loan pricing + inheritance helpers.
//
// These encode the catalog contract: rate defaults live on the loan CATEGORY
// and a product inherits them unless it sets a non-null override. INPUT products
// price loans as unitPrice × quantity. Keeping this logic pure makes it unit
// testable without a database or the Express stack.

export type InterestType = "flat" | "reducing" | "none";

// `interestType` is a free-form `text` column at the DB layer, so the row types
// surface it as `string`. We accept that and narrow back to InterestType on output.
/** A product's (possibly-null) rate fields. null on any field means "inherit". */
export interface ProductRateFields {
  interestType: string | null;
  interestRate: string | number | null;
  penaltyRate: string | number | null;
  gracePeriodDays: number | null;
}

/** A category's rate defaults — always populated (non-null) by the schema. */
export interface CategoryRateFields {
  interestType: string;
  interestRate: string | number;
  penaltyRate: string | number;
  gracePeriodDays: number;
}

/** Finance-officer, per-loan overrides applied on top of the resolved defaults. */
export interface RateOverrides {
  allowFinanceOverride?: boolean;
  interestRatePctOverride?: number | null;
  penaltyRatePctOverride?: number | null;
  gracePeriodDaysOverride?: number | null;
}

export interface EffectiveRates {
  interestType: InterestType;
  interestRate: number;
  penaltyRate: number;
  gracePeriodDays: number;
}

/**
 * Resolve the rates that actually apply to a loan:
 *   1. product override (non-null field) wins over the category default;
 *   2. a finance-officer override wins over that, but only when the product
 *      permits it (allowFinanceOverride).
 */
export function resolveEffectiveRates(
  product: ProductRateFields,
  category: CategoryRateFields,
  overrides: RateOverrides = {},
): EffectiveRates {
  const interestType = (product.interestType ?? category.interestType) as InterestType;
  const baseInterest = product.interestRate != null ? Number(product.interestRate) : Number(category.interestRate);
  const basePenalty = product.penaltyRate != null ? Number(product.penaltyRate) : Number(category.penaltyRate);
  const baseGrace = product.gracePeriodDays != null ? product.gracePeriodDays : category.gracePeriodDays;

  const allow = overrides.allowFinanceOverride ?? false;
  const interestRate = allow && overrides.interestRatePctOverride != null ? overrides.interestRatePctOverride : baseInterest;
  const penaltyRate = allow && overrides.penaltyRatePctOverride != null ? overrides.penaltyRatePctOverride : basePenalty;
  const gracePeriodDays = allow && overrides.gracePeriodDaysOverride != null ? overrides.gracePeriodDaysOverride : baseGrace;

  return { interestType, interestRate, penaltyRate, gracePeriodDays };
}

/** INPUT loan principal = unitPrice × quantity, rounded to 2 dp. */
export function computeInputPrincipal(unitPrice: string | number, quantity: string | number): number {
  return Number((Number(unitPrice) * Number(quantity)).toFixed(2));
}

/** Flat-interest total. "none" interest type repays exactly the principal. */
export function computeTotalRepayable(principal: number, interestType: InterestType, interestRate: number): number {
  return interestType === "none" ? principal : Number((principal * (1 + interestRate / 100)).toFixed(2));
}

/**
 * The INPUT-product invariant: an INPUT product must carry a positive unitPrice
 * AND a non-empty unit label. Returns an error message when violated, or null
 * when the (effective) fields are valid. Non-INPUT products are always valid.
 */
export function validateInputProductFields(fields: {
  productType: string | null | undefined;
  unitPrice: string | number | null | undefined;
  unit: string | null | undefined;
}): string | null {
  if (fields.productType !== "INPUT") return null;
  const price = fields.unitPrice == null ? null : Number(fields.unitPrice);
  if (price == null || !(price > 0)) return "INPUT products require a unitPrice greater than zero";
  if (!fields.unit || !String(fields.unit).trim()) return 'INPUT products require a unit label (e.g. "50kg bag", "litre")';
  return null;
}

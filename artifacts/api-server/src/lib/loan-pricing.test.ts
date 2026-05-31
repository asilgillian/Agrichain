import { describe, it, expect } from "vitest";
import {
  resolveEffectiveRates,
  computeInputPrincipal,
  computeTotalRepayable,
  validateInputProductFields,
  type CategoryRateFields,
  type ProductRateFields,
} from "./loan-pricing";

const category: CategoryRateFields = {
  interestType: "flat",
  interestRate: "12",
  penaltyRate: "5",
  gracePeriodDays: 30,
};

// A product that overrides nothing — every rate field is null (inherit).
const inheritingProduct: ProductRateFields = {
  interestType: null,
  interestRate: null,
  penaltyRate: null,
  gracePeriodDays: null,
};

describe("resolveEffectiveRates — inheritance", () => {
  it("inherits every rate from the category when the product overrides nothing", () => {
    expect(resolveEffectiveRates(inheritingProduct, category)).toEqual({
      interestType: "flat",
      interestRate: 12,
      penaltyRate: 5,
      gracePeriodDays: 30,
    });
  });

  it("uses product overrides when they are set (non-null wins)", () => {
    const product: ProductRateFields = {
      interestType: "reducing",
      interestRate: "18",
      penaltyRate: "8",
      gracePeriodDays: 7,
    };
    expect(resolveEffectiveRates(product, category)).toEqual({
      interestType: "reducing",
      interestRate: 18,
      penaltyRate: 8,
      gracePeriodDays: 7,
    });
  });

  it("mixes: inherits the null fields, overrides the rest", () => {
    const product: ProductRateFields = {
      interestType: null, // inherit -> flat
      interestRate: "20", // override
      penaltyRate: null, // inherit -> 5
      gracePeriodDays: 0, // override (0 is a real value, not "inherit")
    };
    expect(resolveEffectiveRates(product, category)).toEqual({
      interestType: "flat",
      interestRate: 20,
      penaltyRate: 5,
      gracePeriodDays: 0,
    });
  });
});

describe("resolveEffectiveRates — finance-officer overrides", () => {
  it("applies per-loan overrides only when the product allows it", () => {
    const eff = resolveEffectiveRates(inheritingProduct, category, {
      allowFinanceOverride: true,
      interestRatePctOverride: 9,
      penaltyRatePctOverride: 3,
      gracePeriodDaysOverride: 14,
    });
    expect(eff).toEqual({ interestType: "flat", interestRate: 9, penaltyRate: 3, gracePeriodDays: 14 });
  });

  it("ignores per-loan overrides when the product forbids them", () => {
    const eff = resolveEffectiveRates(inheritingProduct, category, {
      allowFinanceOverride: false,
      interestRatePctOverride: 9,
      penaltyRatePctOverride: 3,
      gracePeriodDaysOverride: 14,
    });
    // Falls back to inherited category defaults.
    expect(eff).toEqual({ interestType: "flat", interestRate: 12, penaltyRate: 5, gracePeriodDays: 30 });
  });

  it("falls back to the resolved default when an override is null", () => {
    const eff = resolveEffectiveRates(inheritingProduct, category, {
      allowFinanceOverride: true,
      interestRatePctOverride: null,
      penaltyRatePctOverride: 3,
      gracePeriodDaysOverride: null,
    });
    expect(eff).toEqual({ interestType: "flat", interestRate: 12, penaltyRate: 3, gracePeriodDays: 30 });
  });
});

describe("computeInputPrincipal — principal = unitPrice × quantity", () => {
  it("multiplies and rounds to 2 dp", () => {
    expect(computeInputPrincipal("1500", 3)).toBe(4500);
    expect(computeInputPrincipal(2500.5, 2)).toBe(5001);
  });

  it("handles string numerics from the DB", () => {
    expect(computeInputPrincipal("999.99", "10")).toBe(9999.9);
  });
});

describe("computeTotalRepayable", () => {
  it('repays exactly the principal when interest type is "none"', () => {
    expect(computeTotalRepayable(10000, "none", 12)).toBe(10000);
  });

  it("applies flat interest as principal × (1 + rate/100)", () => {
    expect(computeTotalRepayable(10000, "flat", 12)).toBe(11200);
    expect(computeTotalRepayable(4500, "flat", 18)).toBe(5310);
  });
});

describe("validateInputProductFields — INPUT invariant", () => {
  it("passes a well-formed INPUT product", () => {
    expect(validateInputProductFields({ productType: "INPUT", unitPrice: 1500, unit: "50kg bag" })).toBeNull();
  });

  it("always passes non-INPUT products regardless of price/unit", () => {
    expect(validateInputProductFields({ productType: "CASH", unitPrice: null, unit: null })).toBeNull();
  });

  it("rejects a missing or non-positive unit price", () => {
    expect(validateInputProductFields({ productType: "INPUT", unitPrice: null, unit: "bag" })).toMatch(/unitPrice/);
    expect(validateInputProductFields({ productType: "INPUT", unitPrice: 0, unit: "bag" })).toMatch(/unitPrice/);
  });

  it("rejects a missing or blank unit label", () => {
    expect(validateInputProductFields({ productType: "INPUT", unitPrice: 1500, unit: null })).toMatch(/unit label/);
    expect(validateInputProductFields({ productType: "INPUT", unitPrice: 1500, unit: "   " })).toMatch(/unit label/);
  });
});

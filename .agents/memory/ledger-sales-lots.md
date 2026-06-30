---
name: Ledger sales lot modeling
description: How historical graded coffee sales map onto the lots/contracts/allocations schema.
---

# Modeling graded sales of milled coffee output

When loading historical graded coffee sales into the sales schema (lots → sales_contracts → contract_allocations → invoices), model the sold green-coffee grades as **synthetic per-grade OUTPUT lots**, one lot per (batch, grade), with `weightKg == sale kg` and a 1:1 contract→lot allocation (`allocatedWeightKg == lot weight`).

**Why:** graded export screens (SC18/SC15/SC12) and by-products are the *milled output*, a different physical mass than the raw delivered kiboko. Allocating a large grade's sale weight against a single raw delivery lot violates lot mass-balance (allocated > lot weight) and corrupts warehouse/traceability analytics. A first review failed the import for exactly this.

**How to apply:**
- `lots.deliveryId` is NOT NULL, so an output lot must reference *some* delivery — point it at the batch's first delivery as a provenance anchor only.
- Keep raw per-delivery "received" lots separate (different lotTag prefix) with zero sales allocations.
- Make allocation idempotent by delete-by-contractId then insert (contract_allocations has no natural unique key).
- Add a reconciliation check: no output lot's summed allocation may exceed its weight.

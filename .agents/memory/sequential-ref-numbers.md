---
name: Sequential reference numbers
description: Why per-day reference-number generators must use max suffix, not row count
---
Rule: when generating per-day sequential reference numbers (e.g. `GRD-YYYYMMDD-XXXXX`, `DLV-…`, `B-…`), derive the next suffix from `max(existing suffix) + 1`, never from `count(*) + 1`.

**Why:** once rows can be deleted/voided, the count falls below the highest surviving suffix, so a count-based generator produces a number that already exists — and because a retry recomputes the same count, the unique-index retry loop never resolves and every subsequent create 500s. This bit the grading-run void feature: deleting one run permanently broke run creation for the rest of the day until the generator was switched to max-suffix.

**How to apply:** any entity with an auto-generated `PREFIX-date-sequence` reference and any delete/void path. Check other generators (deliveries, batches) if they ever gain a delete path.

Second rule: max-suffix over surviving rows is still not enough once hard-delete (void) exists — deleting the highest-numbered row lets the next create RE-ISSUE that number, which corrupts audit/correction trails ("correction of voided run X" where the new run itself becomes X). Derive the max over numbers EVER ISSUED, e.g. union the live table with the immutable audit-log create snapshots (`audit_logs.after->>'runNumber'`), as the grading-run generator now does.

---
name: api-server testing conventions
description: How tests run in artifacts/api-server (vitest + live dev Postgres), and the rules DB integration tests must follow.
---

# api-server testing

Vitest is the test runner for `artifacts/api-server` (`pnpm --filter @workspace/api-server run test`). `@workspace/db` exports TS source directly (`./src/index.ts`), so vitest/esbuild consumes it with no prior build — tests can import `db` and tables straight away.

## DB integration tests run against the LIVE dev Postgres
There is no separate test database. Tests that touch `db` mutate the same dev DB the app uses.

**Rules — apply to every DB-backed test:**
- Randomize fixture names (e.g. a `__test_${Date.now()}_${rand}` tag) to dodge real data and unique-name constraints (`loan_categories_name_uniq`, `loan_products_category_name_uniq`, etc.).
- Always clean up inserted rows in `afterAll` by captured id. Delete children before parents (FK `onDelete: restrict` will otherwise block, e.g. loan_products before loan_categories).
- `vitest.config.ts` sets `fileParallelism: false` because files share one Postgres — keep it that way to avoid cross-file interference.

**Why:** writing to the shared dev DB without cleanup leaves orphan rows that can trip unique constraints and pollute the running app the user sees in the preview.

**How to apply:** when adding any api-server test that calls `db`, follow the randomized-name + afterAll-cleanup pattern already in `src/lib/loan-product-patch.test.ts`. Pure logic with no DB (see `loan-pricing.test.ts`) needs none of this.

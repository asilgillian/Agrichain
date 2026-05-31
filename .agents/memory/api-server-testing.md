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

## The dev DB can lag the committed Drizzle schema
The live dev Postgres is not guaranteed to match the committed schema in `lib/db/src/schema`. A `db.select()` covering all columns surfaces drift as an opaque drizzle `Error: Failed query: select ...` (the underlying pg "column does not exist" is swallowed). When a route 500s on a plain select during a test, suspect missing columns first.

**Fix:** `pnpm --filter @workspace/db run push` reconciles the dev DB to the schema (additive nullable/defaulted columns apply non-interactively). `push-force` if it stalls on a conflict prompt.

**Why:** mocking real money-movement helpers (e.g. `applyAutoDeductionsForFarmerPayment` in `lib/loan-deductions`) via `vi.mock` only exercises route logic — the route still hits the real dev DB, so schema drift fails the test even when the mock is correct.

## Mocking with vitest + top-level dynamic imports
Tests here use top-level `await import(...)` for `@workspace/db` and routers. To mock a module the router imports, declare the spy with `vi.hoisted(() => ({...}))` then `vi.mock("../lib/...", () => ({...}))` — plain `const` spies referenced in a `vi.mock` factory hit TDZ because `vi.mock` is hoisted above them.

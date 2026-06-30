---
name: Drizzle transaction error unwrapping
description: pg error code/constraint move to e.cause when a query fails inside db.transaction()
---

When a query throws **inside a `db.transaction(async (tx) => {...})` callback**, drizzle (node-postgres) wraps the original pg error. The top-level error has only `{ query, params, cause }` — `e.code` and `e.constraint` are **undefined**. The real values are on `e.cause.code` / `e.cause.constraint`.

Direct (non-transactional) `db.insert(...)` calls throw the pg error unwrapped, so `e?.code === "23505"` works there.

**Why:** A supplier uniqueness 409 handler checked only `e?.code === "23505"`, but the insert ran inside a transaction, so the unique-violation surfaced as a 500 instead of 409.

**How to apply:** In any catch around transactional DB work, unwrap both levels:
```ts
const pgCode = e?.code ?? e?.cause?.code;
const pgConstraint = e?.constraint ?? e?.cause?.constraint;
if (pgCode === "23505") { /* map constraint -> friendly 409 */ }
```
Map specific constraint names (e.g. `suppliers_farmer_id_uniq`) to distinct messages so collisions don't return a misleading default.

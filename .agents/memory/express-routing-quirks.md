---
name: Express routing & Drizzle param quirks (api-server)
description: Non-obvious gotchas when adding routes that look up DB rows by req.params in the api-server.
---

## Public routes mounted before requireAuth can 401 misleadingly
Public routers (e.g. provider webhooks) are mounted in `routes/index.ts` BEFORE `router.use(requireAuth)`. If a request to such a route returns `{"error":"Unauthorized"}`, it usually means the **internal path didn't match** so the request fell through past the public router and hit `requireAuth` — NOT that auth is misconfigured. Verify the exact path (including the `/api` mount prefix from `app.use("/api", router)`).

**How to apply:** When a "public" endpoint 401s, first confirm the route path matches (curl a deliberately-bad variant — if it also 401s instead of 400/404, the route isn't matching). Restart the api-server after changing the mount; its `dev` script does a full build+start, so edits to route mounting need a restart to take effect.

## `eq(table.id, req.params.x)` needs `as string`
`tsconfig.base.json` enables `noUncheckedIndexedAccess`, so `req.params.x` (even destructured, even after an `if (!x) return` guard) does not satisfy Drizzle's `eq` overloads and produces a confusing "No overload matches this call" TS2769. Repo convention is to cast: `eq(table.id, x as string)`.

**Why:** Drizzle's overload resolution rejects the `string | undefined` it infers; the runtime guard narrows for JS but the overload still fails at the type level.

## Looking up by UUID column with arbitrary input
Querying a `uuid` column (e.g. `payments.id`) with a non-UUID string makes Postgres throw (invalid input syntax) → 500. When the value comes from untrusted input (webhook body, query param), guard with a UUID regex before the `eq(...id, value)` lookup.

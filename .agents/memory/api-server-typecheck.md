---
name: api-server typecheck pitfalls (Express types + date columns)
description: Two recurring root causes of mass TS errors in api-server, and the repo's chosen fixes.
---

## `@types/express-serve-static-core` must stay pinned to 5.0.7
There is a pnpm override `'@types/express-serve-static-core': 5.0.7` in `pnpm-workspace.yaml`.

**Why:** 5.1.x changed `ParamsDictionary` from `{ [key: string]: string }` to `{ [key: string]: string | string[] }`. With that, every `req.params.x` becomes `string | string[]`, which breaks Drizzle `eq()` overloads and `res.status()` calls across ~50 sites. 5.0.7 keeps `req.params.x` a single string.

**How to apply:** Do NOT remove this override when bumping Express/@types/express unless you are prepared to handle `string | string[]` params everywhere. If a flood of `req.params`-related "No overload" errors suddenly appears, check whether this override got dropped or out-bound by a newer transitive pin.

## DB `date(...)` columns vs Zod `coerce.date()` bodies
Drizzle `date("col")` columns are mode-string (they want a `YYYY-MM-DD` **string**), but the OpenAPI→Zod codegen models calendar dates as `z.coerce.date()`, so `parsed.data.<field>` is a JS `Date`. Spreading a parsed body straight into `.values(parsed.data)` then fails type-check with "No overload matches this call".

**Why:** The API contract and the DB disagree on the representation of calendar dates (Date vs string). Runtime happens to work (pg coerces Date), but the type layer rejects it.

**How to apply:** Convert at the insert/update boundary with `toDbDate(...)` from `artifacts/api-server/src/lib/dates.ts` (overloaded: required→`string`, optional/nullable→`string | null`). Any new route inserting into a `date` column must wrap that field, e.g. `enrolmentDate: toDbDate(parsed.data.enrolmentDate)`.

## mockup-sandbox typecheck failure is unrelated / pre-existing
`pnpm run typecheck` fails inside `artifacts/mockup-sandbox` (calendar.tsx / spinner.tsx) due to TWO `@types/react` versions resolving (19.1.17 vs catalog 19.2.14 → "Two different types with this name exist"). This is a design-artifact dependency-dedup issue, not an api-server problem; api-server + all libs typecheck clean independently.

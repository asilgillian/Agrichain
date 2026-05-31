---
name: Paginated list endpoints
description: Which agri-web/api list endpoints return a pagination envelope vs a bare array, so clients consume the right shape.
---

`GET /api/farmers` returns a pagination envelope `{ data, total, page, limit }`,
not a bare `Farmer[]`. Any client (web TanStack Query, mobile) that does
`(hits ?? []).slice(...)` directly on the response silently breaks the picker —
the value is an object, not an array.

**Why:** A capture-delivery farmer picker was added treating the response as an
array; results never rendered. By contrast `GET /api/suppliers` DOES return a
bare array, which masked the inconsistency during review.

**How to apply:** In queryFn, await and return `.data` for farmers
(`(await fetch<{ data: Farmer[] }>(...)).data`). Before wiring any list endpoint
into a picker, check whether it wraps results in `{data,...}` or returns an array
— the repo is inconsistent between the two.

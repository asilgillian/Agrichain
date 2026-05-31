---
name: List endpoint response shapes are inconsistent
description: This API mixes pagination-envelope and bare-array list responses; verify per endpoint before consuming.
---

This API is NOT consistent about list response shape: some endpoints return a
pagination envelope `{ data, total, page, limit }`, others return a bare array.

**Why:** Wiring a list endpoint into a picker/table while assuming the wrong
shape fails silently — `(resp ?? []).map(...)` on an envelope object renders
nothing, with no type error when the call is hand-rolled (not via codegen).

**How to apply:** Before consuming any list endpoint, check the OpenAPI spec /
route handler for whether it wraps results in `{data,...}` or returns an array,
and unwrap accordingly. When in doubt, prefer the codegen'd hook whose type
encodes the shape rather than a hand-rolled fetch.

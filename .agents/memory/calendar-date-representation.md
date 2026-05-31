---
name: Calendar date representation
description: Why calendar dates use a CalendarDate string-pattern schema instead of OpenAPI `format: date`, and how to add new ones.
---

Calendar-date fields (birthdays, scheduled/harvest/season dates, etc.) are modeled in `lib/api-spec/openapi.yaml` via a shared `CalendarDate` component: `type: string`, `pattern: '^\d{4}-\d{2}-\d{2}$'`. New calendar-date fields should `$ref: '#/components/schemas/CalendarDate'`, NOT use `format: date`.

**Why:** orval is configured with `useDates: true` (needed so `format: date-time` timestamps become JS `Date` in the generated Zod). But orval's date handling cannot distinguish `date` from `date-time` — with `useDates: true`, BOTH `format: date` and `format: date-time` generate `z.coerce.date()` (a `Date`). The Drizzle `date(...)` columns store plain `YYYY-MM-DD` strings (default string mode), so a `format: date` field forced a manual `Date -> string` conversion at every insert. Using a plain string-with-pattern makes the generated Zod a `z.string().regex(...)`, matching the DB string columns directly — no per-insert conversion.

**How to apply:**
- New calendar date in the contract → `$ref` the `CalendarDate` schema. It flows through as a string in both api-zod and api-client-react (the react TS type is `CalendarDate = string`).
- Then just spread `parsed.data` into the Drizzle insert; do NOT add any date conversion helper.
- Timestamps (created/updated/...At) stay `format: date-time` → remain `Date` in Zod; Drizzle `timestamp` columns accept `Date`.
- Do NOT switch orval to `useDates: false` to "fix" calendar dates — that would also turn every `date-time` timestamp into a string and break timestamp inserts.

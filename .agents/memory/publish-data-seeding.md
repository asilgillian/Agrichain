---
name: Replit publish syncs schema, not data
description: How production database schema vs data is handled on Replit publish, and the supported way to seed prod data.
---

When you Publish/deploy on Replit's managed PostgreSQL, the platform diffs the
**development schema against production and applies the schema diff** (asking the
user to resolve renames in the Publish UI). It does **NOT** copy any rows. So a
freshly-published app has all tables but zero data.

**Why:** The agent's `executeSql` production access is READ-ONLY (SELECT only) by
design — it cannot INSERT into prod. There is no agent-driven path to write prod data.

**How to apply:** To load historical/seed data into prod, run an *idempotent*
importer with the production `DATABASE_URL`. The clean pattern used here:
- Put the import logic in a **lib** (artifacts cannot import from `scripts`), exporting
  an async function that returns a structured reconciliation result (no console.log /
  process.exit).
- Add a **secret-token-gated** endpoint in the API server (e.g. `POST /api/admin/seed-ledger`,
  header `x-seed-token` compared with `timingSafeEqual` to a secret env var),
  registered OUTSIDE Clerk auth so it can be triggered without a session. Fail closed
  (503) when the token env var is unset.
- Importer must be idempotent (natural-key upserts) so re-runs are safe.
- Precondition: the importer here picks an owner user (SystemAdministrator or first
  user); **prod must have ≥1 user** (log in once via Clerk) or it throws "No user found".
- Treat as a one-time migration control: high-entropy token, run once, then remove the
  route and unset the token. A newly-added secret only reaches prod after the next publish.

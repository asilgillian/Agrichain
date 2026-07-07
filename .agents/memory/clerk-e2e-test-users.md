---
name: Clerk e2e test users
description: How to promote a Clerk test user's role in e2e tests without case-mismatch or timing failures
---
Rule: in e2e test plans that sign up a Clerk user and then promote them via SQL, (1) use an ALL-LOWERCASE email, and (2) load any app page once BEFORE the UPDATE.

**Why:** Clerk lowercases the email it reports, so the app's lazily-created `users` row stores the lowercase form. A `WHERE email = '<mixed-case nanoid email>'` UPDATE matches 0 rows; the tester then "upserts" a duplicate row and the real signed-in user stays `Pending` → every permissioned endpoint 403s and the UI looks empty/disabled ("no active profiles", disabled buttons) with no obvious error. The users row also only exists after the first authenticated API request, so an UPDATE run before first page load hits nothing.

**How to apply:** in runTest plans, generate emails like `admin${nanoid(6).toLowerCase()}@example.com`, match with `lower(email) = lower(...)`, visit the app before the role UPDATE, verify the UPDATE affected 1 row, then hard-reload (permissions are re-read per request). Never INSERT a users row manually.

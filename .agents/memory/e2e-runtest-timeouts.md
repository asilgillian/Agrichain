---
name: e2e runTest timeouts
description: How to keep Playwright runTest e2e runs from timing out in this project
---
The `runTest` testing subagent can hit its StartToClose timeout (and the code_execution notebook's 600s limit) on multi-step plans that mix DB mutations, page reloads, and conditional filtering steps.

**Why:** A broad plan (sign-in → DB role promotion → reload → verify → conditionally interact with dropdowns → verify network calls) timed out; a lean 5-step plan with one [Verify] block succeeded in well under the limit.

**How to apply:** Keep runTest plans to one focused flow with a single consolidated [Verify] block; avoid conditional interaction steps ("if options exist, select one"). Clerk login is programmatic via `testClerkAuth: true`; promote the fresh user with `UPDATE users SET role = 'SystemAdministrator' WHERE email = ...` then do a full page load.

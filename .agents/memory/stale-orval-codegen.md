---
name: Stale Orval codegen
description: Missing @workspace/api-client-react exports in typecheck usually mean stale generated client, not bad imports.
---
When the web app typecheck reports many `Module '"@workspace/api-client-react"' has no exported member ...` errors, regenerate first: `pnpm --filter @workspace/api-spec run codegen` then `pnpm run typecheck:libs`.
**Why:** the generated client under `lib/api-client-react/src/generated` is committed output; spec edits without codegen leave it behind, producing dozens of phantom errors.
**How to apply:** always run codegen + libs build before hand-fixing missing-export errors; also remember the server can drift ahead of `openapi.yaml` (fields returned but not declared) — fix the spec, not the client.

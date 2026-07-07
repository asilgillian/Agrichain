---
name: Dev workflow restart quirks
description: How artifact dev servers run locally and how to restart them after server-side code changes
---

**Rule:** Workflow names follow `artifacts/<dir>: <Title>` (e.g. `artifacts/api-server: API Server`), not the artifact slug. The api-server dev workflow runs `build` then `start` on the bundled `dist/index.mjs` — there is no watch/HMR, so any server source change requires restarting that workflow to take effect.

**Why:** Restarting by slug (`api-server`) fails with RUN_COMMAND_NOT_FOUND, and killing the node process by hand leaves the workflow in FAILED state without respawning a healthy server.

**How to apply:** After editing api-server code, call restart_workflow with the full `artifacts/api-server: API Server` name (the restart re-runs the build). Web/mobile Vite/Expo workflows hot-reload and rarely need restarts.

# Bolt.new / WebContainer portability notes

This branch removes the three Replit-only dependencies that stood between
this codebase and running inside Bolt.new's browser-based WebContainer
preview (or any other non-Replit host). Nothing about the app's behavior is
intended to change — these are infrastructure swaps, not feature changes.

## 1. Database driver: `pg` → `@neondatabase/serverless`

**Why:** WebContainers run inside a real browser tab and can't open raw TCP
sockets, which is what `pg`'s `Pool` needs for a direct Postgres connection.
It would simply hang or fail to connect.

**What changed:** `lib/db/src/index.ts` now uses
`@neondatabase/serverless`'s `Pool` (WebSocket mode) with
`drizzle-orm/neon-serverless`, instead of `pg` with
`drizzle-orm/node-postgres`. WebSockets are a standard browser API, so this
works inside WebContainers — Neon's own changelog specifically calls out
StackBlitz compatibility as a design goal for this driver.

Importantly, this is the *WebSocket* mode, not Neon's plain HTTP mode. HTTP
mode batches an entire `db.transaction()` callback into a single request and
can't run interactive, read-then-conditionally-write logic — this codebase
uses exactly that pattern in ~20 places (retry-on-collision reference number
generation, guarded status transitions, etc.). WebSocket mode preserves full
Drizzle transaction semantics, so those call sites don't need to change.

**What you need to do:**
- Provision a Postgres database that speaks Neon's WebSocket proxy protocol
  — a [Neon](https://neon.tech) project's connection string works directly.
  Bolt also has its own built-in database option now (Bolt Database); if you
  use that instead, check whether it exposes a Neon-proxy-compatible
  connection string, or you may need to adjust the driver again.
- `DATABASE_URL` format is unchanged — same `postgres://...` string as
  before.
- `pnpm --filter @workspace/db run push` (drizzle-kit) is **not** affected by
  this change and still expects a normal Postgres connection — but run it
  from a real terminal (your own machine or CI), not from inside Bolt's
  in-browser terminal, since drizzle-kit's own introspection also needs a raw
  TCP connection that a WebContainer can't provide.

## 2. Object storage: Replit sidecar → generic S3-compatible client

**Why:** `artifacts/api-server/src/lib/objectStorage.ts` exchanged tokens
with `http://127.0.0.1:1106` — Replit's local credential-broker sidecar for
its Object Storage product — to get short-lived Google Cloud Storage
credentials. That sidecar only exists inside a Replit workspace; every call
failed anywhere else.

**What changed:** `objectStorage.ts` and `objectAcl.ts` were rewritten
against `@aws-sdk/client-s3` — a generic S3-compatible client that works with
real AWS S3, Cloudflare R2, Supabase Storage, Backblaze B2, MinIO, or
anything else that speaks the S3 API. ACL policy (previously stored as GCS
custom object metadata) is now stored as S3 user metadata via a
copy-object-onto-itself with `MetadataDirective: REPLACE`, since S3 has no
in-place metadata update call.

The public shape of `ObjectStorageService` is unchanged for every method the
app actually calls, **except** `getObjectEntityUploadURL()`, which now
returns `{ uploadURL, objectPath }` directly instead of just the URL (the
caller previously had to re-derive `objectPath` by parsing the signed URL
after the fact — fragile, and specific to GCS's URL shape). The one call site
(`routes/storage.ts`) was updated to match.

**What you need to do:**
- Create a bucket with your S3-compatible provider of choice.
- Set `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (leave unset
  for real AWS S3), `S3_REGION`, and optionally `S3_FORCE_PATH_STYLE` — see
  `.env.example`.
- `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` are unchanged in format
  (`/bucket/prefix`), just no longer require Replit's "Object Storage" tool
  to provision.
- The frontend uploader (`lib/object-storage-web`) needed no changes — it was
  already provider-agnostic (POST for a presigned URL, then PUT the file to
  whatever URL comes back).

## 3. Mobile dev script: Replit tunnel vars → Expo's own tunnel

**Why:** `artifacts/agri-mobile/package.json`'s `dev` script hardcoded
`REPLIT_EXPO_DEV_DOMAIN`, `REPLIT_DEV_DOMAIN`, and `REPL_ID` to wire Expo's
packager and React Native's bundler to Replit's public dev-tunnel domain.
None of those env vars are set outside Replit.

**What changed:** the script now uses `expo start --tunnel` (Expo's own
ngrok-based public tunnel — `@expo/ngrok` was already a dependency) instead
of `--localhost` plus manual domain wiring. This is a generically portable
choice that doesn't need to know any given host's internal preview-domain
convention.

The app code itself needed no changes: every screen that talks to the API
already resolves its base URL as `EXPO_PUBLIC_API_URL ??
(EXPO_PUBLIC_DOMAIN ? https://${EXPO_PUBLIC_DOMAIN} : "")` — `EXPO_PUBLIC_API_URL`
was already documented in-code as "the canonical override." Dropping
`EXPO_PUBLIC_DOMAIN` from the script just means that fallback branch no
longer fires; it was never a hard requirement.

**What you need to do:**
- Set `EXPO_PUBLIC_API_URL` to wherever `artifacts/api-server` ends up
  reachable (a Bolt preview URL, a separately deployed URL, etc.) — the
  mobile app can't rely on same-origin requests the way the web app can.
- Bolt has its own beta Expo integration/partnership, which may have its own
  conventions for wiring a dev server — if `--tunnel` doesn't play well with
  it, that's the next thing to adjust; this fix removes the definitely-wrong
  Replit coupling, not a guess at Bolt-specific internals.

## What this branch does *not* address

- **Getting the project into Bolt at all.** Bolt's primary import path is
  connecting a GitHub account and importing a repository through Bolt's
  GitHub App — there's no "upload a zip to start a project" flow. Push this
  branch to GitHub first.
- **Whether Bolt's importer handles a project this size well.** This is a
  3-surface pnpm workspace (web SPA, Express API, Expo mobile app) with a
  large dependency tree. Bolt v2 claims much better large-project handling,
  but there are live reports of its importer hanging on big repos — worth
  going in expecting you might need to import `artifacts/agri-web` on its
  own first to prove the workflow, or have patience with the full monorepo
  import.
- **Everything from the earlier completeness audit** (fabricated EUDR
  numbers, the unwired silo-batch signoff table, thin test coverage, etc.) —
  those are separate, already addressed on top of this branch; see
  `AgriChain-Completeness-Audit.docx` and the corresponding commits.

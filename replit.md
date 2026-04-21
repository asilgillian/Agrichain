# Mtandeo Commodities Ltd — Digital Agriculture Platform

## Overview

Full-stack digital agriculture platform for managing agricultural supply chains. Field agents register farmers, map plots by GPS, and collect data offline on Android (auto-sync). Back-office teams manage procurement, payments, warehouse traceability, certification compliance (EUDR, Rainforest Alliance), and export documentation.

## Architecture

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

### Artifacts
- **Web App** (`artifacts/agri-web`) — React + Vite SPA at path `/`, port from `$PORT`. Back-office management interface.
- **API Server** (`artifacts/api-server`) — Express 5 API server at port 8080. Serves `/api/*` routes.

### Libraries
- **`lib/db`** — Drizzle ORM schema + PostgreSQL client (`@workspace/db`)
- **`lib/api-spec`** — OpenAPI spec + Orval codegen config (`@workspace/api-spec`)
- **`lib/api-zod`** — Orval-generated Zod schemas (`@workspace/api-zod`)
- **`lib/api-client-react`** — Orval-generated React Query hooks (`@workspace/api-client-react`)

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **Package manager**: pnpm
- **TypeScript**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + shadcn/ui + Tailwind CSS + TanStack Query + wouter
- **Build**: esbuild (for API server)

## Database Schema

17 tables in `lib/db/src/schema/`:
- `regions` — Geographic regions (Kenya counties)
- `users` — System users (agents, managers, etc.)
- `groups` — Farmer cooperative groups
- `farmers` — Farmer registry
- `plots` — Agricultural plots with GPS/GeoJSON
- `certification_streams` — Certification types (EUDR, Rainforest Alliance)
- `certification_enrolments` — Farmer-to-stream enrolment records
- `survey_templates` — Survey form definitions
- `survey_submissions` — Field survey responses
- `visits` — Scheduled field visits
- `batches` — Farmer batch aggregations (for procurement)
- `deliveries` — Inbound deliveries with multi-step approval workflow
- `lots` — Warehouse lot inventory
- `payments` — Farmer payments
- `gap_assessments` — Good Agricultural Practice scores
- `training_sessions` — Training event records
- `export_contracts` — Export contract records
- `shipments` — Shipment containers
- `export_documents` — Export document tracker
- `assets` — Physical asset registry
- `activity_funds` — Field agent activity fund requests
- `audit_logs` — Immutable system audit trail

## API Routes (all under `/api`)

All 11 modules implemented:
- `GET/POST /dashboard/*` — KPIs, activity feed, compliance overview, procurement stats
- `GET/POST /farmers`, `GET/PATCH /farmers/:id`, `GET /farmers/duplicates`, `POST /farmers/duplicates/:pairId/merge`
- `GET/POST /groups`, `GET /groups/:id`
- `GET/POST /plots`, `GET /plots/:id`
- `GET /certifications/streams`, `GET/POST /certifications/enrolments`
- `GET/POST /surveys/templates`, `GET/POST /surveys/submissions`, `POST /surveys/submissions/:id/review`
- `GET/POST /visits`, `POST /visits/:id/complete`
- `GET/POST /batches`, `GET /batches/:id`, `POST /batches/:id/lock`
- `GET/POST /procurement/deliveries`, `GET /procurement/deliveries/:id`, weight/QC/pricing/approve endpoints
- `GET /warehouse/lots`, `GET /warehouse/lots/:id`, `GET /warehouse/mass-balance`
- `GET/POST /payments`, `GET /payments/summary`
- `GET /compliance/eudr`, `GET/POST /compliance/gap-assessments`, `GET/POST /compliance/training-sessions`
- `GET/POST /exports/contracts`, `GET /exports/shipments`, `GET /exports/shipments/:id`, `GET /exports/shipments/:id/documents`
- `GET/POST /users`, `GET/PATCH /users/:id`
- `GET/POST /assets`, `GET /assets/:id`, assign/return endpoints
- `GET/POST /activity-funds`, `POST /activity-funds/:id/approve`
- `GET /audit`
- `GET/POST /admin/regions`, `GET /admin/roles`, `PATCH /admin/roles/:id/permissions`, `GET /admin/sync-queue`

## Frontend Pages (24 routes)

- `/` — Dashboard with KPIs, activity feed, compliance overview
- `/farmers` — Farmer registry with search and pagination
- `/farmers/:id` — Farmer detail with plots, certifications, surveys
- `/farmers/duplicates` — Duplicate detection and merge workflow
- `/groups` — Farmer groups list
- `/groups/:id` — Group detail with member roster
- `/procurement` — Delivery list with multi-step status indicators
- `/procurement/:id` — Delivery detail: weight → QC → pricing (gated) → approval
- `/warehouse` — Lot inventory + mass balance report
- `/warehouse/:id` — Lot detail with chain of custody
- `/payments` — Payment list with KES summary cards
- `/compliance` — EUDR status, GAP assessments, training sessions
- `/surveys` — Survey templates and submission QA
- `/exports` — Export contracts and shipments
- `/staff` — User management
- `/assets` — Asset registry
- `/activity-funds` — Fund request tracker
- `/audit` — Immutable audit log
- `/loans` — Loan management with status/type filters and portfolio KPIs
- `/loans/:id` — Loan detail with repayment history and approve/disburse workflow
- `/buyers` — Buyer registry card view with search
- `/sales` — Sales & Commodity Exit: Contracts / Dispatches / Invoices tabs
- `/sales/:id` — Contract detail with lot allocations and invoices
- `/admin` — Regions, roles, sync queue

## New Schema Tables (Prisma schema expansion)

Added in expansion:
- `loans`, `loan_repayments`, `loan_guarantors` — Full loan lifecycle
- `buyers`, `sales_contracts`, `contract_allocations`, `dispatches`, `invoices` — Sales/exit module
- `buying_stations`, `agent_cash_floats`, `cash_float_transactions` — Buying station + cash float
- `silos`, `silo_assignments`, `silo_batches`, `silo_batch_processes` — Silo processing
- `storage_bins`, `warehouse_assignments`, `stock_movements` — Storage management
- `preprocessing_steps` — Configurable processing deductions
- `farmer_cards`, `group_leadership`, `rejection_logs` — Registry enhancements
- `asset_categories`, `asset_assignments`, `maintenance_schedules`, `maintenance_logs` — Enhanced assets
- `activity_types`, `activity_reconciliations` — Activity fund reconciliation
- Farmers table: added `household_size`, `dependants`, `head_of_household`, `land_tenure`, `biometric_photo_url`, `registration_date`, `approved_at`

## Key Commands

```bash
pnpm --filter @workspace/api-spec run codegen      # Regenerate hooks/schemas from OpenAPI spec
pnpm --filter @workspace/db run push               # Push DB schema (dev only)
pnpm --filter @workspace/db run push-force         # Force push schema
pnpm --filter @workspace/db run seed               # Seed database with sample data
pnpm --filter @workspace/api-server run dev        # Run API server locally
pnpm --filter @workspace/agri-web run dev          # Run web app locally
pnpm run typecheck                                 # Full typecheck
```

## Seed Data (Kenya)

- 2 regions (Nyeri County, Kirinyaga County)
- 3 users (2 field agents, 1 manager)
- 2 farmer groups
- 3 farmers with plots, certifications (EUDR + Rainforest Alliance)
- 2 batches, 2 deliveries (1 approved, 1 pending QC)
- 1 warehouse lot
- 2 payments, GAP assessments, training sessions
- 1 export contract + shipment
- 3 assets, 2 activity fund requests, 3 audit log entries
- Default currency: KES (Kenyan Shilling)

## Notes

- Procurement delivery pricing screen is gated: requires `weightApproved AND qcApproved` before pricing can be set
- Frontend uses `@workspace/api-client-react` for all API calls — never relative paths
- API uses structured pino logging — never `console.log`
- Orval config uses `indexFiles: false` for zod target to avoid barrel file conflicts
- `lib/api-zod/src/index.ts` must only export from `./generated/api` (not types)
- All 8 module list pages have wired Create/Action dialogs (Farmers, Groups, Procurement, Activity Funds, Assets, Staff, Exports, Compliance) — direct `fetch` POST + react-query invalidation; payloads omit empty optional fields and validate numbers/dates client-side; staff role enum uses capitalized values (Agronomist, Manager, etc.)
- Admin Roles & Permissions: 8 system roles seeded (Agronomist, Manager, Supervisor, ProcurementHead, FinanceOfficer, SystemAdministrator, WarehouseManager, ComplianceOfficer) with `isSystem=true` (cannot be deleted). PERMISSION_CATALOG in `artifacts/api-server/src/routes/admin.ts` is source of truth (~40 keys grouped by module, plus `*` wildcard). Endpoints: `GET /api/admin/permissions`, `GET/POST /api/admin/roles`, `PATCH /api/admin/roles/:roleId/permissions`, `DELETE /api/admin/roles/:roleId`. Path roleId is UUID-validated. Server rejects unknown permission keys.
- ⚠️ Auth: `/api/admin/*` (and all other API routes) currently have no authentication or authorization. A dedicated auth feature must be added before production.

## Group Management Module (10 capabilities)

Schema (`lib/db/src/schema/groups.ts`):
- `groupsTable` extended with: `parish`, `subCounty`, `district`, `parentGroupId` (hierarchy), `groupType` (cooperative|association|producer_group), `status` (active|archived), `archivedAt`, `archivedById`.
- New `groupLeadersTable`: position-based leadership terms (chairperson, secretary, treasurer, extension_lead, gender_lead) with `termStart`/`termEnd`/`status`.
- New `groupTransfersTable`: append-only audit of every farmer movement (`fromGroupId`, `toGroupId`, `reason`, `kind`: transfer|bulk_reassign|archive_redistribute, actor metadata).

API (`artifacts/api-server/src/routes/groups.ts`):
- `GET /api/groups?regionId=&status=&parentGroupId=` — list with KPIs (members, active plots, procurement volume kg, compliance score).
- `POST /api/groups` — create, with parent validation (existence + not-archived).
- `PATCH /api/groups/:id` — update with cycle prevention on parent re-link.
- `GET /api/groups/:id` — detail with parent, children, leaders, members, last 50 transfers.
- `POST /api/groups/:id/leaders` — appoint leader (transactional: auto-ends prior holder of same position with audit).
- `PATCH /api/groups/:id/leaders/:leaderId/end` — end a term.
- `POST /api/groups/:toId/transfer` — single or bulk reassign, transactional, strict UUID batch validation, rejects all-same-group.
- `POST /api/groups/:id/archive` — deactivate with required redistribution; transactional with TOCTOU re-read; per-farmer audit + leader-end audit + group-archive audit all in one tx.
- `GET /api/groups/:id/report` — CSV export for auditors (group metadata, KPIs, member roster with plot counts and area).

Permission keys (added to PERMISSION_CATALOG): `groups.read`, `groups.write`, `groups.leaders.write`, `groups.transfer`, `groups.archive`.

Farmer registration enforcement (`artifacts/api-server/src/routes/farmers.ts`): POST /api/farmers now rejects (400) missing groupId (`GROUP_REQUIRED`), unknown group (`GROUP_NOT_FOUND`), and archived group (`GROUP_ARCHIVED`).

UI (`artifacts/agri-web/src/pages/groups/detail.tsx`): full rewrite with KPI cards, hierarchy breadcrumb, leadership table with appoint/end-term, member checkbox-multiselect with single+bulk transfer dialog, archive dialog (with required redistribution target when members exist), CSV report download, transfer history.

Audit invariants: every state change (group create/update/archive, leader appoint/end, farmer group transfer) writes to `audit_logs`. Inserts that span multiple tables (transfer, archive, leader appointment) are wrapped in `db.transaction` so audit + state updates commit atomically.

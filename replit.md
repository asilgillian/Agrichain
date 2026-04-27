# Mtandeo Commodities Ltd — Digital Agriculture Platform

## Overview

This project is a full-stack digital agriculture platform designed to streamline and manage agricultural supply chains. Its primary purpose is to empower field agents with tools for farmer registration, plot mapping via GPS, and offline data collection, while providing back-office teams with comprehensive functionalities for procurement, payments, warehouse traceability, certification compliance (e.g., EUDR, Rainforest Alliance), and export documentation. The platform aims to revolutionize agricultural operations by enhancing efficiency, transparency, and compliance across the entire supply chain.

## User Preferences

- I want iterative development.
- Ask before making major changes.

## System Architecture

The project is structured as a pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

**Core Architectural Components:**

-   **Web Application (`artifacts/agri-web`):** A React + Vite Single Page Application (SPA) serving as the back-office management interface. It utilizes `shadcn/ui` and Tailwind CSS for a modern, responsive UI/UX, TanStack Query for data fetching, and wouter for routing.
-   **API Server (`artifacts/api-server`):** An Express 5 API server handling all backend logic and data interactions.
-   **Database Layer (`lib/db`):** Employs Drizzle ORM with PostgreSQL for robust data management.
-   **API Specification & Codegen (`lib/api-spec`, `lib/api-zod`, `lib/api-client-react`):** Uses OpenAPI for API specification and Orval for generating Zod schemas (`@workspace/api-zod`) and React Query hooks (`@workspace/api-client-react`) to ensure type-safe and efficient API interactions.
-   **Validation:** Zod is used for data validation across the platform.

**Key Technical Implementations and Features:**

-   **Monorepo Structure:** Facilitates development and dependency management across multiple artifacts and libraries.
-   **Database Schema:** Comprehensive schema covering farmer management, plot registration, certification, surveys, visits, procurement, warehousing, payments, compliance (EUDR, GAP), training, exports, user management, assets, activity funds, audit logs, loans, sales, buying stations, silo processing, storage management, and commodity management.
-   **API Design:** All API routes are under `/api` and cover a wide range of modules including dashboard analytics, farmer/group management, procurement, warehouse operations, payments, compliance, surveys, exports, user/asset/activity fund management, and administration.
-   **Frontend Pages:** Over 24 distinct routes providing detailed interfaces for every aspect of the platform, including dashboards, farmer/group registries, procurement workflows, warehouse inventory, payment summaries, compliance tracking, survey management, export operations, staff management, asset tracking, and an immutable audit log.
-   **Module Implementations:**
    -   **Group Management Module:** Supports hierarchical groups, leader appointments, farmer transfers, group archiving with redistribution, and comprehensive reporting. Each group is anchored to a leaf-level (deepest configured) admin unit — server-side enforced via `validateGroupRegionIsLeaf()` on POST/PATCH `/api/groups`, with a matching `useIsLeafRegion` hook on the web create dialog that disables Save and shows an inline warning when the picked region isn't a Village (or whatever the country's deepest level is).
    -   **Per-User Group Assignment & Scoped Visibility:** A `user_groups` join table (`(user_id, group_id, assigned_by_id, assigned_at, unique(user_id, group_id))`) maps each system user to the farmer groups they own. The `groups.assigned_only` permission marks a role as "scoped" (granted to Agronomist + Farmer Group Leader). All scoping logic lives in `artifacts/api-server/src/lib/assignment-scope.ts` (`isUserScoped`, `getAssignedGroupIds`, `checkGroupAccess`, `checkFarmerAccess`); wildcard admins (perms includes `*`) always bypass. Scoped users see only their assigned groups/farmers in `GET /api/groups` and `GET /api/farmers`, and every detail/mutation endpoint (group: get/patch/leaders/transfer/archive/report including `parentGroupId` and `redistributeToGroupId` cross-targets; farmer: get/patch/card/complete/preregister/register/transfer-source) is guarded server-side to prevent IDOR. Duplicates corpus endpoints are denied for scoped users. Admin UI: a "Manage Groups" dialog on `/users` (multi-select with search and region breadcrumb) PUTs the replace-set to `/api/users/:id/groups`; the users table shows a count badge fed by aggregate `/api/users-group-counts`.
    -   **Commodity Management Module:** Provides a master catalog for commodities and their types, manages daily pricing (region-specific and national fallback), and handles conversion ratios between different forms of commodities.
    -   **Farmer Registration (Phase 2):** Two-stage farmer registration. Field agents can `Pre-register` farmers with the bare minimum (name, group, region) — these get `registrationStage='pre_registered'`, `status='pending'`. Full registration via `Register Full` (or by completing a pre-registered farmer's KYC) sets `registrationStage='fully_registered'`, `status='active'`. National ID is required to complete registration (server-side enforced). Endpoints: `POST /api/farmers/preregister` (perm `farmers.preregister`), `POST /api/farmers` (perm `farmers.register`), `POST /api/farmers/:id/complete` (perm `farmers.register`). The farmers list supports filtering by `registrationStage` and shows a stage badge column. A standalone `/farmers/preregister` page is also provided.
    -   **GPS Plot Mapping (Phase 2):** Each farmer can have multiple plots; each plot can be mapped as either a single GPS Point or a Polygon (mode toggle in the Add-Plot dialog). The web UI uses `react-leaflet` + `@geoman-io/leaflet-geoman-free` (`PlotDrawMap` component) with a "Use my location" shortcut. The mobile app's `Pre-register` tab captures a Point via `expo-location`. Endpoints `POST /api/plots` and `PATCH /api/plots/:id` are gated by the `plots.gps_map` permission and validate against existing plot overlap.
    -   **Mobile Authentication:** The Expo `agri-mobile` artifact uses `@clerk/expo` with the secure token cache. The root layout wraps everything in `<ClerkProvider>`; `(auth)/sign-in.tsx` and `(auth)/sign-up.tsx` provide branded email/password flows; the `(tabs)` layout redirects signed-out users to sign-in and registers `setAuthTokenGetter(() => getToken())` so generated API client calls carry a Bearer token. Screens that use raw `fetch` (e.g. `preregister.tsx`) call `useAuth().getToken()` directly.
    -   **M1-010 Configurable Admin-Unit Hierarchy (Module 1):** Each country can define its own ordered hierarchy of admin units (e.g. Uganda: District → Sub-county → Parish → Village) via `country_hierarchies` (table seeded for UG, KE, TZ, RW). The `regions` tree stores the actual nodes (`countryCode`, `level`, `parentId`, `isActive`). Back-office tools (`RegionsManager`, `CountryHierarchyEditor`, CSV + shapefile importers) gate writes behind `admin.regions` / `admin.hierarchy`, while reads use the dedicated `regions.read` / `hierarchy.read` permissions (granted to all 12 working roles). Both web (`agri-web/src/components/RegionPicker.tsx` — cascading shadcn `<Select>`s with auto-advance through single-child paths, ancestor walk tolerant of inactive nodes) and mobile (`agri-mobile/components/RegionPicker.tsx` — full-screen modal with breadcrumb drill-down and "Stop here at &lt;level&gt;" footer) replace the legacy flat dropdown / UUID-paste inputs across all four farmer/group forms. A matching `GroupPicker` (web Popover combobox + mobile modal/FlatList) filters strictly by selected `regionId`.
    -   **Org Regions (admin-defined district clusters):** A second, organization-level grouping of country districts that lives alongside the country admin tree. `org_regions` (id, name, description, country_code, is_active) holds the cluster; `org_region_districts` (org_region_id, region_id, pk on both, cascade) maps each cluster to one or more District-level `regions` nodes. Server-side helpers in `artifacts/api-server/src/lib/org-region-scope.ts` (`getDistrictLevelForCountry`, `findAncestorRegionAtLevel`, `getOrgRegionDistrictIds`, `collectDescendantRegionIds`, `isLeafInsideOrgRegion`, `isLeafRegion`, `validateRegionIsDistrict`) drive all containment checks. Routes in `routes/org-regions.ts`: picker reads (`GET /api/org-regions`, `/:id`, `/:id/groups`, `/:id/villages`) honour per-user assignment scoping (scoped users 403 / get filtered lists for org regions they have no assigned group in; wildcard admins bypass); admin CRUD (`POST/PATCH/DELETE /api/admin/org-regions`, `PUT /:id/districts`) is gated by perm `admin.org_regions` and validates each assigned region is District-level AND its `countryCode` matches the org region's. PATCH refuses country changes (409) while districts are still mapped. The web back-office adds an "Org Regions" admin tab (`OrgRegionsManager.tsx`) for create/edit/delete + district assignment.
    -   **Mobile 3-Dropdown Form UX:** New reusable `agri-mobile/components/OrgRegionGroupVillagePicker.tsx` provides three native cascading dropdowns (Region → Farmer Group → Village). Picking a parent resets children. The mobile preregister tab (`app/(tabs)/preregister.tsx`) was rewritten to use it and submits `{ orgRegionId, groupId, regionId: villageId }`. `POST /api/farmers/preregister` accepts the optional `orgRegionId` and, when present, enforces (1) `regionId` is a true leaf (`isLeafRegion`), (2) the picked village's ancestor district sits in the org region, (3) the picked group's anchor village's ancestor district sits in the org region. The web back-office continues to use the existing detailed cascading admin-unit picker without `orgRegionId` for back-compat. Future mobile forms should reuse `OrgRegionGroupVillagePicker`.
-   **Audit Logging:** All significant state changes across modules are meticulously recorded in an immutable `audit_logs` table, ensuring transparency and traceability.
-   **Transaction Management:** Critical operations spanning multiple database tables (e.g., farmer transfers, group archiving) are wrapped in database transactions to maintain data consistency and atomicity with audit log entries.
-   **UI/UX:** Utilizes shadcn/ui and Tailwind CSS for a consistent and modern design, with dedicated dialogs for create/action operations across various modules.

## External Dependencies

-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Frontend Framework:** React
-   **Build Tool (Frontend):** Vite
-   **UI Component Library:** shadcn/ui
-   **Styling:** Tailwind CSS
-   **State Management/Data Fetching (Frontend):** TanStack Query
-   **Routing (Frontend):** wouter
-   **API Framework (Backend):** Express 5
-   **Validation Library:** Zod
-   **API Codegen:** Orval (from OpenAPI specification)
-   **Logging:** pino
-   **Build Tool (API Server):** esbuild (for local development)
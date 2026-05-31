# Mtandeo Commodities Ltd — Digital Agriculture Platform

## Overview

This project is a comprehensive full-stack digital agriculture platform designed to optimize and manage agricultural supply chains. Its primary goal is to provide field agents with essential tools for farmer registration, GPS plot mapping, and offline data collection, while equipping back-office teams with robust functionalities for procurement, payments, warehouse traceability, certification compliance (e.g., EUDR, Rainforest Alliance), and export documentation. The platform aims to significantly enhance efficiency, transparency, and compliance throughout the agricultural supply chain.

## User Preferences

- I want iterative development.
- Ask before making major changes.

## System Architecture

The project is structured as a pnpm workspace monorepo utilizing TypeScript.

**Core Architectural Components:**

-   **Web Application (`artifacts/agri-web`):** A React + Vite Single Page Application (SPA) for back-office management, featuring `shadcn/ui` and Tailwind CSS for UI/UX, TanStack Query for data fetching, and wouter for routing.
-   **API Server (`artifacts/api-server`):** An Express 5 API server handling all backend logic.
-   **Database Layer (`lib/db`):** Uses Drizzle ORM with PostgreSQL.
-   **API Specification & Codegen (`lib/api-spec`, `lib/api-zod`, `lib/api-client-react`):** Employs OpenAPI for API specification and Orval for generating Zod schemas and React Query hooks for type-safe API interactions.
-   **Validation:** Zod is used for data validation across the platform.

**Key Technical Implementations and Features:**

-   **Monorepo Structure:** Facilitates development and dependency management.
-   **Database Schema:** Comprehensive schema covering farmer management, plot registration, certification, surveys, visits, procurement, warehousing, payments, compliance, training, exports, user management, assets, activity funds, audit logs, loans, sales, buying stations, silo processing, storage management, and commodity management.
-   **API Design:** All API routes are under `/api` and cover dashboard analytics, farmer/group management, procurement, warehouse operations, payments, compliance, surveys, exports, user/asset/activity fund management, and administration.
-   **Frontend Pages:** Over 24 distinct routes for various platform functionalities including dashboards, registries, workflows, inventory, and audit logs.
-   **Group Management Module:** Supports hierarchical groups, leader appointments, farmer transfers, archiving, and reporting, with server-side enforcement of leaf-level admin unit anchoring.
-   **Per-User Group Assignment & Scoped Visibility:** Role-based access control where users only see and manage assigned groups/farmers, with detailed server-side access checks.
-   **Multi-Role Users:** Each user has one primary role on `users.role` plus zero or more *additional* roles stored in the `user_roles` join table (PK user_id + role_id). The auth middleware unions permissions from the primary role and every additional role into the effective permission set at request time. Admins manage extras from the Users page edit dialog (checkbox list of all roles other than the primary); two new endpoints `GET /api/users/:id/roles` and `PUT /api/users/:id/roles` (replace-set, body `{roleIds: uuid[]}`) back the UI. Useful when one person wears more than one hat (e.g. a Compliance Officer who also does field pre-registration).
-   **Commodity Management Module:** Manages master catalog, daily pricing, and conversion ratios for commodities.
-   **Farmer Registration:** Two-stage process (pre-registration and full registration) with national ID enforcement and specific API endpoints for each stage.
-   **GPS Plot Mapping:** Farmers can have multiple plots mapped as GPS points or polygons with overlap validation.
-   **Mobile Authentication:** Uses `@clerk/expo` for secure token management and branded authentication flows.
-   **Configurable Admin-Unit Hierarchy:** Allows defining custom administrative hierarchies per country with region management tools and picker components for web and mobile.
-   **Org Regions:** Admin-defined district clusters for additional organizational grouping and scoping, with dedicated CRUD operations and access controls.
-   **Mobile 3-Dropdown Form UX:** Reusable cascading dropdowns for Org Region, Group, and Village, integrated into mobile registration flows with robust validation.
-   **Org-Region Edit/Transfer Invariant:** Enforces district-share invariant on farmer-related mutations to maintain implicit org-region binding.
-   **Mobile Full Registration:** Three farmer creation entry points (Pre-register, Register, Complete) sharing the 3-dropdown picker UX and org-region binding rules, capturing KYC, crops, and livelihood data.
-   **Admin-Editable Registration Templates + Transaction Access Gates:** Admins can define custom farmer registration forms and gate transaction types based on configurable minimum registration stages, supported by a server-side stage computation model and a catalog of known fields.
-   **Farm + Livelihood Capture:** Mobile forms capture crops grown, other on-farm activities, and livelihood details (e.g., land, income sources, food security) with dedicated schema extensions and API integration.
-   **Delivery-First Procurement (Mobile + Web):** The procurement model is delivery-first. Field agents capture per-farmer drop-offs as `Delivery` rows (auto-generated `DLV-YYYYMMDD-XXXXX`, status `captured`, no batch yet) via mobile (`deliveries/new.tsx`) or web (Capture-delivery dialog on the procurement hub). Either surface can then group N captured deliveries that share the same `cropType` into a `Batch` (auto-generated `B-YYYYMMDD-XXXXX`) via `POST /api/batches/from-deliveries` — an atomic guarded UPDATE prevents two concurrent groupings from double-claiming a delivery. Removing the last delivery from an open batch dissolves it. The legacy `POST /api/batches` farmer-contributions path now returns 410. The existing per-delivery weight/QC/pricing/payment workflow runs unchanged once a delivery is batched.
-   **Farmer-Entrepreneurs & Third-Party Suppliers:** Two distinct seller models feed the same procurement pipeline. (1) A *farmer-entrepreneur* is an existing fully-registered farmer flagged via `farmers.isEntrepreneur` (+ `entrepreneurSince`); only entrepreneurs may take bulking loans (`loan_products.entrepreneursOnly`, server-gated). Web farmers list/detail show an entrepreneur badge and a Mark/Remove action (gated `canComplete && !isPreRegistered`, audited) via `POST`/`DELETE /api/farmers/:id/entrepreneur`. (2) A *third-party supplier* is a NEW `suppliers` entity (`sellerType` business → `businessName`+`businessRegNo`, or individual → `firstName`+`nationalId`; plus contact, location, payout method, `status`, `loanEligible` default off, auto `referenceNumber`). Suppliers are not loan-eligible. Full CRUD/search at `/api/suppliers` (perms `suppliers.read`/`suppliers.write`). A `Delivery` references EXACTLY ONE of `farmerId` | `supplierId` (both nullable, DB CHECK exactly-one); capture surfaces (web Capture-delivery dialog, mobile `deliveries/new.tsx`) carry a seller-type toggle + supplier picker and submit `farmerId` XOR `supplierId`. Supplier registration on mobile lives at `procurement/suppliers/new.tsx` (linked from the procurement hub). Once captured, supplier deliveries run the identical weight/QC/pricing/payment workflow; the payment route skips farmer loan auto-deduction for supplier payments.
-   **Pay-Farmer Flow:** Web (delivery detail) and mobile (delivery view) expose a Pay-Farmer dialog when a delivery is approved. Because each delivery now belongs to exactly one farmer, the payment amount equals the delivery's `totalValue` (no per-batch divisor). Cash payments deduct the agent's assigned cash float in a single transaction and write a `DEDUCTION` row alongside the payment; mobile-money payments validate the recipient MSISDN/provider (MTN MoMo / Airtel Money) and are recorded as `pending_external` until the gateway is wired up (gated by the `MOMO_ENABLED` feature flag). New permissions `payments.disburse.cash` and `payments.disburse.momo` are enforced per method on top of `payments.write`.
-   **Contract Fulfillment Tracking:** Procurement contracts gained an optional `targetVolumeKg` and a `GET /procurement/contracts/:id/fulfillment` endpoint that aggregates approved deliveries; the contracts list shows a per-row progress bar (delivered / target) with an inline target editor.
-   **Audit Logging:** Immutable audit logs record significant state changes for transparency and traceability.
-   **Transaction Management:** Critical operations use database transactions to ensure data consistency and atomicity.
-   **UI/UX:** Utilizes shadcn/ui and Tailwind CSS for a consistent and modern design.

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
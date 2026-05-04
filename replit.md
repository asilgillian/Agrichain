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
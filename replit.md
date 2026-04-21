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
    -   **Group Management Module:** Supports hierarchical groups, leader appointments, farmer transfers, group archiving with redistribution, and comprehensive reporting.
    -   **Commodity Management Module:** Provides a master catalog for commodities and their types, manages daily pricing (region-specific and national fallback), and handles conversion ratios between different forms of commodities.
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
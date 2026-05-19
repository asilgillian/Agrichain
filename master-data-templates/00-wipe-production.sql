-- ============================================================================
-- MTANDEO PRODUCTION RESET — wipe transactional + master data, keep system seeds
-- Generated: 2026-05-19 (revised: split into small TRUNCATEs, no in-statement
-- comments — Replit SQL Console driver doesn't accept one giant TRUNCATE with
-- 60+ tables in a single statement.)
--
-- KEEPS
--   - roles                      (system roles + permission bitmaps)
--   - country_hierarchies        (UG admin-unit level definitions)
--   - users WHERE email = 'paulineasil@gmail.com'   (bootstrap admin)
--
-- WIPES
--   - All transactional data + all master data + all admin config
--   - All non-admin users + their user_roles + user_groups assignments
--
-- HOW TO RUN
--   STEP 1: run the pre-flight SELECT (see comment block below) alone.
--           Must return exactly 1 row.  You confirmed: SystemAdministrator. OK.
--   STEP 2: select everything between the "STEP 2 STARTS" and "STEP 2 ENDS"
--           markers below, paste into the Production SQL Console, Ctrl/Cmd-A,
--           click Run.  The Console batches the selected statements into one
--           transaction.
-- ============================================================================

-- Pre-flight (Step 1) — run this by itself first:
-- SELECT id, email, role, status FROM users WHERE email = 'paulineasil@gmail.com';


-- =========================== STEP 2 STARTS HERE =============================

-- Group A: audit + multi-role join (clear first so subsequent CASCADEs are clean)
TRUNCATE TABLE audit_logs, user_roles, user_groups RESTART IDENTITY CASCADE;

-- Group B: deliveries / batches / samples / lots
TRUNCATE TABLE samples, deliveries, batches, lots, rejection_logs RESTART IDENTITY CASCADE;

-- Group C: procurement contracts
TRUNCATE TABLE contract_allocations, procurement_contracts, procurement_workflows RESTART IDENTITY CASCADE;

-- Group D: payments / cash floats / loans / sales / invoices
TRUNCATE TABLE payments, cash_float_transactions, agent_cash_floats, loan_repayments, loan_guarantors, loans, sales_contracts, invoices RESTART IDENTITY CASCADE;

-- Group E: warehouse / silos / processing
TRUNCATE TABLE stock_movements, warehouse_assignments, silo_batch_processes, silo_batches, silo_assignments, silos, storage_bins, preprocessing_steps RESTART IDENTITY CASCADE;

-- Group F: exports / shipments / dispatches
TRUNCATE TABLE export_documents, export_contracts, shipments, dispatches RESTART IDENTITY CASCADE;

-- Group G: compliance / certifications / surveys / training
TRUNCATE TABLE certification_enrolments, certification_streams, gap_assessments, survey_submissions, survey_templates, training_sessions RESTART IDENTITY CASCADE;

-- Group H: visits + per-farmer data + farmers
TRUNCATE TABLE visits, plots, farmer_crops, farmer_cards, farmer_custom_field_values, farmers RESTART IDENTITY CASCADE;

-- Group I: groups + leadership + transfers
TRUNCATE TABLE group_transfers, group_leadership, group_leaders, groups RESTART IDENTITY CASCADE;

-- Group J: org regions + admin units
TRUNCATE TABLE org_region_districts, org_regions, regions RESTART IDENTITY CASCADE;

-- Group K: commodities subtree + sampling configs + processes
TRUNCATE TABLE commodity_quality_specs, commodity_conversions, commodity_prices, commodity_seasons, commodity_types, commodities, sampling_configs, processes RESTART IDENTITY CASCADE;

-- Group L: buying stations + buyers
TRUNCATE TABLE buying_stations, buyers RESTART IDENTITY CASCADE;

-- Group M: assets + maintenance
TRUNCATE TABLE maintenance_logs, maintenance_schedules, asset_assignments, asset_categories, assets RESTART IDENTITY CASCADE;

-- Group N: activity funds
TRUNCATE TABLE activity_reconciliations, activity_funds, activity_types RESTART IDENTITY CASCADE;

-- Group O: admin config (re-create via Admin UI later)
TRUNCATE TABLE registration_template_fields, registration_templates, transaction_access_rules RESTART IDENTITY CASCADE;

-- Drop every user except the bootstrap admin.
DELETE FROM users WHERE email <> 'paulineasil@gmail.com';

-- Force the kept user to SystemAdministrator and clear now-stale FK refs.
UPDATE users SET role = 'SystemAdministrator', region_id = NULL, manager_id = NULL, status = 'active', updated_at = now() WHERE email = 'paulineasil@gmail.com';

-- Verification — expected: users=1, roles>0, country_hierarchies>=1, rest=0.
SELECT 'users (kept admin)' AS table_name, count(*) AS row_count FROM users
UNION ALL SELECT 'roles (kept)', count(*) FROM roles
UNION ALL SELECT 'country_hierarchies (kept)', count(*) FROM country_hierarchies
UNION ALL SELECT 'regions', count(*) FROM regions
UNION ALL SELECT 'org_regions', count(*) FROM org_regions
UNION ALL SELECT 'groups', count(*) FROM groups
UNION ALL SELECT 'farmers', count(*) FROM farmers
UNION ALL SELECT 'plots', count(*) FROM plots
UNION ALL SELECT 'commodities', count(*) FROM commodities
UNION ALL SELECT 'commodity_prices', count(*) FROM commodity_prices
UNION ALL SELECT 'buying_stations', count(*) FROM buying_stations
UNION ALL SELECT 'silos', count(*) FROM silos
UNION ALL SELECT 'storage_bins', count(*) FROM storage_bins
UNION ALL SELECT 'deliveries', count(*) FROM deliveries
UNION ALL SELECT 'batches', count(*) FROM batches
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'user_roles', count(*) FROM user_roles
UNION ALL SELECT 'user_groups', count(*) FROM user_groups
ORDER BY table_name;

-- =========================== STEP 2 ENDS HERE ===============================
-- DONE.  Sign in at https://agri-chain-connect.replit.app with the bootstrap
-- admin (paulineasil@gmail.com via Google).  Then re-seed master data from
-- master-data-templates/*.csv per master-data-templates/README.md.
-- ============================================================================

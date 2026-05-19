-- ============================================================================
-- MTANDEO PRODUCTION RESET — wipe transactional + master data, keep system seeds
-- Generated: 2026-05-19
--
-- KEEPS
--   - roles                      (system roles + permission bitmaps)
--   - country_hierarchies        (UG admin-unit level definitions)
--   - users WHERE email = 'paulineasil@gmail.com'   ← bootstrap admin
--
-- WIPES
--   - All transactional data (farmers, plots, deliveries, batches, payments,
--     samples, visits, surveys, loans, sales, lots, exports, compliance,
--     certifications, activity funds, audit logs, etc.)
--   - All master data you will re-seed from CSV (regions, org_regions, groups,
--     commodities, commodity_types/prices/conversions/specs, buying_stations,
--     silos, storage_bins, assets, etc.)
--   - All admin config (registration templates, transaction access rules)
--   - All non-admin users + their user_roles + user_groups assignments
--
-- ⚠️  IRREVERSIBLE.  Take a Postgres backup snapshot BEFORE running.
--
-- HOW TO RUN
--   1. Open the Database pane and switch environment to **Production**.
--   2. (Optional but strongly recommended) Take a manual snapshot.
--   3. Paste this entire file into the SQL Console query editor.
--   4. **Select ALL the SQL text (Ctrl/Cmd-A)** before clicking Run — the
--      Replit SQL Console only runs multiple statements as a single
--      transaction when they're all selected together. Running statement-
--      by-statement will fail the safety check or leave the DB partly wiped.
--   5. Read the verification table at the bottom — every row except
--      `users`(1), `roles`(>0), `country_hierarchies`(>0) should be 0.
--   6. If something looks wrong, restore from snapshot.
--
-- IF YOU WANT TO KEEP A DIFFERENT BOOTSTRAP EMAIL
--   Find/replace 'paulineasil@gmail.com' below with the email you want
--   to preserve, then run. Only one email can be kept.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pre-flight safety: confirm the bootstrap user exists. If not, abort the
-- entire transaction so we don't accidentally wipe ourselves out of access.
-- ---------------------------------------------------------------------------
DO $$
DECLARE keep_count int;
BEGIN
  SELECT count(*) INTO keep_count
  FROM users
  WHERE email = 'paulineasil@gmail.com';

  IF keep_count = 0 THEN
    RAISE EXCEPTION
      'ABORT: bootstrap user "paulineasil@gmail.com" not found in users table. '
      'Either create that user first (sign in once with Google), or edit the '
      'email in this script to one that exists.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Single TRUNCATE — Postgres handles FK ordering among listed tables and
-- CASCADE handles any child rows in non-listed tables.
-- RESTART IDENTITY also resets any auto-increment sequences.
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
  -- ---- Audit + multi-role join (clear first; reference everything else) ---
  audit_logs,
  user_roles,
  user_groups,

  -- ---- Transactional: deliveries, batches, samples, lots ------------------
  samples,
  deliveries,
  batches,
  lots,
  rejection_logs,

  -- ---- Transactional: procurement contracts -------------------------------
  contract_allocations,
  procurement_contracts,
  procurement_workflows,

  -- ---- Transactional: payments, cash floats, loans, sales, invoices -------
  payments,
  cash_float_transactions,
  agent_cash_floats,
  loan_repayments,
  loan_guarantors,
  loans,
  sales_contracts,
  invoices,

  -- ---- Transactional: warehouse, silos, processing ------------------------
  stock_movements,
  warehouse_assignments,
  silo_batch_processes,
  silo_batches,
  silo_assignments,
  silos,
  storage_bins,
  preprocessing_steps,

  -- ---- Transactional: exports / shipments / dispatches --------------------
  export_documents,
  export_contracts,
  shipments,
  dispatches,

  -- ---- Transactional: compliance / certifications / surveys / training ----
  certification_enrolments,
  certification_streams,
  gap_assessments,
  survey_submissions,
  survey_templates,
  training_sessions,

  -- ---- Transactional: visits + per-farmer data ----------------------------
  visits,
  plots,
  farmer_crops,
  farmer_cards,
  farmer_custom_field_values,
  farmers,

  -- ---- Master: groups, leadership, transfers ------------------------------
  group_transfers,
  group_leadership,
  group_leaders,
  groups,

  -- ---- Master: org regions + admin units ----------------------------------
  org_region_districts,
  org_regions,
  regions,

  -- ---- Master: commodities full subtree -----------------------------------
  commodity_quality_specs,
  commodity_conversions,
  commodity_prices,
  commodity_seasons,
  commodity_types,
  commodities,
  sampling_configs,
  processes,

  -- ---- Master: buying stations + buyers -----------------------------------
  buying_stations,
  buyers,

  -- ---- Master: assets + maintenance ---------------------------------------
  maintenance_logs,
  maintenance_schedules,
  asset_assignments,
  asset_categories,
  assets,

  -- ---- Master: activity funds ---------------------------------------------
  activity_reconciliations,
  activity_funds,
  activity_types,

  -- ---- Admin config (re-create via Admin UI after wipe) -------------------
  registration_template_fields,
  registration_templates,
  transaction_access_rules

RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- Drop every user except the bootstrap admin, then make sure that user is
-- SystemAdministrator with clean (now-non-existent) region/manager refs.
-- ---------------------------------------------------------------------------
DELETE FROM users
WHERE email <> 'paulineasil@gmail.com';

UPDATE users
SET role        = 'SystemAdministrator',
    region_id   = NULL,
    manager_id  = NULL,
    status      = 'active',
    updated_at  = now()
WHERE email = 'paulineasil@gmail.com';

-- ---------------------------------------------------------------------------
-- Verification — review BEFORE committing.
-- Expected: users=1, roles>0, country_hierarchies>=1, everything else=0.
-- ---------------------------------------------------------------------------
SELECT 'users (kept admin)'        AS table_name, count(*) AS row_count FROM users
UNION ALL SELECT 'roles (kept)',                count(*) FROM roles
UNION ALL SELECT 'country_hierarchies (kept)',  count(*) FROM country_hierarchies
UNION ALL SELECT 'regions',                     count(*) FROM regions
UNION ALL SELECT 'org_regions',                 count(*) FROM org_regions
UNION ALL SELECT 'groups',                      count(*) FROM groups
UNION ALL SELECT 'farmers',                     count(*) FROM farmers
UNION ALL SELECT 'plots',                       count(*) FROM plots
UNION ALL SELECT 'commodities',                 count(*) FROM commodities
UNION ALL SELECT 'commodity_prices',            count(*) FROM commodity_prices
UNION ALL SELECT 'buying_stations',             count(*) FROM buying_stations
UNION ALL SELECT 'silos',                       count(*) FROM silos
UNION ALL SELECT 'storage_bins',                count(*) FROM storage_bins
UNION ALL SELECT 'deliveries',                  count(*) FROM deliveries
UNION ALL SELECT 'batches',                     count(*) FROM batches
UNION ALL SELECT 'payments',                    count(*) FROM payments
UNION ALL SELECT 'audit_logs',                  count(*) FROM audit_logs
UNION ALL SELECT 'user_roles',                  count(*) FROM user_roles
UNION ALL SELECT 'user_groups',                 count(*) FROM user_groups
ORDER BY table_name;

-- ============================================================================
-- DONE.  Next steps:
--   1. Sign in at https://agri-chain-connect.replit.app with the bootstrap
--      admin (paulineasil@gmail.com via Google).  You should land directly in
--      the dashboard with full SystemAdministrator access.
--   2. Re-seed master data using the CSVs in master-data-templates/, in the
--      order described in master-data-templates/README.md.
-- ============================================================================

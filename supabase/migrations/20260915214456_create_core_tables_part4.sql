-- SILOS
CREATE TABLE IF NOT EXISTS silos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  facility_id    text,
  stream         text NOT NULL,
  commodity_type text,
  capacity_kg    numeric(14, 2),
  status         text NOT NULL DEFAULT 'ACTIVE',
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

-- SILO_ASSIGNMENTS
CREATE TABLE IF NOT EXISTS silo_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id            uuid NOT NULL UNIQUE,
  silo_id           uuid NOT NULL,
  received_weight_kg numeric(14, 2),
  assigned_by_id    uuid,
  override_reason   text,
  assigned_at       timestamp with time zone NOT NULL DEFAULT now()
);

-- SILO_BATCHES
CREATE TABLE IF NOT EXISTS silo_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number      text NOT NULL UNIQUE,
  silo_id           uuid NOT NULL,
  streams           text[],
  status            text NOT NULL DEFAULT 'OPEN',
  input_weight_kg   numeric(14, 2) NOT NULL DEFAULT '0',
  output_weight_kg  numeric(14, 2),
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  closed_at         timestamp with time zone
);

-- SILO_BATCH_PROCESSES
CREATE TABLE IF NOT EXISTS silo_batch_processes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  silo_batch_id         uuid NOT NULL,
  process_name          text NOT NULL,
  input_weight_kg       numeric(14, 2) NOT NULL,
  output_weight_kg      numeric(14, 2) NOT NULL,
  expected_outturn_pct  numeric(6, 3),
  actual_outturn_pct    numeric(6, 3),
  parameters            jsonb,
  quality_signoff       text NOT NULL DEFAULT 'PENDING',
  quality_signed_by_id  uuid,
  quality_signed_at     timestamp with time zone,
  warehouse_signoff     text NOT NULL DEFAULT 'PENDING',
  warehouse_signed_by_id uuid,
  warehouse_signed_at   timestamp with time zone,
  photo_urls            text[],
  started_at            timestamp with time zone,
  completed_at          timestamp with time zone,
  created_at            timestamp with time zone NOT NULL DEFAULT now()
);

-- STORAGE_BINS
CREATE TABLE IF NOT EXISTS storage_bins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  facility_id    text,
  stream         text NOT NULL,
  commodity_type text,
  capacity_kg    numeric(14, 2),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamp with time zone NOT NULL DEFAULT now()
);

-- WAREHOUSE_ASSIGNMENTS
CREATE TABLE IF NOT EXISTS warehouse_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id                uuid NOT NULL UNIQUE,
  bin_id                uuid NOT NULL,
  bag_count             integer,
  received_weight_kg    numeric(14, 2),
  current_weight_kg     numeric(14, 2),
  condition             text,
  photo_urls            text[],
  assigned_by_id        uuid,
  assigned_at           timestamp with time zone NOT NULL DEFAULT now()
);

-- STOCK_MOVEMENTS
CREATE TABLE IF NOT EXISTS stock_movements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_assignment_id uuid NOT NULL,
  from_bin_id            uuid,
  to_bin_id              uuid,
  movement_type          text NOT NULL,
  weight_kg              numeric(14, 2) NOT NULL,
  reason                 text,
  reference              text,
  performed_by_id        uuid,
  created_at             timestamp with time zone NOT NULL DEFAULT now()
);

-- PREPROCESSING_STEPS
CREATE TABLE IF NOT EXISTS preprocessing_steps (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  description            text,
  crop_type              text,
  default_deduction_pct  numeric(6, 3) NOT NULL,
  min_deduction_pct      numeric(6, 3) NOT NULL,
  max_deduction_pct      numeric(6, 3) NOT NULL,
  is_fixed               boolean NOT NULL DEFAULT false,
  is_mandatory           boolean NOT NULL DEFAULT false,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now()
);

-- ASSET_CATEGORIES
CREATE TABLE IF NOT EXISTS asset_categories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  depreciation_method   text NOT NULL DEFAULT 'STRAIGHT_LINE',
  useful_life_years     double precision,
  residual_value_pct    double precision,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now()
);

-- ASSETS
CREATE TABLE IF NOT EXISTS assets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code           text NOT NULL UNIQUE,
  category_id          uuid,
  type                 text NOT NULL,
  serial_number        text,
  make                 text,
  model                text,
  purchase_date        date NOT NULL,
  purchase_value       numeric(12, 2) NOT NULL,
  current_book_value   numeric(12, 2),
  status               text NOT NULL DEFAULT 'available',
  assigned_to_user_id  uuid,
  photo_url            text,
  qr_code              text,
  notes                text,
  maintenance_due_date date,
  assignment_history   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamp with time zone NOT NULL DEFAULT now(),
  updated_at           timestamp with time zone NOT NULL DEFAULT now()
);

-- ASSET_ASSIGNMENTS
CREATE TABLE IF NOT EXISTS asset_assignments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id               uuid NOT NULL,
  staff_user_id          uuid NOT NULL,
  condition_at_handover  text,
  condition_at_return    text,
  photo_at_handover_url  text,
  photo_at_return_url    text,
  assigned_by_id         uuid NOT NULL,
  assigned_at            timestamp with time zone NOT NULL DEFAULT now(),
  returned_at            timestamp with time zone,
  returned_by_id         uuid,
  damage_note            text,
  created_at             timestamp with time zone NOT NULL DEFAULT now()
);

-- MAINTENANCE_SCHEDULES
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL,
  interval_days     integer NOT NULL,
  last_service_date date,
  next_service_date date,
  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now()
);

-- MAINTENANCE_LOGS
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL,
  service_date      date NOT NULL,
  description       text,
  technician_name   text,
  cost              numeric(12, 2),
  next_service_date date,
  created_by_id     uuid,
  created_at        timestamp with time zone NOT NULL DEFAULT now()
);

-- ACTIVITY_TYPES
CREATE TABLE IF NOT EXISTS activity_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text,
  max_amount   numeric(12, 2),
  is_active    text NOT NULL DEFAULT 'true',
  created_at   timestamp with time zone NOT NULL DEFAULT now()
);

-- ACTIVITY_FUNDS
CREATE TABLE IF NOT EXISTS activity_funds (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id               uuid NOT NULL,
  activity_type_id       uuid,
  activity_type          text NOT NULL,
  planned_date           date NOT NULL,
  destination            text,
  estimated_amount       numeric(12, 2) NOT NULL,
  approved_amount        numeric(12, 2),
  actual_amount          numeric(12, 2),
  currency               text NOT NULL DEFAULT 'KES',
  status                 text NOT NULL DEFAULT 'pending',
  manager_approved_by_id uuid,
  manager_approved_at    timestamp with time zone,
  finance_approved_by_id uuid,
  finance_approved_at    timestamp with time zone,
  approver_comment       text,
  mobile_money_ref       text,
  line_items             jsonb NOT NULL DEFAULT '[]'::jsonb,
  disbursed_at           timestamp with time zone,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now()
);

-- ACTIVITY_RECONCILIATIONS
CREATE TABLE IF NOT EXISTS activity_reconciliations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id          uuid NOT NULL UNIQUE,
  actual_spend     jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_actual     numeric(12, 2) NOT NULL,
  unspent_balance  numeric(12, 2) NOT NULL,
  submitted_by_id  uuid NOT NULL,
  reviewed_by_id   uuid,
  reviewed_at      timestamp with time zone,
  created_at       timestamp with time zone NOT NULL DEFAULT now()
);

-- AUDIT_LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,
  actor_id    text NOT NULL,
  actor_name  text NOT NULL,
  actor_role  text NOT NULL,
  before      jsonb,
  after       jsonb,
  ip_address  text,
  timestamp   timestamp with time zone NOT NULL DEFAULT now()
);

-- GRADING_PROFILES (FK -> commodity_types)
CREATE TABLE IF NOT EXISTS grading_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  input_commodity_type_id uuid NOT NULL,
  status                 text NOT NULL DEFAULT 'active',
  effective_date         date NOT NULL,
  notes                  text,
  created_by_id          uuid,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT grading_profiles_input_commodity_type_id_fkey
    FOREIGN KEY (input_commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict
);
CREATE INDEX IF NOT EXISTS grading_profiles_input_idx         ON grading_profiles (input_commodity_type_id);
CREATE INDEX IF NOT EXISTS grading_profiles_input_status_idx  ON grading_profiles (input_commodity_type_id, status);

-- GRADING_PROFILE_OUTPUTS (FK -> grading_profiles, commodity_types)
CREATE TABLE IF NOT EXISTS grading_profile_outputs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grading_profile_id     uuid NOT NULL,
  output_commodity_type_id uuid,
  label                  text,
  expected_yield_pct     numeric(6, 3) NOT NULL,
  min_yield_pct          numeric(6, 3),
  max_yield_pct          numeric(6, 3),
  is_sellable            boolean NOT NULL DEFAULT true,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT grading_profile_outputs_grading_profile_id_fkey
    FOREIGN KEY (grading_profile_id) REFERENCES grading_profiles(id) ON DELETE cascade,
  CONSTRAINT grading_profile_outputs_output_commodity_type_id_fkey
    FOREIGN KEY (output_commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict
);
CREATE INDEX IF NOT EXISTS grading_profile_outputs_profile_idx ON grading_profile_outputs (grading_profile_id);

-- GRADING_RUNS (FK -> grading_profiles, commodity_types)
CREATE TABLE IF NOT EXISTS grading_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number             text NOT NULL UNIQUE,
  grading_profile_id     uuid NOT NULL,
  silo_batch_id          uuid,
  input_commodity_type_id uuid NOT NULL,
  input_weight_kg        numeric(14, 2) NOT NULL,
  total_output_kg        numeric(14, 2) NOT NULL,
  loss_kg                numeric(14, 2) NOT NULL,
  loss_pct               numeric(6, 3) NOT NULL,
  status                 text NOT NULL DEFAULT 'completed',
  notes                  text,
  run_by_id              uuid,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT grading_runs_grading_profile_id_fkey
    FOREIGN KEY (grading_profile_id) REFERENCES grading_profiles(id) ON DELETE restrict,
  CONSTRAINT grading_runs_input_commodity_type_id_fkey
    FOREIGN KEY (input_commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict
);
CREATE INDEX        IF NOT EXISTS grading_runs_profile_idx      ON grading_runs (grading_profile_id);
CREATE INDEX        IF NOT EXISTS grading_runs_silo_batch_idx   ON grading_runs (silo_batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS grading_runs_run_number_uniq  ON grading_runs (run_number);

-- GRADING_RUN_OUTPUTS (FK -> grading_runs, commodity_types)
CREATE TABLE IF NOT EXISTS grading_run_outputs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grading_run_id            uuid NOT NULL,
  grading_profile_output_id uuid,
  output_commodity_type_id  uuid,
  label                     text,
  is_sellable               boolean NOT NULL DEFAULT true,
  expected_yield_pct        numeric(6, 3) NOT NULL,
  actual_weight_kg          numeric(14, 2) NOT NULL,
  actual_yield_pct          numeric(6, 3) NOT NULL,
  variance_pct              numeric(7, 3) NOT NULL,
  created_at                timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT grading_run_outputs_grading_run_id_fkey
    FOREIGN KEY (grading_run_id) REFERENCES grading_runs(id) ON DELETE cascade,
  CONSTRAINT grading_run_outputs_output_commodity_type_id_fkey
    FOREIGN KEY (output_commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict
);
CREATE INDEX IF NOT EXISTS grading_run_outputs_run_idx ON grading_run_outputs (grading_run_id);

-- COMMODITY_STOCK_MOVEMENTS (FK -> commodity_types, grading_runs)
CREATE TABLE IF NOT EXISTS commodity_stock_movements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_type_id      uuid NOT NULL,
  weight_kg              numeric(14, 2) NOT NULL,
  movement_type          text NOT NULL,
  grading_run_id         uuid,
  grading_run_output_id  uuid,
  silo_batch_id          uuid,
  dispatch_id            uuid,
  shipment_id            uuid,
  notes                  text,
  created_by_id          uuid,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT commodity_stock_movements_commodity_type_id_fkey
    FOREIGN KEY (commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict,
  CONSTRAINT commodity_stock_movements_grading_run_id_fkey
    FOREIGN KEY (grading_run_id) REFERENCES grading_runs(id) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS commodity_stock_movements_type_idx ON commodity_stock_movements (commodity_type_id);
CREATE INDEX IF NOT EXISTS commodity_stock_movements_run_idx  ON commodity_stock_movements (grading_run_id);

-- SAMPLES (FK -> commodity_types, sampling_configs, users)
CREATE TABLE IF NOT EXISTS samples (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_code                text NOT NULL,
  commodity_type_id          uuid NOT NULL,
  sampling_config_id         uuid,
  sampling_config_version    integer,
  sampling_config_snapshot   jsonb,
  stage                      text NOT NULL,
  linked_entity_type         text NOT NULL,
  linked_entity_id           text NOT NULL,
  sampling_method            text NOT NULL,
  collection_date            timestamp with time zone NOT NULL,
  latitude                   numeric(10, 7),
  longitude                  numeric(10, 7),
  gps_accuracy_m             numeric(10, 2),
  collector_id               uuid,
  sample_weight_kg           numeric(12, 4),
  sub_sample_count           integer NOT NULL DEFAULT 1,
  container_type             text,
  seal_number                text,
  photo_urls                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                     text NOT NULL DEFAULT 'collected',
  notes                      text,
  client_generated_id        text,
  client_created_at          timestamp with time zone,
  synced_at                  timestamp with time zone NOT NULL DEFAULT now(),
  created_at                 timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                 timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT samples_commodity_type_id_fkey
    FOREIGN KEY (commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict,
  CONSTRAINT samples_sampling_config_id_fkey
    FOREIGN KEY (sampling_config_id) REFERENCES sampling_configs(id) ON DELETE set null,
  CONSTRAINT samples_collector_id_fkey
    FOREIGN KEY (collector_id) REFERENCES users(id) ON DELETE set null
);
CREATE UNIQUE INDEX IF NOT EXISTS samples_code_uniq       ON samples (sample_code);
CREATE UNIQUE INDEX IF NOT EXISTS samples_client_id_uniq  ON samples (client_generated_id);
CREATE INDEX        IF NOT EXISTS samples_type_idx        ON samples (commodity_type_id);
CREATE INDEX        IF NOT EXISTS samples_stage_idx       ON samples (stage);
CREATE INDEX        IF NOT EXISTS samples_linked_idx      ON samples (linked_entity_type, linked_entity_id);
CREATE INDEX        IF NOT EXISTS samples_collector_idx   ON samples (collector_id);
CREATE INDEX        IF NOT EXISTS samples_collected_idx   ON samples (collection_date);
CREATE INDEX        IF NOT EXISTS samples_status_idx      ON samples (status);

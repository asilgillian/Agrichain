-- COMMODITIES
CREATE TABLE IF NOT EXISTS commodities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  code            text NOT NULL,
  scientific_name text,
  default_unit    text NOT NULL DEFAULT 'kg',
  description     text,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commodities_code_uniq ON commodities (code);

-- COMMODITY_TYPES (FK -> commodities; self-ref parent)
CREATE TABLE IF NOT EXISTS commodity_types (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id             uuid NOT NULL,
  name                     text NOT NULL,
  code                     text NOT NULL,
  stage                    text NOT NULL DEFAULT 'raw',
  parent_commodity_type_id uuid,
  is_purchasable           boolean NOT NULL DEFAULT true,
  is_sellable              boolean NOT NULL DEFAULT true,
  default_unit             text NOT NULL DEFAULT 'kg',
  default_moisture_min     numeric(5, 2),
  default_moisture_max     numeric(5, 2),
  status                   text NOT NULL DEFAULT 'active',
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT commodity_types_commodity_id_fkey
    FOREIGN KEY (commodity_id) REFERENCES commodities(id) ON DELETE restrict,
  CONSTRAINT commodity_types_parent_commodity_type_id_fkey
    FOREIGN KEY (parent_commodity_type_id) REFERENCES commodity_types(id) ON DELETE set null
);
CREATE INDEX        IF NOT EXISTS commodity_types_commodity_idx          ON commodity_types (commodity_id);
CREATE INDEX        IF NOT EXISTS commodity_types_parent_idx             ON commodity_types (parent_commodity_type_id);
CREATE UNIQUE INDEX IF NOT EXISTS commodity_types_commodity_code_uniq    ON commodity_types (commodity_id, code);

-- COMMODITY_SEASONS
CREATE TABLE IF NOT EXISTS commodity_seasons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_type_id  uuid NOT NULL,
  season_name        text NOT NULL,
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  region_id          uuid,
  is_active          boolean NOT NULL DEFAULT true,
  notes              text,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT commodity_seasons_commodity_type_id_fkey
    FOREIGN KEY (commodity_type_id) REFERENCES commodity_types(id) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS commodity_seasons_type_idx  ON commodity_seasons (commodity_type_id);
CREATE INDEX IF NOT EXISTS commodity_seasons_dates_idx ON commodity_seasons (commodity_type_id, start_date, end_date);

-- COMMODITY_PRICES
CREATE TABLE IF NOT EXISTS commodity_prices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_type_id  uuid NOT NULL,
  region_id          uuid,
  price_per_kg       numeric(14, 2) NOT NULL,
  currency           text NOT NULL DEFAULT 'UGX',
  effective_date     date NOT NULL,
  source             text NOT NULL DEFAULT 'manual',
  notes              text,
  created_by_id      uuid,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT commodity_prices_commodity_type_id_fkey
    FOREIGN KEY (commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict
);
CREATE INDEX        IF NOT EXISTS commodity_prices_type_date_idx          ON commodity_prices (commodity_type_id, effective_date);
CREATE INDEX        IF NOT EXISTS commodity_prices_type_region_date_idx   ON commodity_prices (commodity_type_id, region_id, effective_date);
CREATE UNIQUE INDEX IF NOT EXISTS commodity_prices_scope_day_uniq
  ON commodity_prices (commodity_type_id, coalesce(region_id::text, ''), currency, effective_date);

-- PROCESSES
CREATE TABLE IF NOT EXISTS processes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  code                   text NOT NULL,
  description            text,
  allowed_stages         jsonb,
  default_expected_rate  numeric(18, 8),
  default_min_rate       numeric(18, 8),
  default_max_rate       numeric(18, 8),
  status                 text NOT NULL DEFAULT 'active',
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS processes_code_uniq ON processes (code);

-- COMMODITY_CONVERSIONS
CREATE TABLE IF NOT EXISTS commodity_conversions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_commodity_type_id uuid NOT NULL,
  to_commodity_type_id   uuid NOT NULL,
  expected_rate          numeric(18, 8) NOT NULL,
  min_rate               numeric(18, 8),
  max_rate               numeric(18, 8),
  process_type           text,
  process_id             uuid,
  effective_date         date NOT NULL,
  version                integer NOT NULL DEFAULT 1,
  notes                  text,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT commodity_conversions_from_commodity_type_id_fkey
    FOREIGN KEY (from_commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict,
  CONSTRAINT commodity_conversions_to_commodity_type_id_fkey
    FOREIGN KEY (to_commodity_type_id) REFERENCES commodity_types(id) ON DELETE restrict
);
CREATE INDEX        IF NOT EXISTS commodity_conversions_from_idx                      ON commodity_conversions (from_commodity_type_id);
CREATE INDEX        IF NOT EXISTS commodity_conversions_process_idx                   ON commodity_conversions (process_id);
CREATE INDEX        IF NOT EXISTS commodity_conversions_to_idx                        ON commodity_conversions (to_commodity_type_id);
CREATE UNIQUE INDEX IF NOT EXISTS commodity_conversions_pair_effective_version_uniq
  ON commodity_conversions (from_commodity_type_id, to_commodity_type_id, effective_date, version);

-- COMMODITY_QUALITY_SPECS
CREATE TABLE IF NOT EXISTS commodity_quality_specs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_type_id  uuid NOT NULL,
  parameter_name     text NOT NULL,
  parameter_code     text NOT NULL,
  unit               text,
  min_value          numeric(18, 6),
  max_value          numeric(18, 6),
  target_value       numeric(18, 6),
  method_used        text,
  affects_price      boolean NOT NULL DEFAULT false,
  mandatory          boolean NOT NULL DEFAULT true,
  applies_at_stages  jsonb,
  effective_date     date NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'active',
  notes              text,
  created_by_id      uuid,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT commodity_quality_specs_commodity_type_id_fkey
    FOREIGN KEY (commodity_type_id) REFERENCES commodity_types(id) ON DELETE cascade
);
CREATE INDEX        IF NOT EXISTS commodity_quality_specs_type_idx                  ON commodity_quality_specs (commodity_type_id);
CREATE INDEX        IF NOT EXISTS commodity_quality_specs_type_status_idx           ON commodity_quality_specs (commodity_type_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS commodity_quality_specs_type_param_effective_version_uniq
  ON commodity_quality_specs (commodity_type_id, parameter_code, effective_date, version);

-- SAMPLING_CONFIGS
CREATE TABLE IF NOT EXISTS sampling_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_type_id  uuid NOT NULL,
  stage              text NOT NULL,
  is_mandatory       boolean NOT NULL DEFAULT true,
  sampling_method    text NOT NULL DEFAULT 'grab',
  frequency_rule     text NOT NULL DEFAULT 'per_batch',
  frequency_value    numeric(14, 2),
  min_samples        integer NOT NULL DEFAULT 1,
  max_samples        integer,
  requires_lab_test  boolean NOT NULL DEFAULT false,
  auto_block_if_missing boolean NOT NULL DEFAULT true,
  allow_override     boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'active',
  version            integer NOT NULL DEFAULT 1,
  notes              text,
  created_by_id      uuid,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sampling_configs_commodity_type_id_fkey
    FOREIGN KEY (commodity_type_id) REFERENCES commodity_types(id) ON DELETE cascade
);
CREATE INDEX        IF NOT EXISTS sampling_configs_type_idx        ON sampling_configs (commodity_type_id);
CREATE INDEX        IF NOT EXISTS sampling_configs_type_stage_idx  ON sampling_configs (commodity_type_id, stage);
CREATE UNIQUE INDEX IF NOT EXISTS sampling_configs_type_stage_active_uniq
  ON sampling_configs (commodity_type_id, stage) WHERE status = 'active';

-- FARMER_CROPS (FK -> farmers, commodities)
CREATE TABLE IF NOT EXISTS farmer_crops (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id          uuid NOT NULL,
  commodity_id       uuid NOT NULL,
  last_harvest_kg    numeric(12, 2),
  last_harvest_date  date,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT farmer_crops_farmer_id_fkey
    FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE cascade,
  CONSTRAINT farmer_crops_commodity_id_fkey
    FOREIGN KEY (commodity_id) REFERENCES commodities(id) ON DELETE restrict
);
CREATE UNIQUE INDEX IF NOT EXISTS farmer_crops_farmer_commodity_uniq ON farmer_crops (farmer_id, commodity_id);

-- FARMER_CUSTOM_FIELD_VALUES (FK -> farmers)
CREATE TABLE IF NOT EXISTS farmer_custom_field_values (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id  uuid NOT NULL,
  field_key  text NOT NULL,
  value      text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT farmer_custom_field_values_farmer_id_fkey
    FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS farmer_custom_field_values_per_farmer_key_idx
  ON farmer_custom_field_values (farmer_id, field_key);

-- REGISTRATION_TEMPLATES
CREATE TABLE IF NOT EXISTS registration_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text,
  country_code text,
  version      integer NOT NULL DEFAULT 1,
  is_active    boolean NOT NULL DEFAULT false,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS registration_templates_active_per_country_idx
  ON registration_templates (country_code) WHERE is_active = true AND country_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS registration_templates_active_global_idx
  ON registration_templates (is_active) WHERE is_active = true AND country_code IS NULL;

-- REGISTRATION_TEMPLATE_FIELDS (FK -> registration_templates)
CREATE TABLE IF NOT EXISTS registration_template_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  field_key   text NOT NULL,
  label       text NOT NULL,
  field_type  text NOT NULL,
  required    boolean NOT NULL DEFAULT false,
  options     jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  source      text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT registration_template_fields_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES registration_templates(id) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS registration_template_fields_key_per_template_idx
  ON registration_template_fields (template_id, field_key);
CREATE INDEX        IF NOT EXISTS registration_template_fields_template_order_idx
  ON registration_template_fields (template_id, sort_order);

-- TRANSACTION_ACCESS_RULES (FK -> users)
CREATE TABLE IF NOT EXISTS transaction_access_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_type       text NOT NULL,
  required_stage text NOT NULL DEFAULT 'fully_registered',
  is_active      boolean NOT NULL DEFAULT true,
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_by_id  uuid,
  CONSTRAINT transaction_access_rules_updated_by_id_fkey
    FOREIGN KEY (updated_by_id) REFERENCES users(id) ON DELETE set null
);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_access_rules_txn_type_idx ON transaction_access_rules (txn_type);

-- BUYING_STATIONS
CREATE TABLE IF NOT EXISTS buying_stations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  location        text,
  gps_lat         double precision,
  gps_lng         double precision,
  manager_user_id uuid,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now()
);

-- AGENT_CASH_FLOATS
CREATE TABLE IF NOT EXISTS agent_cash_floats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL UNIQUE,
  current_balance numeric(14, 2) NOT NULL DEFAULT '0',
  currency        text NOT NULL DEFAULT 'KES',
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now()
);

-- CASH_FLOAT_TRANSACTIONS
CREATE TABLE IF NOT EXISTS cash_float_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  float_id        uuid NOT NULL,
  type            text NOT NULL,
  amount          numeric(14, 2) NOT NULL,
  balance_after   numeric(14, 2),
  reference       text,
  note            text,
  performed_by_id uuid,
  created_at      timestamp with time zone NOT NULL DEFAULT now()
);

-- PROCUREMENT_WORKFLOWS
CREATE TABLE IF NOT EXISTS procurement_workflows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  commodity_type text,
  is_active      boolean NOT NULL DEFAULT true,
  is_default     boolean NOT NULL DEFAULT false,
  created_by_id  uuid,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

-- PROCUREMENT_WORKFLOW_STAGES
CREATE TABLE IF NOT EXISTS procurement_workflow_stages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id        uuid NOT NULL,
  stage_kind         text NOT NULL,
  order_idx          integer NOT NULL,
  display_name       text NOT NULL,
  description        text,
  required_permission text,
  sla_hours          integer,
  is_active          boolean NOT NULL DEFAULT true,
  is_optional        boolean NOT NULL DEFAULT false,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_workflow_stages_workflow_order_uniq
  ON procurement_workflow_stages (workflow_id, order_idx);

-- PROCUREMENT_CONTRACTS
CREATE TABLE IF NOT EXISTS procurement_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number    text NOT NULL UNIQUE,
  contract_type      text NOT NULL,
  group_id           uuid NOT NULL,
  commodity_type     text NOT NULL,
  season_start       date,
  season_end         date,
  floor_price_per_kg numeric(10, 4),
  target_volume_kg   numeric(14, 3),
  currency           text NOT NULL DEFAULT 'UGX',
  notes              text,
  status             text NOT NULL DEFAULT 'DRAFT',
  created_by_id      uuid,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now()
);

-- BATCHES
CREATE TABLE IF NOT EXISTS batches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_tag            text NOT NULL UNIQUE,
  agent_id             uuid NOT NULL,
  group_id             uuid,
  crop_type            text NOT NULL,
  total_weight_kg      numeric(12, 3) NOT NULL DEFAULT '0',
  farmer_count         integer NOT NULL DEFAULT 0,
  qualifying_streams   text[] NOT NULL DEFAULT ARRAY[]::text[],
  status               text NOT NULL DEFAULT 'open',
  harvest_date         date NOT NULL,
  farmer_contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamp with time zone NOT NULL DEFAULT now(),
  updated_at           timestamp with time zone NOT NULL DEFAULT now()
);

-- DELIVERIES (CHECK: exactly one seller)
CREATE TABLE IF NOT EXISTS deliveries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_tag                  text NOT NULL UNIQUE,
  delivery_number          text NOT NULL UNIQUE,
  farmer_id                uuid,
  supplier_id              uuid,
  crop_type                text NOT NULL,
  captured_weight_kg       numeric(12, 3) NOT NULL,
  captured_by_id           uuid,
  captured_at              timestamp with time zone DEFAULT now(),
  batch_id                 uuid,
  station_id               uuid,
  truck_plate              text,
  driver_name              text,
  gross_weight_kg          numeric(12, 3),
  tare_weight_kg           numeric(12, 3),
  net_weight_kg            numeric(12, 3),
  weight_variance_kg       numeric(12, 3),
  weight_submitted_by_id   uuid,
  weight_submitted_at      timestamp with time zone,
  weight_approved_by_id    uuid,
  weight_approved_at       timestamp with time zone,
  weight_approved          boolean NOT NULL DEFAULT false,
  moisture_content         numeric(5, 2),
  defect_count             numeric(6, 1),
  cup_score                numeric(5, 2),
  grade                    text,
  qc_sample_id             uuid,
  qc_submitted_by_id       uuid,
  qc_submitted_at          timestamp with time zone,
  qc_approved_by_id        uuid,
  qc_approved_at           timestamp with time zone,
  qc_approved              boolean NOT NULL DEFAULT false,
  price_per_kg             numeric(10, 4),
  total_value              numeric(14, 2),
  pricing_deductions       jsonb,
  pricing_incentives       jsonb,
  pricing_proposed_by_id   uuid,
  pricing_proposed_at      timestamp with time zone,
  pricing_approved_by_id   uuid,
  pricing_approved_at      timestamp with time zone,
  contract_id              uuid,
  floor_price_per_kg       numeric(10, 4),
  qualifying_streams       text[] NOT NULL DEFAULT ARRAY[]::text[],
  workflow_id              uuid,
  current_stage_order      integer NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'captured',
  rejection_type           text,
  rejection_stage          text,
  rejection_reason         text,
  rejection_by_id          uuid,
  rejection_at             timestamp with time zone,
  pre_offload_sample_taken boolean NOT NULL DEFAULT false,
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT delivery_seller_exactly_one
    CHECK (((farmer_id IS NOT NULL)::integer + (supplier_id IS NOT NULL)::integer) = 1)
);

-- LOTS
CREATE TABLE IF NOT EXISTS lots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_tag              text NOT NULL UNIQUE,
  delivery_id          uuid NOT NULL,
  weight_kg            numeric(12, 3) NOT NULL DEFAULT '0',
  certification_streams text[] NOT NULL DEFAULT ARRAY[]::text[],
  silo_id              text,
  status               text NOT NULL DEFAULT 'received',
  chain_of_custody     text[] NOT NULL DEFAULT ARRAY[]::text[],
  received_at          timestamp with time zone NOT NULL DEFAULT now(),
  updated_at           timestamp with time zone NOT NULL DEFAULT now()
);

-- PAYMENTS (partial unique indexes)
CREATE TABLE IF NOT EXISTS payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id         uuid,
  supplier_id       uuid,
  delivery_id       uuid NOT NULL,
  amount_due        numeric(14, 2) NOT NULL,
  amount_paid       numeric(14, 2),
  currency          text NOT NULL DEFAULT 'KES',
  payment_method    text NOT NULL,
  status            text NOT NULL DEFAULT 'pending',
  payment_reference text,
  msisdn            text,
  momo_provider     text,
  provider_txn_id   text,
  failure_reason    text,
  retry_count       integer NOT NULL DEFAULT 0,
  paid_at           timestamp with time zone,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_active_delivery_farmer_uniq
  ON payments (delivery_id, farmer_id) WHERE status in ('paid','pending','pending_external');
CREATE UNIQUE INDEX IF NOT EXISTS payments_active_delivery_supplier_uniq
  ON payments (delivery_id, supplier_id) WHERE status in ('paid','pending','pending_external');

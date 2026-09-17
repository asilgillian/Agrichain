-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- REGIONS (self-referential parent_id)
CREATE TABLE IF NOT EXISTS regions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  parent_id     uuid,
  level         integer NOT NULL DEFAULT 1,
  country_code  text DEFAULT 'KE',
  code          text,
  is_active     boolean NOT NULL DEFAULT true,
  boundary      jsonb,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

-- ROLES
CREATE TABLE IF NOT EXISTS roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  description  text,
  permissions  text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamp with time zone NOT NULL DEFAULT now()
);

-- USERS (self-referential manager_id)
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  email         text NOT NULL UNIQUE,
  phone_number  text,
  clerk_user_id text UNIQUE,
  role          text NOT NULL,
  region_id     uuid,
  manager_id    uuid,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

-- COUNTRY_HIERARCHIES
CREATE TABLE IF NOT EXISTS country_hierarchies (
  country_code  text PRIMARY KEY,
  country_name  text NOT NULL,
  levels        jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

-- ORG_REGIONS
CREATE TABLE IF NOT EXISTS org_regions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text,
  country_code text NOT NULL DEFAULT 'UG',
  is_active    boolean NOT NULL DEFAULT true,
  created_by_id uuid,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_regions_country_lower_name_uq
  ON org_regions (country_code, lower(name));

-- ORG_REGION_DISTRICTS (composite PK; FK -> org_regions, regions)
CREATE TABLE IF NOT EXISTS org_region_districts (
  org_region_id uuid NOT NULL,
  region_id     uuid NOT NULL,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (org_region_id, region_id),
  CONSTRAINT org_region_districts_org_region_id_fkey
    FOREIGN KEY (org_region_id) REFERENCES org_regions(id) ON DELETE cascade,
  CONSTRAINT org_region_districts_region_id_fkey
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE cascade
);

-- GROUPS
CREATE TABLE IF NOT EXISTS groups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  region_id        uuid NOT NULL,
  village          text,
  parish           text,
  sub_county       text,
  district         text,
  parent_group_id  uuid,
  group_type       text NOT NULL DEFAULT 'producer_group',
  status           text NOT NULL DEFAULT 'active',
  archived_at      timestamp with time zone,
  archived_by_id   uuid,
  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  updated_at       timestamp with time zone NOT NULL DEFAULT now()
);

-- GROUP_LEADERS
CREATE TABLE IF NOT EXISTS group_leaders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL,
  farmer_id   uuid NOT NULL,
  position    text NOT NULL,
  term_start  date NOT NULL,
  term_end    date,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_leaders_group_idx  ON group_leaders (group_id);
CREATE INDEX IF NOT EXISTS group_leaders_farmer_idx ON group_leaders (farmer_id);

-- GROUP_TRANSFERS
CREATE TABLE IF NOT EXISTS group_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id      uuid NOT NULL,
  from_group_id  uuid,
  to_group_id    uuid NOT NULL,
  reason         text NOT NULL,
  actor_id       uuid,
  actor_name     text,
  kind           text NOT NULL DEFAULT 'transfer',
  transferred_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_transfers_farmer_idx   ON group_transfers (farmer_id);
CREATE INDEX IF NOT EXISTS group_transfers_to_group_idx ON group_transfers (to_group_id);

-- GROUP_REGIONS
CREATE TABLE IF NOT EXISTS group_regions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL,
  region_id  uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS group_regions_group_region_unique ON group_regions (group_id, region_id);
CREATE INDEX        IF NOT EXISTS group_regions_group_idx           ON group_regions (group_id);
CREATE INDEX        IF NOT EXISTS group_regions_region_idx          ON group_regions (region_id);

-- USER_ROLES (composite PK; FK -> users, roles)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id       uuid NOT NULL,
  role_id       uuid NOT NULL,
  assigned_by_id uuid,
  assigned_at   timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade,
  CONSTRAINT user_roles_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles (role_id);

-- USER_GROUPS
CREATE TABLE IF NOT EXISTS user_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  group_id       uuid NOT NULL,
  assigned_by_id uuid,
  assigned_at    timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_groups_user_group_unique ON user_groups (user_id, group_id);
CREATE INDEX        IF NOT EXISTS user_groups_user_idx          ON user_groups (user_id);
CREATE INDEX        IF NOT EXISTS user_groups_group_idx         ON user_groups (group_id);

-- FARMERS
CREATE TABLE IF NOT EXISTS farmers (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number            text NOT NULL UNIQUE,
  pre_reg_ref                 text,
  first_name                  text NOT NULL,
  last_name                   text NOT NULL,
  national_id                 text,
  date_of_birth               date,
  phone_number                text,
  sex                         text,
  group_id                    uuid NOT NULL,
  region_id                   uuid NOT NULL,
  village                     text,
  status                      text NOT NULL DEFAULT 'active',
  registration_stage          text NOT NULL DEFAULT 'fully_registered',
  pre_registered_at           timestamp with time zone,
  fully_registered_at         timestamp with time zone,
  photo_url                   text,
  biometric_photo_url         text,
  household_size              integer,
  dependants                  integer,
  head_of_household           text,
  land_tenure                 text,
  registration_date           date,
  approved_at                 timestamp with time zone,
  approved_by_id              uuid,
  is_entrepreneur             boolean NOT NULL DEFAULT false,
  entrepreneur_since          timestamp with time zone,
  other_activities            text[],
  cultivated_land_ha          numeric(8, 3),
  off_farm_income_source      text,
  off_farm_income_monthly_ugx integer,
  months_of_food_shortage     integer,
  education_level_head        text,
  access_clean_water          boolean,
  access_electricity          boolean,
  primary_cooking_fuel        text,
  created_at                  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                  timestamp with time zone NOT NULL DEFAULT now()
);

-- SUPPLIERS (FK -> farmers)
CREATE TABLE IF NOT EXISTS suppliers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number   text NOT NULL UNIQUE,
  seller_type        text NOT NULL,
  business_name      text,
  business_reg_no    text,
  first_name         text,
  last_name          text,
  national_id        text,
  phone_number       text,
  email              text,
  region_id          uuid,
  village            text,
  address            text,
  payment_method     text,
  momo_provider      text,
  momo_msisdn        text,
  bank_name          text,
  bank_account_number text,
  status             text NOT NULL DEFAULT 'pending',
  loan_eligible      boolean NOT NULL DEFAULT false,
  farmer_id          uuid,
  notes              text,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_farmer_id_fkey
    FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE set null
);
CREATE INDEX        IF NOT EXISTS suppliers_seller_type_idx     ON suppliers (seller_type);
CREATE INDEX        IF NOT EXISTS suppliers_status_idx          ON suppliers (status);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_national_id_uniq    ON suppliers (national_id);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_business_reg_no_uniq ON suppliers (business_reg_no);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_farmer_id_uniq      ON suppliers (farmer_id);

-- FARMER_CARDS
CREATE TABLE IF NOT EXISTS farmer_cards (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id            uuid NOT NULL UNIQUE,
  registration_number  text NOT NULL UNIQUE,
  qr_code              text NOT NULL UNIQUE,
  barcode              text NOT NULL UNIQUE,
  issued_at            timestamp with time zone,
  expires_at           timestamp with time zone,
  status               text NOT NULL DEFAULT 'ACTIVE',
  created_at           timestamp with time zone NOT NULL DEFAULT now()
);

-- GROUP_LEADERSHIP
CREATE TABLE IF NOT EXISTS group_leadership (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL,
  farmer_id   uuid NOT NULL,
  role        text NOT NULL,
  start_date  date NOT NULL,
  end_date    date,
  phone       text,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

-- REJECTION_LOGS
CREATE TABLE IF NOT EXISTS rejection_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id          uuid NOT NULL,
  step            text NOT NULL,
  rejection_type  text NOT NULL,
  reason          text NOT NULL,
  rejected_by_id  uuid NOT NULL,
  created_at      timestamp with time zone NOT NULL DEFAULT now()
);

-- PLOTS
CREATE TABLE IF NOT EXISTS plots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id     uuid NOT NULL,
  name          text,
  crop_type     text NOT NULL,
  area_hectares numeric(10, 4) NOT NULL DEFAULT '0',
  polygon       jsonb,
  harvest_date  date,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

-- CERTIFICATION_STREAMS
CREATE TABLE IF NOT EXISTS certification_streams (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  description            text,
  requires_gps_polygon   boolean NOT NULL DEFAULT false,
  eligibility_criteria   text[] NOT NULL DEFAULT ARRAY[]::text[],
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamp with time zone NOT NULL DEFAULT now()
);

-- CERTIFICATION_ENROLMENTS
CREATE TABLE IF NOT EXISTS certification_enrolments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id      uuid NOT NULL,
  stream_id      uuid NOT NULL,
  enrolment_date date NOT NULL,
  expiry_date    date,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

-- SURVEY_TEMPLATES
CREATE TABLE IF NOT EXISTS survey_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL,
  fields      jsonb NOT NULL DEFAULT '[]'::jsonb,
  published   boolean NOT NULL DEFAULT false,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone NOT NULL DEFAULT now()
);

-- SURVEY_SUBMISSIONS
CREATE TABLE IF NOT EXISTS survey_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL,
  farmer_id     uuid NOT NULL,
  agent_id      uuid NOT NULL,
  responses     jsonb NOT NULL DEFAULT '{}'::jsonb,
  gps_lat       numeric(10, 7),
  gps_lng       numeric(10, 7),
  status        text NOT NULL DEFAULT 'pending',
  review_comment text,
  submitted_at  timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_at   timestamp with time zone
);

-- VISITS
CREATE TABLE IF NOT EXISTS visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id     uuid NOT NULL,
  agent_id      uuid NOT NULL,
  scheduled_date date NOT NULL,
  completed_at  timestamp with time zone,
  priority      text NOT NULL DEFAULT 'medium',
  status        text NOT NULL DEFAULT 'scheduled',
  notes         text,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

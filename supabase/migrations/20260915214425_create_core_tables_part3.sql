-- GAP_ASSESSMENTS
CREATE TABLE IF NOT EXISTS gap_assessments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id     uuid NOT NULL,
  agent_id      uuid NOT NULL,
  overall_score numeric(6, 2) NOT NULL DEFAULT '0',
  max_score     numeric(6, 2) NOT NULL DEFAULT '0',
  criteria      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'pending_review',
  assessed_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

-- TRAINING_SESSIONS
CREATE TABLE IF NOT EXISTS training_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  type           text NOT NULL,
  scheduled_date date NOT NULL,
  location       text,
  facilitator_id uuid NOT NULL,
  attendee_count integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'scheduled',
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now()
);

-- EXPORT_CONTRACTS
CREATE TABLE IF NOT EXISTS export_contracts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number        text NOT NULL UNIQUE,
  buyer                  text NOT NULL,
  destination            text NOT NULL,
  crop_type              text NOT NULL,
  quantity_kg            numeric(12, 3) NOT NULL,
  price_per_kg           numeric(10, 4) NOT NULL,
  certification_required text,
  delivery_date          date,
  status                 text NOT NULL DEFAULT 'draft',
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now()
);

-- SHIPMENTS
CREATE TABLE IF NOT EXISTS shipments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id        uuid NOT NULL,
  commodity_type_id  uuid,
  container_number   text,
  vessel_name        text,
  port_of_loading    text,
  port_of_destination text,
  shipment_date      date,
  total_weight_kg    numeric(12, 3),
  status             text NOT NULL DEFAULT 'preparing',
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now()
);

-- EXPORT_DOCUMENTS
CREATE TABLE IF NOT EXISTS export_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id  uuid NOT NULL,
  type         text NOT NULL,
  title        text NOT NULL,
  file_url     text,
  status       text NOT NULL DEFAULT 'draft',
  issued_at    timestamp with time zone,
  created_at   timestamp with time zone NOT NULL DEFAULT now()
);

-- LOAN_CATEGORIES
CREATE TABLE IF NOT EXISTS loan_categories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  description        text,
  interest_type      text NOT NULL DEFAULT 'flat',
  interest_rate      numeric(6, 3) NOT NULL DEFAULT '0',
  penalty_rate       numeric(6, 3) NOT NULL DEFAULT '0',
  grace_period_days  integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS loan_categories_name_uniq ON loan_categories (name);

-- LOAN_PRODUCTS (FK -> loan_categories, commodity_types)
CREATE TABLE IF NOT EXISTS loan_products (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_category_id         uuid NOT NULL,
  name                     text NOT NULL,
  commodity_type_id        uuid,
  product_type             text NOT NULL DEFAULT 'CASH',
  unit_price               numeric(14, 2),
  unit                     text,
  interest_type            text,
  interest_rate            numeric(6, 3),
  penalty_rate             numeric(6, 3),
  grace_period_days        integer,
  max_amount               numeric(14, 2),
  max_restructures         integer NOT NULL DEFAULT 0,
  repayment_method         text NOT NULL DEFAULT 'auto_deduct',
  recovery_priority        integer NOT NULL DEFAULT 100,
  allow_partial_repayment  boolean NOT NULL DEFAULT true,
  allow_finance_override   boolean NOT NULL DEFAULT true,
  season_based             boolean NOT NULL DEFAULT false,
  entrepreneurs_only       boolean NOT NULL DEFAULT false,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT loan_products_loan_category_id_fkey
    FOREIGN KEY (loan_category_id) REFERENCES loan_categories(id) ON DELETE restrict,
  CONSTRAINT loan_products_commodity_type_id_fkey
    FOREIGN KEY (commodity_type_id) REFERENCES commodity_types(id) ON DELETE set null
);
CREATE INDEX        IF NOT EXISTS loan_products_category_idx        ON loan_products (loan_category_id);
CREATE INDEX        IF NOT EXISTS loan_products_commodity_idx       ON loan_products (commodity_type_id);
CREATE UNIQUE INDEX IF NOT EXISTS loan_products_category_name_uniq  ON loan_products (loan_category_id, name);

-- LOAN_PRODUCT_ITEMS (FK -> loan_products)
CREATE TABLE IF NOT EXISTS loan_product_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_product_id   uuid NOT NULL,
  item_name         text NOT NULL,
  unit_price        numeric(14, 2) NOT NULL DEFAULT '0',
  inventory_item_id uuid,
  supplier_id       uuid,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT loan_product_items_loan_product_id_fkey
    FOREIGN KEY (loan_product_id) REFERENCES loan_products(id) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS loan_product_items_product_idx ON loan_product_items (loan_product_id);

-- LOANS
CREATE TABLE IF NOT EXISTS loans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_number           text NOT NULL UNIQUE,
  farmer_id             uuid,
  group_id              uuid,
  loan_product_id       uuid,
  loan_type             text NOT NULL,
  quantity              numeric(14, 3),
  principal_amount      numeric(14, 2) NOT NULL,
  interest_rate_pct     numeric(6, 3) DEFAULT '0',
  penalty_rate_pct      numeric(6, 3) DEFAULT '0',
  grace_period_days     integer DEFAULT 0,
  total_repayable       numeric(14, 2),
  disbursed_amount      numeric(14, 2),
  outstanding_balance   numeric(14, 2),
  currency              text NOT NULL DEFAULT 'UGX',
  status                text NOT NULL DEFAULT 'PENDING',
  disbursed_at          timestamp with time zone,
  due_date              date,
  original_due_date     date,
  restructure_count     integer NOT NULL DEFAULT 0,
  approved_by_id        uuid,
  approved_at           timestamp with time zone,
  disbursed_by_id       uuid,
  defaulted_at          timestamp with time zone,
  written_off_at        timestamp with time zone,
  written_off_by_id     uuid,
  write_off_reason      text,
  purpose               text,
  collateral            text,
  notes                 text,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now()
);

-- LOAN_REPAYMENTS
CREATE TABLE IF NOT EXISTS loan_repayments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id             uuid NOT NULL,
  amount              numeric(14, 2) NOT NULL,
  payment_date        date NOT NULL,
  payment_method      text,
  reference           text,
  collected_by_id     uuid,
  source_payment_id   uuid,
  source_delivery_id  uuid,
  notes               text,
  created_at          timestamp with time zone NOT NULL DEFAULT now()
);

-- LOAN_GUARANTORS
CREATE TABLE IF NOT EXISTS loan_guarantors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id             uuid NOT NULL,
  guarantor_farmer_id uuid NOT NULL,
  agreed_at           timestamp with time zone,
  notes               text,
  created_at          timestamp with time zone NOT NULL DEFAULT now()
);

-- BUYERS
CREATE TABLE IF NOT EXISTS buyers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  country            text,
  contact_name       text,
  contact_email      text,
  contact_phone      text,
  accepted_streams   text[],
  grade_requirements text,
  origin_requirements text,
  credit_terms_days  integer,
  payment_method     text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now()
);

-- SALES_CONTRACTS
CREATE TABLE IF NOT EXISTS sales_contracts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number     text NOT NULL UNIQUE,
  buyer_id            uuid NOT NULL,
  contract_type       text NOT NULL,
  commodity_type      text,
  grade               text,
  target_quantity_kg  numeric(14, 2),
  agreed_price_per_kg numeric(10, 4),
  currency            text NOT NULL DEFAULT 'USD',
  delivery_window_start date,
  delivery_window_end date,
  incoterms           text,
  certification_required text,
  status              text NOT NULL DEFAULT 'DRAFT',
  approved_by_id      uuid,
  approved_at         timestamp with time zone,
  notes               text,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  updated_at          timestamp with time zone NOT NULL DEFAULT now()
);

-- CONTRACT_ALLOCATIONS
CREATE TABLE IF NOT EXISTS contract_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         uuid NOT NULL,
  lot_id              uuid NOT NULL,
  allocated_weight_kg numeric(14, 2) NOT NULL,
  allocated_by_id     uuid,
  allocated_at        timestamp with time zone NOT NULL DEFAULT now(),
  deallocated_at      timestamp with time zone,
  deallocated_by_id   uuid,
  deallocate_reason   text,
  created_at          timestamp with time zone NOT NULL DEFAULT now()
);

-- DISPATCHES
CREATE TABLE IF NOT EXISTS dispatches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_number       text NOT NULL UNIQUE,
  contract_id           uuid,
  commodity_type_id     uuid,
  container_number      text,
  seal_number           text,
  truck_reg             text,
  driver_name           text,
  dispatch_weight_kg    numeric(14, 2),
  is_manual_weight      boolean NOT NULL DEFAULT false,
  weight_override_reason text,
  status                text NOT NULL DEFAULT 'PENDING',
  loaded_at             timestamp with time zone,
  loaded_by_id          uuid,
  delivered_at          timestamp with time zone,
  notes                 text,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now()
);

-- INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    text NOT NULL UNIQUE,
  contract_id       uuid,
  dispatch_id       uuid,
  dispatch_weight_kg numeric(14, 2),
  price_per_kg      numeric(10, 4),
  subtotal          numeric(14, 2),
  tax_amount        numeric(14, 2),
  total_amount      numeric(14, 2),
  currency          text NOT NULL DEFAULT 'USD',
  status            text NOT NULL DEFAULT 'DRAFT',
  sent_at           timestamp with time zone,
  due_date          date,
  paid_amount       numeric(14, 2),
  paid_at           timestamp with time zone,
  approved_by_id    uuid,
  approved_at       timestamp with time zone,
  notes             text,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now()
);

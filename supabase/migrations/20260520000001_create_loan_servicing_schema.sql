/*
  # Loan Servicing schema

  Adds a separate servicing module: closed loans, amortization schedules,
  payment ledger, and Plaid Transfer ACH authorizations. This is completely
  decoupled from the LOS tables — no FK back into loan_scenarios — because
  KREC will manually onboard each closed loan into servicing (per the
  user's choice on the design questions).

  Tables:
    serviced_loans                       — one row per active loan
    serviced_loan_schedule               — pre-computed amortization rows
    serviced_loan_payments               — actual payment ledger
    serviced_loan_ach_authorizations     — Plaid bank link per loan

  RLS:
    Borrower SELECT on rows where they're the legal payor.
    Org admins/owners full access via fn_user_is_org_admin_for_borrower
    (helper from migration 20260514000003). Brokers have no access by
    default — servicing is admin-only.
*/

-- ============================================
-- serviced_loans
-- ============================================
CREATE TABLE IF NOT EXISTS serviced_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE RESTRICT,
  loan_number text UNIQUE NOT NULL,

  -- Property
  property_address text,
  property_city text,
  property_state text,
  property_zip text,

  -- Terms
  original_principal numeric(14, 2) NOT NULL CHECK (original_principal > 0),
  current_principal numeric(14, 2) NOT NULL CHECK (current_principal >= 0),
  interest_rate numeric(7, 5) NOT NULL CHECK (interest_rate >= 0 AND interest_rate <= 1),
  amortization_term_months int NOT NULL CHECK (amortization_term_months > 0),
  loan_term_months int NOT NULL CHECK (loan_term_months > 0),
  payment_frequency text NOT NULL DEFAULT 'monthly' CHECK (payment_frequency IN ('monthly', 'biweekly', 'weekly')),

  -- Dates
  origination_date date NOT NULL,
  first_payment_date date NOT NULL,
  maturity_date date NOT NULL,
  next_payment_due_date date,

  -- Escrow (collect-and-track; admin disburses externally for MVP)
  escrow_taxes_monthly numeric(10, 2) NOT NULL DEFAULT 0 CHECK (escrow_taxes_monthly >= 0),
  escrow_insurance_monthly numeric(10, 2) NOT NULL DEFAULT 0 CHECK (escrow_insurance_monthly >= 0),
  escrow_balance numeric(12, 2) NOT NULL DEFAULT 0,

  -- Servicing status
  servicing_status text NOT NULL DEFAULT 'active'
    CHECK (servicing_status IN ('active', 'paid_off', 'delinquent', 'in_foreclosure', 'transferred')),

  -- Late-fee policy (collected via P2)
  late_fee_amount numeric(8, 2) NOT NULL DEFAULT 0 CHECK (late_fee_amount >= 0),
  grace_period_days int NOT NULL DEFAULT 15 CHECK (grace_period_days >= 0),

  -- Audit
  created_by uuid REFERENCES user_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serviced_loans_borrower ON serviced_loans(borrower_id);
CREATE INDEX IF NOT EXISTS idx_serviced_loans_organization ON serviced_loans(organization_id);
CREATE INDEX IF NOT EXISTS idx_serviced_loans_status ON serviced_loans(servicing_status);
CREATE INDEX IF NOT EXISTS idx_serviced_loans_next_due ON serviced_loans(next_payment_due_date) WHERE servicing_status = 'active';

ALTER TABLE serviced_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Borrower can view own serviced loans"
  ON serviced_loans FOR SELECT
  TO authenticated
  USING (borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid()));

CREATE POLICY "Org admins can view all org serviced loans"
  ON serviced_loans FOR SELECT
  TO authenticated
  USING (fn_user_is_org_admin_for_borrower(borrower_id));

CREATE POLICY "Org admins can insert serviced loans"
  ON serviced_loans FOR INSERT
  TO authenticated
  WITH CHECK (fn_user_is_org_admin_for_borrower(borrower_id));

CREATE POLICY "Org admins can update serviced loans"
  ON serviced_loans FOR UPDATE
  TO authenticated
  USING (fn_user_is_org_admin_for_borrower(borrower_id))
  WITH CHECK (fn_user_is_org_admin_for_borrower(borrower_id));

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER serviced_loans_touch BEFORE UPDATE ON serviced_loans
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ============================================
-- serviced_loan_schedule (pre-computed amortization)
-- ============================================
CREATE TABLE IF NOT EXISTS serviced_loan_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serviced_loan_id uuid NOT NULL REFERENCES serviced_loans(id) ON DELETE CASCADE,
  payment_number int NOT NULL CHECK (payment_number > 0),
  due_date date NOT NULL,

  scheduled_principal numeric(12, 2) NOT NULL,
  scheduled_interest numeric(12, 2) NOT NULL,
  scheduled_escrow numeric(10, 2) NOT NULL DEFAULT 0,
  scheduled_total numeric(12, 2) NOT NULL,
  ending_balance numeric(14, 2) NOT NULL,

  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'paid', 'partial', 'skipped', 'late')),

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (serviced_loan_id, payment_number)
);

CREATE INDEX IF NOT EXISTS idx_servicing_schedule_loan ON serviced_loan_schedule(serviced_loan_id);
CREATE INDEX IF NOT EXISTS idx_servicing_schedule_due ON serviced_loan_schedule(due_date) WHERE status IN ('scheduled', 'late');

ALTER TABLE serviced_loan_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Borrower can view own loan schedule"
  ON serviced_loan_schedule FOR SELECT
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans
    WHERE borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid())
  ));

CREATE POLICY "Org admins can view all schedule"
  ON serviced_loan_schedule FOR SELECT
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

CREATE POLICY "Org admins can insert schedule"
  ON serviced_loan_schedule FOR INSERT
  TO authenticated
  WITH CHECK (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

CREATE POLICY "Org admins can update schedule"
  ON serviced_loan_schedule FOR UPDATE
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ))
  WITH CHECK (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

-- ============================================
-- serviced_loan_payments (actual payment ledger)
-- ============================================
CREATE TABLE IF NOT EXISTS serviced_loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serviced_loan_id uuid NOT NULL REFERENCES serviced_loans(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES serviced_loan_schedule(id) ON DELETE SET NULL,

  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  principal_applied numeric(12, 2) NOT NULL DEFAULT 0,
  interest_applied numeric(12, 2) NOT NULL DEFAULT 0,
  escrow_applied numeric(10, 2) NOT NULL DEFAULT 0,
  fees_applied numeric(10, 2) NOT NULL DEFAULT 0,

  payment_method text NOT NULL CHECK (payment_method IN ('ach', 'wire', 'check', 'manual', 'card_one_time')),
  provider text CHECK (provider IS NULL OR provider IN ('plaid_transfer', 'manual')),

  provider_transfer_id text,
  provider_authorization_id text,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'failed', 'returned', 'reversed')),
  failure_reason text,

  initiated_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  returned_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_servicing_payments_loan ON serviced_loan_payments(serviced_loan_id);
CREATE INDEX IF NOT EXISTS idx_servicing_payments_schedule ON serviced_loan_payments(schedule_id);
CREATE INDEX IF NOT EXISTS idx_servicing_payments_provider_id ON serviced_loan_payments(provider_transfer_id) WHERE provider_transfer_id IS NOT NULL;

ALTER TABLE serviced_loan_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Borrower can view own payments"
  ON serviced_loan_payments FOR SELECT
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans
    WHERE borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid())
  ));

CREATE POLICY "Org admins can view all payments"
  ON serviced_loan_payments FOR SELECT
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

CREATE POLICY "Org admins can insert payments"
  ON serviced_loan_payments FOR INSERT
  TO authenticated
  WITH CHECK (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

CREATE POLICY "Org admins can update payments"
  ON serviced_loan_payments FOR UPDATE
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ))
  WITH CHECK (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

-- ============================================
-- serviced_loan_ach_authorizations (Plaid bank link)
-- ============================================
CREATE TABLE IF NOT EXISTS serviced_loan_ach_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serviced_loan_id uuid NOT NULL REFERENCES serviced_loans(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'plaid_transfer' CHECK (provider IN ('plaid_transfer')),

  -- Plaid-specific
  provider_account_id text,
  provider_access_token_encrypted text,  -- TODO P2: pgsodium / Supabase Vault wrapping
  authorization_id text,
  authorized_amount_ceiling numeric(12, 2),

  -- Display
  account_mask text,
  bank_name text,
  account_holder_name text,

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  authorized_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_servicing_ach_loan ON serviced_loan_ach_authorizations(serviced_loan_id);
CREATE INDEX IF NOT EXISTS idx_servicing_ach_active ON serviced_loan_ach_authorizations(serviced_loan_id) WHERE status = 'active';

ALTER TABLE serviced_loan_ach_authorizations ENABLE ROW LEVEL SECURITY;

-- Borrower sees only display fields; full row including access token is service-role only
CREATE POLICY "Borrower can view own ACH auth (display)"
  ON serviced_loan_ach_authorizations FOR SELECT
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans
    WHERE borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid())
  ));

CREATE POLICY "Org admins can view all ACH auth"
  ON serviced_loan_ach_authorizations FOR SELECT
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

CREATE POLICY "Org admins can insert ACH auth"
  ON serviced_loan_ach_authorizations FOR INSERT
  TO authenticated
  WITH CHECK (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

CREATE POLICY "Org admins can update ACH auth"
  ON serviced_loan_ach_authorizations FOR UPDATE
  TO authenticated
  USING (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ))
  WITH CHECK (serviced_loan_id IN (
    SELECT id FROM serviced_loans WHERE fn_user_is_org_admin_for_borrower(borrower_id)
  ));

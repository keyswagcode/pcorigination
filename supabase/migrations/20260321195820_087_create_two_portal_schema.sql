/*
  # Two-Portal Lending Platform Schema

  This migration creates the core tables for separating borrower-level financial
  pre-qualification from property-specific loan scenarios, enabling a strict
  two-portal architecture.

  ## 1. New Tables
  
  ### borrower_financial_profiles
  Stores borrower-level financial data extracted from documents for pre-qualification.
  - `id` (uuid, primary key)
  - `borrower_id` (uuid, FK to borrowers)
  - `monthly_income` (numeric) - Estimated monthly income from documents
  - `avg_monthly_deposits` (numeric) - Average deposits across bank statements
  - `ending_balance_avg` (numeric) - Average ending balance
  - `liquidity_estimate` (numeric) - Total liquid assets estimate
  - `income_estimate` (numeric) - Annualized income estimate
  - `cash_flow_estimate` (numeric) - Net monthly cash flow
  - `confidence_score` (numeric) - Overall data confidence (0-100)
  - `summary` (jsonb) - Detailed breakdown and notes

  ### prequal_results
  Stores borrower-level pre-qualification output (no property data).
  - `id` (uuid, primary key)
  - `borrower_id` (uuid, FK to borrowers)
  - `prequalified_amount` (numeric) - Maximum qualified loan amount
  - `qualification_range_low/high` (numeric) - Qualification range
  - `estimated_rate_low/high` (numeric) - Indicative rate range
  - `confidence` (text) - Confidence level (high/medium/low)
  - `summary` (text) - Human-readable summary

  ### borrower_identity_documents
  Dedicated table for identity document tracking with verification workflow.
  - `id` (uuid, primary key)
  - `borrower_id` (uuid, FK to borrowers)
  - `document_type` (text) - drivers_license, passport, government_id
  - `verification_status` (text) - not_uploaded, pending_review, verified, rejected
  - Verification tracking fields (verified_by, verified_at, notes)

  ### analyst_decisions
  Stores internal human review decisions on borrower applications.
  - `id` (uuid, primary key)
  - `borrower_id` (uuid, FK to borrowers)
  - `analyst_id` (uuid) - The analyst making the decision
  - `decision` (text) - approved, conditionally_approved, declined, additional_docs_requested
  - `conditions` (jsonb) - Approval conditions if conditional
  - `approved_amount` (numeric) - Final approved amount

  ### loan_scenarios
  Property-specific loan scenarios, only created after borrower approval.
  - `id` (uuid, primary key)
  - `borrower_id` (uuid, FK to borrowers)
  - `scenario_name` (text) - User-friendly name
  - Property details (address, type, occupancy, prices, etc.)
  - Loan details (type, amount, LTV, DSCR, purpose)
  - `status` (text) - draft, submitted, under_review, matched, etc.

  ### loan_scenario_underwriting_results
  Stores scenario-specific underwriting and placement outputs.
  - `id` (uuid, primary key)
  - `loan_scenario_id` (uuid, FK to loan_scenarios)
  - Routing and placement results (jsonb)
  - Summary and recommendations

  ### underwriting_runs
  Tracks both borrower-level and scenario-level underwriting executions.
  - `id` (uuid, primary key)
  - `borrower_id` (uuid, nullable)
  - `loan_scenario_id` (uuid, nullable)
  - `run_type` (text) - borrower_underwriting or scenario_underwriting
  - Timing and status tracking

  ## 2. Schema Changes

  ### borrowers table
  - Add `borrower_status` column for borrower-level workflow status

  ### uploaded_documents table
  - Add `document_subtype` for identity document classification
  - Add `loan_scenario_id` for scenario-specific documents

  ## 3. Security
  - RLS enabled on all new tables
  - Policies for authenticated users to access their own data
  - Internal tables restricted to reviewer/admin roles
*/

-- Add borrower_status to borrowers table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'borrower_status'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN borrower_status text DEFAULT 'draft';
  END IF;
END $$;

-- Create borrower_financial_profiles table
CREATE TABLE IF NOT EXISTS borrower_financial_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  monthly_income numeric,
  avg_monthly_deposits numeric,
  ending_balance_avg numeric,
  liquidity_estimate numeric,
  income_estimate numeric,
  cash_flow_estimate numeric,
  confidence_score numeric,
  summary jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(borrower_id)
);

ALTER TABLE borrower_financial_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own borrower financial profiles"
  ON borrower_financial_profiles FOR SELECT
  TO authenticated
  USING (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own borrower financial profiles"
  ON borrower_financial_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own borrower financial profiles"
  ON borrower_financial_profiles FOR UPDATE
  TO authenticated
  USING (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Reviewers can view all borrower financial profiles"
  ON borrower_financial_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can manage all borrower financial profiles"
  ON borrower_financial_profiles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Create prequal_results table
CREATE TABLE IF NOT EXISTS prequal_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  prequalified_amount numeric NOT NULL,
  qualification_range_low numeric,
  qualification_range_high numeric,
  estimated_rate_low numeric,
  estimated_rate_high numeric,
  confidence text,
  summary text,
  generated_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE prequal_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own prequal results"
  ON prequal_results FOR SELECT
  TO authenticated
  USING (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Reviewers can view all prequal results"
  ON prequal_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can manage prequal results"
  ON prequal_results FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Create borrower_identity_documents table
CREATE TABLE IF NOT EXISTS borrower_identity_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending_review',
  verified_by uuid,
  verified_at timestamptz,
  rejection_reason text,
  notes text,
  uploaded_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_id_document_type CHECK (document_type IN ('drivers_license', 'passport', 'government_id')),
  CONSTRAINT valid_id_verification_status CHECK (verification_status IN ('not_uploaded', 'pending_review', 'verified', 'rejected'))
);

ALTER TABLE borrower_identity_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own identity documents"
  ON borrower_identity_documents FOR SELECT
  TO authenticated
  USING (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own identity documents"
  ON borrower_identity_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Reviewers can view all identity documents"
  ON borrower_identity_documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can manage identity documents"
  ON borrower_identity_documents FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Create analyst_decisions table
CREATE TABLE IF NOT EXISTS analyst_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  analyst_id uuid,
  decision text NOT NULL,
  notes text,
  conditions jsonb,
  approved_amount numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_analyst_decision CHECK (decision IN ('approved', 'conditionally_approved', 'declined', 'additional_docs_requested'))
);

ALTER TABLE analyst_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviewers can view all decisions"
  ON analyst_decisions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can insert decisions"
  ON analyst_decisions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can update decisions"
  ON analyst_decisions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Create loan_scenarios table
CREATE TABLE IF NOT EXISTS loan_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  scenario_name text NOT NULL,
  loan_type text,
  property_address text,
  property_city text,
  property_state text,
  property_zip text,
  property_type text,
  occupancy text,
  purchase_price numeric,
  estimated_value numeric,
  loan_amount numeric,
  ltv numeric,
  rent numeric,
  dscr numeric,
  loan_purpose text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_scenario_status CHECK (status IN ('draft', 'submitted', 'under_review', 'matched', 'conditionally_approved', 'approved', 'declined'))
);

ALTER TABLE loan_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scenarios"
  ON loan_scenarios FOR SELECT
  TO authenticated
  USING (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert scenarios when approved"
  ON loan_scenarios FOR INSERT
  TO authenticated
  WITH CHECK (
    borrower_id IN (
      SELECT id FROM borrowers 
      WHERE user_id = auth.uid() 
      AND borrower_status IN ('approved', 'conditionally_approved')
    )
  );

CREATE POLICY "Users can update own draft scenarios"
  ON loan_scenarios FOR UPDATE
  TO authenticated
  USING (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
    AND status = 'draft'
  )
  WITH CHECK (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own draft scenarios"
  ON loan_scenarios FOR DELETE
  TO authenticated
  USING (
    borrower_id IN (
      SELECT id FROM borrowers WHERE user_id = auth.uid()
    )
    AND status = 'draft'
  );

CREATE POLICY "Reviewers can view all scenarios"
  ON loan_scenarios FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can manage all scenarios"
  ON loan_scenarios FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Create loan_scenario_underwriting_results table
CREATE TABLE IF NOT EXISTS loan_scenario_underwriting_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_scenario_id uuid NOT NULL REFERENCES loan_scenarios(id) ON DELETE CASCADE,
  recommended_loan_type text,
  routing_result_json jsonb,
  dscr_result_json jsonb,
  nqm_result_json jsonb,
  lender_matches_json jsonb,
  summary text,
  confidence_score numeric,
  generated_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(loan_scenario_id)
);

ALTER TABLE loan_scenario_underwriting_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviewers can view scenario underwriting results"
  ON loan_scenario_underwriting_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can manage scenario underwriting results"
  ON loan_scenario_underwriting_results FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Create underwriting_runs table
CREATE TABLE IF NOT EXISTS underwriting_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid REFERENCES borrowers(id) ON DELETE CASCADE,
  loan_scenario_id uuid REFERENCES loan_scenarios(id) ON DELETE CASCADE,
  run_type text NOT NULL,
  run_status text NOT NULL DEFAULT 'pending',
  triggered_by uuid,
  input_snapshot jsonb,
  output_snapshot jsonb,
  error_message text,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT valid_uw_run_type CHECK (run_type IN ('borrower_underwriting', 'scenario_underwriting')),
  CONSTRAINT valid_uw_run_status CHECK (run_status IN ('pending', 'running', 'completed', 'failed'))
);

ALTER TABLE underwriting_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviewers can view underwriting runs"
  ON underwriting_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can manage underwriting runs"
  ON underwriting_runs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Create borrower_underwriting_results table for internal borrower-level results
CREATE TABLE IF NOT EXISTS borrower_underwriting_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  recommended_loan_type text,
  routing_result_json jsonb,
  dscr_result_json jsonb,
  nqm_result_json jsonb,
  lender_matches_json jsonb,
  summary text,
  confidence_score numeric,
  generated_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE borrower_underwriting_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviewers can view borrower underwriting results"
  ON borrower_underwriting_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

CREATE POLICY "Reviewers can manage borrower underwriting results"
  ON borrower_underwriting_results FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_accounts
      WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')
    )
  );

-- Add document_subtype and loan_scenario_id to uploaded_documents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'uploaded_documents' AND column_name = 'document_subtype'
  ) THEN
    ALTER TABLE uploaded_documents ADD COLUMN document_subtype text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'uploaded_documents' AND column_name = 'loan_scenario_id'
  ) THEN
    ALTER TABLE uploaded_documents ADD COLUMN loan_scenario_id uuid REFERENCES loan_scenarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_borrower_financial_profiles_borrower_id 
  ON borrower_financial_profiles(borrower_id);

CREATE INDEX IF NOT EXISTS idx_prequal_results_borrower_id 
  ON prequal_results(borrower_id);

CREATE INDEX IF NOT EXISTS idx_borrower_identity_documents_borrower_id 
  ON borrower_identity_documents(borrower_id);

CREATE INDEX IF NOT EXISTS idx_analyst_decisions_borrower_id 
  ON analyst_decisions(borrower_id);

CREATE INDEX IF NOT EXISTS idx_analyst_decisions_analyst_id 
  ON analyst_decisions(analyst_id);

CREATE INDEX IF NOT EXISTS idx_loan_scenarios_borrower_id 
  ON loan_scenarios(borrower_id);

CREATE INDEX IF NOT EXISTS idx_loan_scenarios_status 
  ON loan_scenarios(status);

CREATE INDEX IF NOT EXISTS idx_underwriting_runs_borrower_id 
  ON underwriting_runs(borrower_id);

CREATE INDEX IF NOT EXISTS idx_underwriting_runs_loan_scenario_id 
  ON underwriting_runs(loan_scenario_id);

CREATE INDEX IF NOT EXISTS idx_borrowers_borrower_status 
  ON borrowers(borrower_status);

CREATE INDEX IF NOT EXISTS idx_borrower_underwriting_results_borrower_id 
  ON borrower_underwriting_results(borrower_id);

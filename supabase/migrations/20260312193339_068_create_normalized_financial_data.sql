/*
  # Normalized Financial Data Layer

  This migration creates the normalized data layer that sits between raw extraction outputs
  and the dashboard. This ensures consistent data regardless of extraction inconsistencies.

  ## Architecture
  Document Upload → Storage → Extraction → **Normalization Layer** → Dashboard

  ## Tables Created

  1. `normalized_bank_accounts` - Clean structured bank account data
     - Account identification
     - Balance fields (normalized from various extraction formats)
     - Transaction summaries
     - Statement period
     - Risk indicators (NSF, overdrafts)

  2. `extraction_field_mappings` - Maps raw extracted field names to normalized fields
     - Allows "Beginning Balance", "Starting Balance", "Balance Forward" → `beginning_balance`

  3. `extraction_audit_log` - Audit trail for each extracted field
     - Raw extracted value
     - Normalized value
     - Source page
     - Confidence score
     - Enables full traceability

  4. `document_classifications` - Document type detection results
     - Detected document type
     - Classification confidence
     - Classification method (auto/manual)

  ## Security
  - RLS enabled on all tables
  - Policies for authenticated users based on organization membership
*/

-- Normalized bank account data (the single source of truth for dashboards)
CREATE TABLE IF NOT EXISTS normalized_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_submission_id uuid REFERENCES intake_submissions(id) ON DELETE CASCADE,
  uploaded_document_id uuid REFERENCES uploaded_documents(id) ON DELETE CASCADE,
  borrower_id uuid REFERENCES borrowers(id) ON DELETE CASCADE,
  
  -- Account identification
  institution_name text,
  account_number_last4 text,
  account_type text CHECK (account_type IN ('checking', 'savings', 'money_market', 'brokerage', 'business_checking', 'business_savings', 'other')),
  account_holder_name text,
  
  -- Balance fields (normalized)
  beginning_balance numeric(15,2),
  ending_balance numeric(15,2),
  average_daily_balance numeric(15,2),
  lowest_balance numeric(15,2),
  highest_balance numeric(15,2),
  
  -- Transaction summaries (normalized)
  total_deposits numeric(15,2),
  total_withdrawals numeric(15,2),
  deposit_count integer DEFAULT 0,
  withdrawal_count integer DEFAULT 0,
  
  -- Calculated monthly averages
  avg_monthly_deposits numeric(15,2),
  avg_monthly_withdrawals numeric(15,2),
  avg_monthly_balance numeric(15,2),
  
  -- Statement period
  statement_start_date date,
  statement_end_date date,
  statement_month integer,
  statement_year integer,
  
  -- Risk indicators (normalized)
  nsf_count integer DEFAULT 0,
  overdraft_count integer DEFAULT 0,
  returned_item_count integer DEFAULT 0,
  large_deposit_count integer DEFAULT 0,
  large_deposit_threshold numeric(15,2),
  
  -- Data quality
  normalization_confidence numeric(3,2) CHECK (normalization_confidence >= 0 AND normalization_confidence <= 1),
  requires_manual_review boolean DEFAULT false,
  review_notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  
  -- Metadata
  source_extraction_id uuid,
  extraction_version text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(uploaded_document_id)
);

-- Field mapping table for normalization rules
CREATE TABLE IF NOT EXISTS extraction_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  raw_field_name text NOT NULL,
  normalized_field_name text NOT NULL,
  transformation_rule text,
  priority integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(document_type, raw_field_name)
);

-- Extraction audit log for traceability
CREATE TABLE IF NOT EXISTS extraction_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_document_id uuid NOT NULL REFERENCES uploaded_documents(id) ON DELETE CASCADE,
  normalized_account_id uuid REFERENCES normalized_bank_accounts(id) ON DELETE CASCADE,
  
  -- Field identification
  field_name text NOT NULL,
  normalized_field_name text,
  
  -- Values
  raw_extracted_value text,
  normalized_value text,
  data_type text,
  
  -- Source reference
  source_page integer,
  source_coordinates jsonb,
  bounding_box jsonb,
  
  -- Confidence and validation
  extraction_confidence numeric(3,2) CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1),
  validation_status text CHECK (validation_status IN ('pending', 'validated', 'corrected', 'rejected')),
  validation_notes text,
  validated_by uuid REFERENCES auth.users(id),
  validated_at timestamptz,
  
  -- Extraction metadata
  extraction_method text,
  extraction_model text,
  extraction_timestamp timestamptz DEFAULT now(),
  
  created_at timestamptz DEFAULT now()
);

-- Document classification results
CREATE TABLE IF NOT EXISTS document_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_document_id uuid NOT NULL REFERENCES uploaded_documents(id) ON DELETE CASCADE,
  
  -- Classification result
  detected_type text NOT NULL,
  sub_type text,
  classification_confidence numeric(3,2) CHECK (classification_confidence >= 0 AND classification_confidence <= 1),
  
  -- Classification method
  classification_method text CHECK (classification_method IN ('auto_ml', 'rule_based', 'manual', 'llm')),
  model_version text,
  
  -- Validation
  is_confirmed boolean DEFAULT false,
  confirmed_type text,
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz,
  
  -- Metadata
  classification_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(uploaded_document_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_normalized_bank_accounts_submission ON normalized_bank_accounts(intake_submission_id);
CREATE INDEX IF NOT EXISTS idx_normalized_bank_accounts_borrower ON normalized_bank_accounts(borrower_id);
CREATE INDEX IF NOT EXISTS idx_normalized_bank_accounts_document ON normalized_bank_accounts(uploaded_document_id);
CREATE INDEX IF NOT EXISTS idx_extraction_audit_document ON extraction_audit_log(uploaded_document_id);
CREATE INDEX IF NOT EXISTS idx_extraction_audit_normalized ON extraction_audit_log(normalized_account_id);
CREATE INDEX IF NOT EXISTS idx_document_classifications_document ON document_classifications(uploaded_document_id);
CREATE INDEX IF NOT EXISTS idx_extraction_field_mappings_lookup ON extraction_field_mappings(document_type, raw_field_name) WHERE is_active = true;

-- Enable RLS
ALTER TABLE normalized_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_classifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for normalized_bank_accounts
CREATE POLICY "Users can view normalized accounts for their org submissions"
  ON normalized_bank_accounts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM intake_submissions s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = normalized_bank_accounts.intake_submission_id
      AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert normalized accounts for their org submissions"
  ON normalized_bank_accounts FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intake_submissions s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = normalized_bank_accounts.intake_submission_id
      AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update normalized accounts for their org submissions"
  ON normalized_bank_accounts FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM intake_submissions s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = normalized_bank_accounts.intake_submission_id
      AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intake_submissions s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = normalized_bank_accounts.intake_submission_id
      AND om.user_id = auth.uid()
    )
  );

-- Field mappings are readable by all authenticated users (reference data)
CREATE POLICY "Authenticated users can view field mappings"
  ON extraction_field_mappings FOR SELECT TO authenticated
  USING (true);

-- RLS Policies for extraction_audit_log
CREATE POLICY "Users can view audit logs for their org documents"
  ON extraction_audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM uploaded_documents ud
      JOIN intake_submissions s ON s.id = ud.intake_submission_id
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE ud.id = extraction_audit_log.uploaded_document_id
      AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert audit logs for their org documents"
  ON extraction_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM uploaded_documents ud
      JOIN intake_submissions s ON s.id = ud.intake_submission_id
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE ud.id = extraction_audit_log.uploaded_document_id
      AND om.user_id = auth.uid()
    )
  );

-- RLS Policies for document_classifications
CREATE POLICY "Users can view classifications for their org documents"
  ON document_classifications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM uploaded_documents ud
      JOIN intake_submissions s ON s.id = ud.intake_submission_id
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE ud.id = document_classifications.uploaded_document_id
      AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert classifications for their org documents"
  ON document_classifications FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM uploaded_documents ud
      JOIN intake_submissions s ON s.id = ud.intake_submission_id
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE ud.id = document_classifications.uploaded_document_id
      AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update classifications for their org documents"
  ON document_classifications FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM uploaded_documents ud
      JOIN intake_submissions s ON s.id = ud.intake_submission_id
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE ud.id = document_classifications.uploaded_document_id
      AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM uploaded_documents ud
      JOIN intake_submissions s ON s.id = ud.intake_submission_id
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE ud.id = document_classifications.uploaded_document_id
      AND om.user_id = auth.uid()
    )
  );

-- URLA Section 1a (Current Address) requires duration at current address,
-- housing tenure type (Own/Rent/No primary housing expense), and monthly
-- housing expense. If duration < 24 months, the URLA also requires former
-- addresses with the same fields. We store the former addresses in a
-- separate table so we can have multiple per borrower.

ALTER TABLE borrowers
  ADD COLUMN IF NOT EXISTS address_years_at INT CHECK (address_years_at >= 0 AND address_years_at <= 99),
  ADD COLUMN IF NOT EXISTS address_months_at INT CHECK (address_months_at >= 0 AND address_months_at < 12),
  ADD COLUMN IF NOT EXISTS housing_type TEXT CHECK (housing_type IN ('own', 'rent', 'rent_free')),
  ADD COLUMN IF NOT EXISTS monthly_housing_expense NUMERIC;

CREATE TABLE IF NOT EXISTS borrower_previous_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id UUID NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  years_at INT CHECK (years_at >= 0 AND years_at <= 99),
  months_at INT CHECK (months_at >= 0 AND months_at < 12),
  housing_type TEXT CHECK (housing_type IN ('own', 'rent', 'rent_free')),
  monthly_housing_expense NUMERIC,
  sequence_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_borrower_previous_addresses_borrower
  ON borrower_previous_addresses(borrower_id);

ALTER TABLE borrower_previous_addresses ENABLE ROW LEVEL SECURITY;

-- Borrower can read/write their own previous addresses
CREATE POLICY "Users can view own previous addresses"
  ON borrower_previous_addresses FOR SELECT
  TO authenticated
  USING (borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own previous addresses"
  ON borrower_previous_addresses FOR INSERT
  TO authenticated
  WITH CHECK (borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own previous addresses"
  ON borrower_previous_addresses FOR UPDATE
  TO authenticated
  USING (borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid()))
  WITH CHECK (borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own previous addresses"
  ON borrower_previous_addresses FOR DELETE
  TO authenticated
  USING (borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid()));

-- KREC reviewers/admins (matches the pattern in migration 087)
CREATE POLICY "Reviewers can view all previous addresses"
  ON borrower_previous_addresses FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM user_accounts WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')));

CREATE POLICY "Reviewers can manage all previous addresses"
  ON borrower_previous_addresses FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM user_accounts WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_accounts WHERE id = auth.uid() AND user_role IN ('reviewer', 'admin')));

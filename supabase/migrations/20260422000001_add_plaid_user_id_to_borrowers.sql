ALTER TABLE borrowers
  ADD COLUMN IF NOT EXISTS plaid_user_id TEXT,
  ADD COLUMN IF NOT EXISTS plaid_report_status TEXT;

CREATE INDEX IF NOT EXISTS idx_borrowers_plaid_user_id ON borrowers (plaid_user_id);

-- Per-broker Valora AMC credentials. Frontend never reads
-- valora_password_encrypted; only the order-appraisal edge function does,
-- via the service-role client.
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS valora_username TEXT,
  ADD COLUMN IF NOT EXISTS valora_password_encrypted TEXT;

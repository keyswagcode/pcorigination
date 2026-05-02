-- Per-broker ISC Credit Bureau credentials. Frontend never reads
-- isc_password_encrypted; only the pull-credit edge function does, via
-- the service-role client.
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS isc_username TEXT,
  ADD COLUMN IF NOT EXISTS isc_password_encrypted TEXT;

/*
  # Saved (non-sensitive) payment-card metadata per broker

  We're not storing the full PAN or CVC — that would put us in PCI-DSS scope.
  We do store the bits the broker would otherwise have to retype on every
  credit pull: cardholder name, billing zip, expiration, brand, and the
  last four digits for visual confirmation.

  After a successful credit pull, the frontend saves these fields. On the
  next pull, the modal shows "Saved: Visa •••• 4242" with a button that
  pre-fills everything except the PAN + CVC.
*/

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS saved_card_last4 TEXT,
  ADD COLUMN IF NOT EXISTS saved_card_brand TEXT,
  ADD COLUMN IF NOT EXISTS saved_card_holder_name TEXT,
  ADD COLUMN IF NOT EXISTS saved_card_zip TEXT,
  ADD COLUMN IF NOT EXISTS saved_card_exp_month TEXT,
  ADD COLUMN IF NOT EXISTS saved_card_exp_year TEXT,
  ADD COLUMN IF NOT EXISTS saved_card_updated_at TIMESTAMPTZ;

/*
  # Explicit GHL user mapping for contact/opportunity owner assignment

  sync-ghl assigns the GHL contact/opportunity owner by matching the loanflow
  broker's email against GHL location users. That fails when the two emails
  differ (it did for 2 of the team). ghl_user_id is an explicit override the
  sync uses before falling back to email matching.
*/

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS ghl_user_id text;

NOTIFY pgrst, 'reload schema';

/*
  # Track CRA report regeneration to bound auto-retries

  When Plaid's CRA base report fails with DATA_QUALITY_CHECK_FAILED ("bank
  provided inconsistent transaction history data"), Plaid's documented fix is
  to regenerate a fresh report via /cra/check_report/create. We do that
  automatically, but at most once per 24h per borrower so a persistently-bad
  bank can't loop. This column records the last regeneration attempt.
*/

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS plaid_report_regenerated_at timestamptz;

NOTIFY pgrst, 'reload schema';

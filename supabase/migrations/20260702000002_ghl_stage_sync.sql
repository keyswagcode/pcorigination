/*
  # GHL → loanflow pipeline stage sync (one-way, GHL is source of truth)

  Loans get their GHL opportunity id stored at creation; a 30-min cron calls
  sync-ghl {action:'sync_stages'} which reads each opportunity's current
  pipeline stage from GHL and updates loan_scenarios.status accordingly.
  Loanflow NEVER writes stages back to GHL.
*/

ALTER TABLE loan_scenarios ADD COLUMN IF NOT EXISTS ghl_opportunity_id text;
ALTER TABLE loan_scenarios ADD COLUMN IF NOT EXISTS ghl_stage_name text;
CREATE INDEX IF NOT EXISTS idx_loan_scenarios_ghl_opp ON loan_scenarios(ghl_opportunity_id)
  WHERE ghl_opportunity_id IS NOT NULL;

DO $$
DECLARE job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'ghl-stage-sync';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'ghl-stage-sync',
  '*/30 * * * *',
  $$
    select net.http_post(
      'https://nfhvzwzvpielutidqkqp.supabase.co/functions/v1/sync-ghl',
      '{"action": "sync_stages"}'::jsonb,
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb,
      120000
    );
  $$
);

NOTIFY pgrst, 'reload schema';

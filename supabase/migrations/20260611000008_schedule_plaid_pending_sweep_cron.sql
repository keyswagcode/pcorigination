/*
  # Plaid pending-report recovery sweep — every 15 minutes

  Plaid's CRA report readiness arrives via webhook; if that webhook is missed
  or delayed, the borrower's report was only fetched when they happened to
  revisit the page and poll (one borrower sat 'pending' for ~2 days). This
  cron calls plaid-link {action:'sweep_pending'}, which re-checks every
  borrower stuck in plaid_report_status='pending' and resolves each to
  'ready' (storing liquidity/income/DTI + pre-approvals) or 'error'. Idempotent.

  Matches the security model of the existing servicing crons: the function is
  invoked without a user JWT; sweep_pending takes no input and returns only
  counts.
*/

do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'plaid-pending-sweep';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

select cron.schedule(
  'plaid-pending-sweep',
  '*/15 * * * *',
  $$
    select net.http_post(
      'https://nfhvzwzvpielutidqkqp.supabase.co/functions/v1/plaid-link',
      '{"action": "sweep_pending"}'::jsonb,
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb,
      120000
    );
  $$
);

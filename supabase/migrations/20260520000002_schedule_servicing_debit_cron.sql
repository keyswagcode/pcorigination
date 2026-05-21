/*
  # Schedule the daily servicing debit run via pg_cron + pg_net

  Calls the servicing-debit-run edge function at 06:00 UTC every day.
  The edge function reads PLAID_TRANSFER_MODE: in 'sandbox' mode it makes
  Plaid sandbox calls only; in 'production' it makes real ACH debits. Set
  PLAID_TRANSFER_MODE on the edge function env to flip from test to live.

  Mirrors the pg_net pattern from migration 077/079.
*/

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Remove any prior schedule with the same name (idempotent re-runs)
do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'servicing-debit-daily';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

select cron.schedule(
  'servicing-debit-daily',
  '0 6 * * *',
  $$
    select net.http_post(
      'https://nfhvzwzvpielutidqkqp.supabase.co/functions/v1/servicing-debit-run',
      jsonb_build_object('mode', 'cron'),
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb,
      120000
    );
  $$
);

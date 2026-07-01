/*
  # Abandoned-application follow-up email — hourly

  Borrowers who start an application but never finish verification (no Plaid
  report, never prequalified/submitted) silently stall. This cron calls the
  abandoned-followup edge function hourly; it emails each borrower created
  24-72h ago exactly once (stamped via borrowers.followup_sent_at) nudging
  them to connect a bank account or upload statements.

  Matches the security model of the existing servicing crons: the function is
  invoked without a user JWT; it takes no input and returns only counts.
*/

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS followup_sent_at timestamptz;

do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'abandoned-application-followup';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

select cron.schedule(
  'abandoned-application-followup',
  '15 * * * *',
  $$
    select net.http_post(
      'https://nfhvzwzvpielutidqkqp.supabase.co/functions/v1/abandoned-followup',
      '{}'::jsonb,
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb,
      120000
    );
  $$
);

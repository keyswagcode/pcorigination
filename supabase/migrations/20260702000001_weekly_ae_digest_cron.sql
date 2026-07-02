/*
  # Weekly AE digest email — Mondays 14:00 UTC

  Account executives (user_accounts.user_role in 'broker'/'admin') get one
  email per week summarizing their book: new borrowers from the last 7 days,
  borrowers awaiting review, and pre-approved borrowers that never got a loan
  scenario (stale hot leads). The weekly-ae-digest edge function skips AEs
  with nothing to report, so quiet weeks generate no email noise.

  Matches the security model of the existing internal crons: the function is
  invoked without a user JWT; it takes no input and returns only counts.
*/

do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'weekly-ae-digest';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

select cron.schedule(
  'weekly-ae-digest',
  '0 14 * * 1',
  $$
    select net.http_post(
      'https://nfhvzwzvpielutidqkqp.supabase.co/functions/v1/weekly-ae-digest',
      '{}'::jsonb,
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb,
      120000
    );
  $$
);

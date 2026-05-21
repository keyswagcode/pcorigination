/*
  # Nightly delinquency sweep — late fee + status flip

  Runs at 03:00 UTC daily. Finds all 'scheduled' rows whose due_date + grace
  period has lapsed without a posted payment, flips them to 'late', adds
  the loan's late_fee_amount to that row's scheduled_total, marks the loan
  servicing_status='delinquent'. Idempotent.
*/

do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'servicing-delinquency-sweep-daily';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

select cron.schedule(
  'servicing-delinquency-sweep-daily',
  '0 3 * * *',
  $$
    select net.http_post(
      'https://nfhvzwzvpielutidqkqp.supabase.co/functions/v1/servicing-delinquency-sweep',
      '{}'::jsonb,
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb,
      60000
    );
  $$
);

/*
  # Fix trigger function to use correct net.http_post signature

  ## Summary
  Updates the trigger function to use the correct pg_net http_post signature:
  (url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)

  ## Changes
  1. Replace trigger function with correct argument types
*/

create or replace function trigger_process_documents()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    'https://belccdwxqhghyzraqsel.supabase.co/functions/v1/process-documents',
    json_build_object('submission_id', NEW.intake_submission_id)::jsonb,
    '{}'::jsonb,
    '{"Content-Type": "application/json"}'::jsonb,
    5000
  );
  return NEW;
exception when others then
  return NEW;
end;
$$;

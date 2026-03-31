/*
  # Fix document processing trigger to use pg_net correctly

  ## Summary
  Replaces the previous trigger function with a correct pg_net-based implementation
  that uses net.http_post to asynchronously call the process-documents edge function
  when a document is inserted.

  ## Changes
  1. Drop the old trigger and function
  2. Create a new trigger function using net.http_post (pg_net)
  3. Hardcode the Supabase project URL for reliability
  4. Re-attach the trigger to uploaded_documents
*/

drop trigger if exists on_document_uploaded on uploaded_documents;
drop function if exists trigger_process_documents();

create or replace function trigger_process_documents()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://belccdwxqhghyzraqsel.supabase.co/functions/v1/process-documents',
    body := json_build_object('submission_id', NEW.intake_submission_id)::text,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return NEW;
exception when others then
  return NEW;
end;
$$;

create trigger on_document_uploaded
  after insert on uploaded_documents
  for each row
  when (NEW.processing_status = 'pending')
  execute function trigger_process_documents();

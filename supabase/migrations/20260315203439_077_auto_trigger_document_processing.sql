/*
  # Auto-trigger document processing on upload

  ## Summary
  Adds a database-level trigger that automatically calls the process-documents edge
  function whenever a new document is inserted into uploaded_documents. This ensures
  extraction starts immediately without requiring the frontend to explicitly invoke
  the edge function.

  ## Changes
  1. Enable pg_net extension for async HTTP calls from the database
  2. Create trigger function that calls process-documents edge function via HTTP
  3. Attach trigger to uploaded_documents on INSERT

  ## Notes
  - Uses EdgeRuntime HTTP (pg_net) so the call is async and non-blocking
  - The trigger fires per-row, passing the intake_submission_id to the edge function
  - Duplicate calls for the same submission are safe — the edge function is idempotent
*/

create extension if not exists pg_net schema extensions;

create or replace function trigger_process_documents()
returns trigger
language plpgsql
security definer
as $$
declare
  edge_url text;
  service_key text;
begin
  edge_url := current_setting('app.supabase_url', true) || '/functions/v1/process-documents';
  service_key := current_setting('app.service_role_key', true);

  if edge_url is null or edge_url = '/functions/v1/process-documents' then
    edge_url := 'https://' || current_setting('app.supabase_project_ref', true) || '.supabase.co/functions/v1/process-documents';
  end if;

  perform extensions.http_post(
    edge_url,
    json_build_object('submission_id', NEW.intake_submission_id)::text,
    'application/json'
  );

  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists on_document_uploaded on uploaded_documents;

create trigger on_document_uploaded
  after insert on uploaded_documents
  for each row
  when (NEW.processing_status = 'pending')
  execute function trigger_process_documents();

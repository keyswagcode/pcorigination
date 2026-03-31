/*
  # Disable Automatic Document Processing

  1. Changes
    - Drops the trigger that automatically calls the process-documents edge function
    - Documents will now only be processed when user clicks "Process" button

  2. Rationale
    - User requested manual control over document processing
    - Prevents unwanted API calls on upload
*/

DROP TRIGGER IF EXISTS on_document_uploaded ON uploaded_documents;
DROP FUNCTION IF EXISTS trigger_process_documents();

/*
  # Add ID Document Upload Fields to Borrowers Table

  ## Summary
  Adds fields to track uploaded ID document files for borrowers.
  - Local residents can upload driver's license or passport
  - Foreign nationals must upload passport

  ## New Columns on `borrowers`
  - `id_document_file_path` (text) — Storage path to the uploaded ID document
  - `id_document_file_name` (text) — Original filename of the uploaded document
  - `id_document_uploaded_at` (timestamptz) — When the ID document was uploaded

  ## Notes
  - Foreign nationals (foreign_national = true) must upload a passport
  - Local residents can choose between driver's license or passport
  - The actual file is stored in Supabase Storage
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_file_path'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_file_path text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_file_name'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_file_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_uploaded_at'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_uploaded_at timestamptz;
  END IF;
END $$;

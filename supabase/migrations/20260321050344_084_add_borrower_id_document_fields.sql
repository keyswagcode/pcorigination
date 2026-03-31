/*
  # Add ID Document Fields to Borrowers Table

  ## Summary
  Adds identification document fields to the borrowers table to support compliance requirements.
  Borrowers must provide either a driver's license (for local residents) or a passport 
  (for foreign nationals or as an alternative for local residents).

  ## New Columns on `borrowers`
  - `id_document_type` (text) — Type of ID: 'drivers_license' or 'passport'
  - `id_document_number` (text) — ID number (masked for security, e.g., last 4 digits stored)
  - `id_document_state` (text) — Issuing state for driver's license (null for passports)
  - `id_document_country` (text) — Issuing country (defaults to 'US' for driver's license)
  - `id_document_expiration` (date) — Expiration date of the ID document
  - `id_document_verified` (boolean) — Whether the ID has been verified (defaults to false)

  ## Notes
  - Foreign nationals should use 'passport' type
  - Driver's license requires state of issuance
  - Expiration date is tracked to ensure ID validity
  - All fields are nullable to support gradual data collection
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_type'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_number'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_state'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_state text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_country'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_country text DEFAULT 'US';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_expiration'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_expiration date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'id_document_verified'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN id_document_verified boolean DEFAULT false;
  END IF;
END $$;

/*
  # needs_review flag for low-confidence statement extractions

  When OpenAI can't actually read a statement, process-documents still inserts
  a row (Unknown Bank / $0 / confidence ~0.1) and marked the document
  "completed" — indistinguishable in the broker queue from a genuinely
  verified $0 balance. This adds an explicit needs_review flag the broker
  dashboard can surface as "unreadable — needs human review."
*/

ALTER TABLE bank_statement_accounts ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

-- Backfill: existing rows that look like failed extractions.
UPDATE bank_statement_accounts
SET needs_review = true
WHERE needs_review IS DISTINCT FROM true
  AND (
    extraction_confidence < 0.5
    OR bank_name IS NULL
    OR bank_name ILIKE '%unknown%'
    OR COALESCE(closing_balance, 0) = 0
  );

NOTIFY pgrst, 'reload schema';

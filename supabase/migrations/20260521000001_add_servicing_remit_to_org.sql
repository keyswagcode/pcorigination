/*
  # Add public-facing servicing remit-to info to organizations

  These fields appear on payoff statements + (P2) periodic statements +
  welcome letters. We store only public-safe text — never raw bank account
  numbers. The actual ACH receive account lives in Plaid Transfer's
  account configuration; the org-level info here is purely for borrower-
  and title-company-facing documents.
*/

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS servicing_remit_to_name TEXT,
  ADD COLUMN IF NOT EXISTS servicing_remit_to_address TEXT,    -- multi-line, free-form
  ADD COLUMN IF NOT EXISTS servicing_wire_instructions TEXT,   -- public-safe ("ABA: 121000248 / Account ending 1234" etc.)
  ADD COLUMN IF NOT EXISTS servicing_phone TEXT,
  ADD COLUMN IF NOT EXISTS servicing_email TEXT,
  ADD COLUMN IF NOT EXISTS servicing_business_hours TEXT;

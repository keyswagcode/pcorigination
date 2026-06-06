/*
  # Add commercial intake to loan_scenarios

  Commercial loans use a much richer intake than residential. We store the full
  Commercial Project Intake & Loan Request Form as a single JSONB blob on the
  loan scenario; the obvious fields (loan amount, property address, type) are
  also mapped to the existing typed columns for list/search views.

    - commercial_intake (jsonb) - full commercial intake form payload
*/

ALTER TABLE loan_scenarios
  ADD COLUMN IF NOT EXISTS commercial_intake jsonb;

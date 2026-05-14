-- Borrower self-reported marital status. URLA / 1003 collects this; we store
-- it on the borrowers table and surface it as a dropdown on the borrower
-- profile form. MISMO maps Single/Divorced/Widowed → Unmarried, Married →
-- Married. Null is treated as "Not Disclosed" downstream.
ALTER TABLE borrowers
  ADD COLUMN IF NOT EXISTS marital_status TEXT
    CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed'));

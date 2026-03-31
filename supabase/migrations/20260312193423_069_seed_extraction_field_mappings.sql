/*
  # Seed Extraction Field Mappings

  This migration seeds the field mapping table with common variations
  of field names found in bank statements and other financial documents.

  ## Purpose
  Maps raw extracted field names (which vary by bank and OCR quality)
  to normalized field names for consistent dashboard display.

  ## Examples
  - "Beginning Balance", "Starting Balance", "Balance Forward" → beginning_balance
  - "Ending Balance", "Closing Balance", "Final Balance" → ending_balance
*/

-- Bank Statement Balance Field Mappings
INSERT INTO extraction_field_mappings (document_type, raw_field_name, normalized_field_name, transformation_rule, priority)
VALUES
  -- Beginning Balance variations
  ('bank_statement', 'Beginning Balance', 'beginning_balance', 'parse_currency', 10),
  ('bank_statement', 'beginning balance', 'beginning_balance', 'parse_currency', 9),
  ('bank_statement', 'Starting Balance', 'beginning_balance', 'parse_currency', 8),
  ('bank_statement', 'starting balance', 'beginning_balance', 'parse_currency', 7),
  ('bank_statement', 'Balance Forward', 'beginning_balance', 'parse_currency', 6),
  ('bank_statement', 'balance forward', 'beginning_balance', 'parse_currency', 5),
  ('bank_statement', 'Opening Balance', 'beginning_balance', 'parse_currency', 4),
  ('bank_statement', 'opening balance', 'beginning_balance', 'parse_currency', 3),
  ('bank_statement', 'Previous Balance', 'beginning_balance', 'parse_currency', 2),
  ('bank_statement', 'previous balance', 'beginning_balance', 'parse_currency', 1),
  ('bank_statement', 'Begin Bal', 'beginning_balance', 'parse_currency', 1),
  ('bank_statement', 'Beg Balance', 'beginning_balance', 'parse_currency', 1),
  
  -- Ending Balance variations
  ('bank_statement', 'Ending Balance', 'ending_balance', 'parse_currency', 10),
  ('bank_statement', 'ending balance', 'ending_balance', 'parse_currency', 9),
  ('bank_statement', 'Closing Balance', 'ending_balance', 'parse_currency', 8),
  ('bank_statement', 'closing balance', 'ending_balance', 'parse_currency', 7),
  ('bank_statement', 'Final Balance', 'ending_balance', 'parse_currency', 6),
  ('bank_statement', 'final balance', 'ending_balance', 'parse_currency', 5),
  ('bank_statement', 'Current Balance', 'ending_balance', 'parse_currency', 4),
  ('bank_statement', 'current balance', 'ending_balance', 'parse_currency', 3),
  ('bank_statement', 'Balance', 'ending_balance', 'parse_currency', 1),
  ('bank_statement', 'End Bal', 'ending_balance', 'parse_currency', 1),
  ('bank_statement', 'New Balance', 'ending_balance', 'parse_currency', 2),
  
  -- Total Deposits variations
  ('bank_statement', 'Total Deposits', 'total_deposits', 'parse_currency', 10),
  ('bank_statement', 'total deposits', 'total_deposits', 'parse_currency', 9),
  ('bank_statement', 'Deposits', 'total_deposits', 'parse_currency', 5),
  ('bank_statement', 'deposits', 'total_deposits', 'parse_currency', 4),
  ('bank_statement', 'Total Credits', 'total_deposits', 'parse_currency', 8),
  ('bank_statement', 'total credits', 'total_deposits', 'parse_currency', 7),
  ('bank_statement', 'Credits', 'total_deposits', 'parse_currency', 3),
  ('bank_statement', 'Additions', 'total_deposits', 'parse_currency', 2),
  ('bank_statement', 'Money In', 'total_deposits', 'parse_currency', 2),
  ('bank_statement', 'Deposit Total', 'total_deposits', 'parse_currency', 6),
  
  -- Total Withdrawals variations
  ('bank_statement', 'Total Withdrawals', 'total_withdrawals', 'parse_currency', 10),
  ('bank_statement', 'total withdrawals', 'total_withdrawals', 'parse_currency', 9),
  ('bank_statement', 'Withdrawals', 'total_withdrawals', 'parse_currency', 5),
  ('bank_statement', 'withdrawals', 'total_withdrawals', 'parse_currency', 4),
  ('bank_statement', 'Total Debits', 'total_withdrawals', 'parse_currency', 8),
  ('bank_statement', 'total debits', 'total_withdrawals', 'parse_currency', 7),
  ('bank_statement', 'Debits', 'total_withdrawals', 'parse_currency', 3),
  ('bank_statement', 'Subtractions', 'total_withdrawals', 'parse_currency', 2),
  ('bank_statement', 'Money Out', 'total_withdrawals', 'parse_currency', 2),
  ('bank_statement', 'Withdrawal Total', 'total_withdrawals', 'parse_currency', 6),
  ('bank_statement', 'Checks & Debits', 'total_withdrawals', 'parse_currency', 4),
  
  -- Average Daily Balance variations
  ('bank_statement', 'Average Daily Balance', 'average_daily_balance', 'parse_currency', 10),
  ('bank_statement', 'average daily balance', 'average_daily_balance', 'parse_currency', 9),
  ('bank_statement', 'Avg Daily Balance', 'average_daily_balance', 'parse_currency', 8),
  ('bank_statement', 'Average Balance', 'average_daily_balance', 'parse_currency', 6),
  ('bank_statement', 'Avg Balance', 'average_daily_balance', 'parse_currency', 5),
  ('bank_statement', 'Daily Average', 'average_daily_balance', 'parse_currency', 4),
  ('bank_statement', 'ADB', 'average_daily_balance', 'parse_currency', 3),
  
  -- Account Number variations
  ('bank_statement', 'Account Number', 'account_number_last4', 'extract_last4', 10),
  ('bank_statement', 'account number', 'account_number_last4', 'extract_last4', 9),
  ('bank_statement', 'Acct Number', 'account_number_last4', 'extract_last4', 8),
  ('bank_statement', 'Account #', 'account_number_last4', 'extract_last4', 7),
  ('bank_statement', 'Acct #', 'account_number_last4', 'extract_last4', 6),
  ('bank_statement', 'Account No', 'account_number_last4', 'extract_last4', 5),
  ('bank_statement', 'Account No.', 'account_number_last4', 'extract_last4', 4),
  
  -- NSF/Overdraft variations
  ('bank_statement', 'NSF Fees', 'nsf_count', 'count_occurrences', 10),
  ('bank_statement', 'NSF', 'nsf_count', 'count_occurrences', 8),
  ('bank_statement', 'Non-Sufficient Funds', 'nsf_count', 'count_occurrences', 9),
  ('bank_statement', 'Insufficient Funds', 'nsf_count', 'count_occurrences', 7),
  ('bank_statement', 'Returned Item', 'nsf_count', 'count_occurrences', 6),
  ('bank_statement', 'Overdraft', 'overdraft_count', 'count_occurrences', 10),
  ('bank_statement', 'overdraft', 'overdraft_count', 'count_occurrences', 9),
  ('bank_statement', 'OD Fee', 'overdraft_count', 'count_occurrences', 8),
  ('bank_statement', 'Overdraft Fee', 'overdraft_count', 'count_occurrences', 7),
  ('bank_statement', 'Overdraft Protection', 'overdraft_count', 'count_occurrences', 5),
  
  -- Statement Period variations
  ('bank_statement', 'Statement Period', 'statement_period', 'parse_date_range', 10),
  ('bank_statement', 'statement period', 'statement_period', 'parse_date_range', 9),
  ('bank_statement', 'Period', 'statement_period', 'parse_date_range', 5),
  ('bank_statement', 'Statement Date', 'statement_end_date', 'parse_date', 8),
  ('bank_statement', 'Statement Ending', 'statement_end_date', 'parse_date', 7),
  ('bank_statement', 'Through', 'statement_end_date', 'parse_date', 4),
  ('bank_statement', 'From', 'statement_start_date', 'parse_date', 4),
  
  -- Bank/Institution Name variations
  ('bank_statement', 'Bank Name', 'institution_name', 'clean_text', 10),
  ('bank_statement', 'Financial Institution', 'institution_name', 'clean_text', 9),
  ('bank_statement', 'Bank of America', 'institution_name', 'literal:Bank of America', 8),
  ('bank_statement', 'Chase', 'institution_name', 'literal:Chase', 8),
  ('bank_statement', 'Wells Fargo', 'institution_name', 'literal:Wells Fargo', 8),
  ('bank_statement', 'Citibank', 'institution_name', 'literal:Citibank', 8),
  ('bank_statement', 'US Bank', 'institution_name', 'literal:US Bank', 8),
  ('bank_statement', 'PNC', 'institution_name', 'literal:PNC Bank', 8),
  ('bank_statement', 'Capital One', 'institution_name', 'literal:Capital One', 8),
  ('bank_statement', 'TD Bank', 'institution_name', 'literal:TD Bank', 8)
ON CONFLICT (document_type, raw_field_name) DO NOTHING;

-- W2 Field Mappings
INSERT INTO extraction_field_mappings (document_type, raw_field_name, normalized_field_name, transformation_rule, priority)
VALUES
  ('w2', 'Wages, tips, other compensation', 'gross_wages', 'parse_currency', 10),
  ('w2', 'Box 1', 'gross_wages', 'parse_currency', 8),
  ('w2', 'Federal income tax withheld', 'federal_tax_withheld', 'parse_currency', 10),
  ('w2', 'Box 2', 'federal_tax_withheld', 'parse_currency', 8),
  ('w2', 'Social security wages', 'social_security_wages', 'parse_currency', 10),
  ('w2', 'Box 3', 'social_security_wages', 'parse_currency', 8),
  ('w2', 'Social security tax withheld', 'social_security_tax', 'parse_currency', 10),
  ('w2', 'Box 4', 'social_security_tax', 'parse_currency', 8),
  ('w2', 'Medicare wages and tips', 'medicare_wages', 'parse_currency', 10),
  ('w2', 'Box 5', 'medicare_wages', 'parse_currency', 8),
  ('w2', 'Medicare tax withheld', 'medicare_tax', 'parse_currency', 10),
  ('w2', 'Box 6', 'medicare_tax', 'parse_currency', 8),
  ('w2', 'Employer name', 'employer_name', 'clean_text', 10),
  ('w2', 'Employee name', 'employee_name', 'clean_text', 10),
  ('w2', 'Employee SSN', 'employee_ssn_last4', 'extract_last4', 10),
  ('w2', 'Tax Year', 'tax_year', 'parse_year', 10)
ON CONFLICT (document_type, raw_field_name) DO NOTHING;

-- Pay Stub Field Mappings
INSERT INTO extraction_field_mappings (document_type, raw_field_name, normalized_field_name, transformation_rule, priority)
VALUES
  ('pay_stub', 'Gross Pay', 'gross_pay', 'parse_currency', 10),
  ('pay_stub', 'gross pay', 'gross_pay', 'parse_currency', 9),
  ('pay_stub', 'Gross Earnings', 'gross_pay', 'parse_currency', 8),
  ('pay_stub', 'Total Earnings', 'gross_pay', 'parse_currency', 7),
  ('pay_stub', 'Net Pay', 'net_pay', 'parse_currency', 10),
  ('pay_stub', 'net pay', 'net_pay', 'parse_currency', 9),
  ('pay_stub', 'Take Home', 'net_pay', 'parse_currency', 8),
  ('pay_stub', 'Total Deductions', 'total_deductions', 'parse_currency', 10),
  ('pay_stub', 'Deductions', 'total_deductions', 'parse_currency', 8),
  ('pay_stub', 'YTD Gross', 'ytd_gross', 'parse_currency', 10),
  ('pay_stub', 'YTD Net', 'ytd_net', 'parse_currency', 10),
  ('pay_stub', 'Pay Period', 'pay_period', 'parse_date_range', 10),
  ('pay_stub', 'Pay Date', 'pay_date', 'parse_date', 10),
  ('pay_stub', 'Employer', 'employer_name', 'clean_text', 10),
  ('pay_stub', 'Employee', 'employee_name', 'clean_text', 10),
  ('pay_stub', 'Hours Worked', 'hours_worked', 'parse_number', 10),
  ('pay_stub', 'Regular Hours', 'regular_hours', 'parse_number', 10),
  ('pay_stub', 'Overtime Hours', 'overtime_hours', 'parse_number', 10),
  ('pay_stub', 'Hourly Rate', 'hourly_rate', 'parse_currency', 10)
ON CONFLICT (document_type, raw_field_name) DO NOTHING;

-- Tax Return Field Mappings (1040)
INSERT INTO extraction_field_mappings (document_type, raw_field_name, normalized_field_name, transformation_rule, priority)
VALUES
  ('tax_return', 'Total Income', 'total_income', 'parse_currency', 10),
  ('tax_return', 'Adjusted Gross Income', 'agi', 'parse_currency', 10),
  ('tax_return', 'AGI', 'agi', 'parse_currency', 8),
  ('tax_return', 'Taxable Income', 'taxable_income', 'parse_currency', 10),
  ('tax_return', 'Total Tax', 'total_tax', 'parse_currency', 10),
  ('tax_return', 'Tax Year', 'tax_year', 'parse_year', 10),
  ('tax_return', 'Filing Status', 'filing_status', 'clean_text', 10),
  ('tax_return', 'Wages, salaries, tips', 'w2_income', 'parse_currency', 10),
  ('tax_return', 'Business Income', 'business_income', 'parse_currency', 10),
  ('tax_return', 'Schedule C', 'schedule_c_income', 'parse_currency', 8),
  ('tax_return', 'Rental Income', 'rental_income', 'parse_currency', 10),
  ('tax_return', 'Schedule E', 'schedule_e_income', 'parse_currency', 8)
ON CONFLICT (document_type, raw_field_name) DO NOTHING;

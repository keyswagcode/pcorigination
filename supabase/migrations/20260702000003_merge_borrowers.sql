/*
  # fn_merge_borrowers — combine duplicate borrower records

  Same person signing up twice creates split records (loans on one, documents
  on the other). This staff-only function merges p_merge INTO p_keep:
  repoints every child table, fills the keeper's missing scalar fields from
  the duplicate, resolves pre-approval unique-key conflicts (keeper wins),
  logs the merge, and deletes the duplicate row.
*/

CREATE OR REPLACE FUNCTION fn_merge_borrowers(p_keep uuid, p_merge uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_moved jsonb := '{}'::jsonb;
  v_count int;
BEGIN
  -- Staff or service role only.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_accounts WHERE id = auth.uid() AND user_role IN ('admin', 'reviewer')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_keep = p_merge THEN RAISE EXCEPTION 'keep and merge are the same row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM borrowers WHERE id = p_keep) THEN RAISE EXCEPTION 'keep row not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM borrowers WHERE id = p_merge) THEN RAISE EXCEPTION 'merge row not found'; END IF;

  -- Pre-approvals: keeper's row wins on (borrower_id, loan_type) conflicts.
  DELETE FROM pre_approvals m
  WHERE m.borrower_id = p_merge
    AND EXISTS (SELECT 1 FROM pre_approvals k WHERE k.borrower_id = p_keep AND k.loan_type = m.loan_type);
  UPDATE pre_approvals SET borrower_id = p_keep WHERE borrower_id = p_merge;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_moved := v_moved || jsonb_build_object('pre_approvals', v_count);

  -- Financial profile: unique per borrower — keeper's wins if both exist.
  IF EXISTS (SELECT 1 FROM borrower_financial_profiles WHERE borrower_id = p_keep) THEN
    DELETE FROM borrower_financial_profiles WHERE borrower_id = p_merge;
  ELSE
    UPDATE borrower_financial_profiles SET borrower_id = p_keep WHERE borrower_id = p_merge;
  END IF;

  UPDATE loan_scenarios SET borrower_id = p_keep WHERE borrower_id = p_merge;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_moved := v_moved || jsonb_build_object('loan_scenarios', v_count);
  UPDATE uploaded_documents SET borrower_id = p_keep WHERE borrower_id = p_merge;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_moved := v_moved || jsonb_build_object('uploaded_documents', v_count);
  UPDATE intake_submissions SET borrower_id = p_keep WHERE borrower_id = p_merge;
  UPDATE bank_statement_accounts SET borrower_id = p_keep WHERE borrower_id = p_merge;
  UPDATE borrower_notes SET borrower_id = p_keep WHERE borrower_id = p_merge;
  UPDATE borrower_activity_log SET borrower_id = p_keep WHERE borrower_id = p_merge;
  UPDATE co_borrowers SET borrower_id = p_keep WHERE borrower_id = p_merge;
  UPDATE borrower_previous_addresses SET borrower_id = p_keep WHERE borrower_id = p_merge;

  -- Fill the keeper's missing fields from the duplicate.
  UPDATE borrowers k SET
    phone            = COALESCE(k.phone, m.phone),
    date_of_birth    = COALESCE(k.date_of_birth, m.date_of_birth),
    ssn_last4        = COALESCE(k.ssn_last4, m.ssn_last4),
    ssn_encrypted    = COALESCE(k.ssn_encrypted, m.ssn_encrypted),
    credit_score     = COALESCE(k.credit_score, m.credit_score),
    address_street   = COALESCE(k.address_street, m.address_street),
    address_city     = COALESCE(k.address_city, m.address_city),
    address_state    = COALESCE(k.address_state, m.address_state),
    address_zip      = COALESCE(k.address_zip, m.address_zip),
    broker_id        = COALESCE(k.broker_id, m.broker_id),
    plaid_user_id    = COALESCE(k.plaid_user_id, m.plaid_user_id),
    preferred_loan_type = COALESCE(k.preferred_loan_type, m.preferred_loan_type)
  FROM borrowers m
  WHERE k.id = p_keep AND m.id = p_merge;

  INSERT INTO borrower_activity_log (borrower_id, event_type, title, details)
  VALUES (p_keep, 'merge', 'Duplicate record merged',
          format('Merged duplicate borrower %s into this record. Moved: %s', p_merge, v_moved::text));

  DELETE FROM borrowers WHERE id = p_merge;

  RETURN jsonb_build_object('merged', p_merge, 'into', p_keep, 'moved', v_moved);
END $$;

GRANT EXECUTE ON FUNCTION fn_merge_borrowers(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

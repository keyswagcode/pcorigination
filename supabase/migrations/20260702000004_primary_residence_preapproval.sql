/*
  # Primary Residence pre-approval from income + debts (DTI-based)

  Once a borrower has verified monthly income (Plaid/statements) AND monthly
  debt (credit pull or an uploaded credit report), we can DTI-qualify them for
  a primary-residence purchase. One shared function computes and upserts the
  pre-approval so every path (automated credit pull, uploaded report, Plaid
  income landing later) produces identical results.

  Assumptions (documented in the row's summary; adjust here to change policy):
    - Max back-end DTI: 45%
    - Qualifying payment = 45% x monthly income - monthly debts
    - Max loan sized at 7.5% / 30-year P&I (factor 0.0069921 per $1)
*/

CREATE OR REPLACE FUNCTION fn_upsert_primary_preapproval(p_borrower_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_income numeric;
  v_debt numeric;
  v_dti numeric;
  v_capacity numeric;
  v_max_loan numeric;
BEGIN
  SELECT monthly_income, monthly_debt INTO v_income, v_debt
  FROM borrower_financial_profiles WHERE borrower_id = p_borrower_id;

  IF v_income IS NULL OR v_income <= 0 OR v_debt IS NULL THEN
    RETURN jsonb_build_object('created', false, 'reason', 'need both monthly income and monthly debt');
  END IF;

  v_dti := round((v_debt / v_income) * 100, 1);
  v_capacity := (v_income * 0.45) - v_debt;

  IF v_capacity <= 0 OR v_dti > 45 THEN
    RETURN jsonb_build_object('created', false, 'reason', 'DTI exceeds 45%', 'dti', v_dti);
  END IF;

  v_max_loan := round(v_capacity / 0.0069921, -3); -- 7.5%/30yr P&I, nearest $1k

  INSERT INTO pre_approvals (
    borrower_id, loan_type, status, sub_status, prequalified_amount,
    qualification_max, passes_liquidity_check, summary, machine_decision, machine_confidence
  ) VALUES (
    p_borrower_id, 'primary_residence', 'approved', 'pre_approved', v_max_loan,
    v_max_loan, true,
    format('Primary Residence Pre-Approval: up to $%s based on $%s/mo income and $%s/mo debts (DTI %s%%; assumes 45%% max DTI, 7.5%%/30yr P&I)',
           to_char(v_max_loan, 'FM999,999,999'), to_char(round(v_income), 'FM999,999,999'),
           to_char(round(v_debt), 'FM999,999,999'), v_dti),
    'approved', 90
  )
  ON CONFLICT (borrower_id, loan_type) DO UPDATE SET
    prequalified_amount = EXCLUDED.prequalified_amount,
    qualification_max = EXCLUDED.qualification_max,
    summary = EXCLUDED.summary,
    status = EXCLUDED.status,
    sub_status = EXCLUDED.sub_status,
    updated_at = now();

  RETURN jsonb_build_object('created', true, 'dti', v_dti, 'max_loan', v_max_loan);
END $$;

GRANT EXECUTE ON FUNCTION fn_upsert_primary_preapproval(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

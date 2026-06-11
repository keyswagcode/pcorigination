# Schema Audit — 2026-06-11

Partial audit via the live PostgREST API (a full pg_dump baseline needs Docker or the DB password, neither available in-session). Produced by fn_schema_audit() + the OpenAPI definitions.

## RLS coverage

All 37 public tables have RLS **enabled** and at least one policy. No table is wide-open (RLS off) and none is accidentally locked out (RLS on, zero policies).

## Migration drift — foundational tables undocumented in git

These 17 tables exist in production but have **no CREATE TABLE in any committed migration** — they predate this repo (migration history starts at #068; the original Bolt-era schema was never captured). This is the root cause of the "migrations lie" incidents (missing columns/tables). A full pg_dump baseline migration should be created when Docker/DB access is available. Live column inventory below for reference.

### audit_trail  ·  RLS=True, policies=2, 12 columns
- id (uuid), borrower_id (uuid), loan_scenario_id (uuid), user_id (uuid), action (text), entity_type (text), entity_id (uuid), field_name (text), old_value (text), new_value (text), metadata (jsonb), created_at (timestamp with time zone)

### borrower_activity_log  ·  RLS=True, policies=1, 8 columns
- id (uuid), borrower_id (uuid), user_id (uuid), event_type (text), title (text), details (text), metadata (jsonb), created_at (timestamp with time zone)

### borrower_notes  ·  RLS=True, policies=1, 6 columns
- id (uuid), borrower_id (uuid), user_id (uuid), content (text), created_at (timestamp with time zone), updated_at (timestamp with time zone)

### borrowers  ·  RLS=True, policies=14, 58 columns
- id (uuid), user_id (uuid), organization_id (uuid), borrower_name (text), email (text), phone (text), entity_type (text), credit_score (integer), state_of_residence (text), real_estate_experience_years (integer), properties_owned_count (integer), portfolio_value (numeric), borrower_status (text), lifecycle_stage (text), preferred_loan_type (text), id_document_type (text), id_document_number (text), id_document_state (text), id_document_country (text), id_document_expiration (text), id_document_verified (boolean), id_document_file_path (text), id_document_file_name (text), id_document_uploaded_at (timestamp with time zone), created_at (timestamp with time zone), updated_at (timestamp with time zone), broker_id (uuid), date_of_birth (date), ssn_last4 (text), ssn_encrypted (text), address_street (text), address_city (text), address_state (text), address_zip (text), llc_name (text), credit_consent (boolean), credit_consent_at (timestamp with time zone), plaid_user_id (text), plaid_report_status (text), marital_status (text), address_years_at (integer), address_months_at (integer), housing_type (text), monthly_housing_expense (numeric), declarations (jsonb), demographic_info (jsonb), military_service (jsonb), urla_details_completed_at (timestamp with time zone), employment (jsonb), other_income (jsonb), assets (jsonb), liabilities (jsonb), real_estate_owned (jsonb), dscr (numeric), seasoning_months (integer), short_term_rental (boolean), foreign_national (boolean), first_time_investor (boolean)

### broker_reporting  ·  RLS=True, policies=2, 4 columns
- id (uuid), vp_user_id (uuid), ae_user_id (uuid), created_at (timestamp with time zone)

### co_borrowers  ·  RLS=True, policies=11, 19 columns
- id (uuid), borrower_id (uuid), invited_user_id (uuid), borrower_name (text), email (text), phone (text), date_of_birth (date), ssn_last4 (text), ssn_encrypted (text), credit_score (integer), address_street (text), address_city (text), address_state (text), address_zip (text), status (text), invite_token (text), filled_by_self (boolean), created_at (timestamp with time zone), updated_at (timestamp with time zone)

### intake_submissions  ·  RLS=True, policies=7, 9 columns
- id (uuid), user_id (uuid), organization_id (uuid), borrower_id (uuid), status (text), processing_stage (text), submitted_at (timestamp with time zone), created_at (timestamp with time zone), updated_at (timestamp with time zone)

### lender_programs  ·  RLS=True, policies=1, 7 columns
- id (uuid), lender_name (text), program_name (text), rules (jsonb), is_active (boolean), created_at (timestamp with time zone), updated_at (timestamp with time zone)

### loan_requests  ·  RLS=True, policies=3, 9 columns
- id (uuid), intake_submission_id (uuid), requested_amount (numeric), loan_purpose (text), estimated_purchase_price (numeric), down_payment_amount (numeric), down_payment_source (text), created_at (timestamp with time zone), updated_at (timestamp with time zone)

### loan_tasks  ·  RLS=True, policies=2, 12 columns
- id (uuid), loan_scenario_id (uuid), borrower_id (uuid), title (text), description (text), status (text), assigned_to (uuid), due_date (date), completed_at (timestamp with time zone), completed_by (uuid), sort_order (integer), created_at (timestamp with time zone)

### notifications  ·  RLS=True, policies=2, 13 columns
- id (uuid), user_id (uuid), organization_id (uuid), event_type (text), title (text), message (text), data (jsonb), is_read (boolean), read_at (timestamp with time zone), channel (text), priority (text), action_url (text), created_at (timestamp with time zone)

### organization_members  ·  RLS=True, policies=2, 12 columns
- id (uuid), user_id (uuid), organization_id (uuid), role (text), display_name (text), email (text), is_active (boolean), created_at (timestamp with time zone), updated_at (timestamp with time zone), invite_status (text), notify_new_apps (boolean), invited_by_user_id (uuid)

### organizations  ·  RLS=True, policies=3, 13 columns
- id (uuid), name (text), slug (text), created_at (timestamp with time zone), updated_at (timestamp with time zone), logo_url (text), zapier_webhook_url (text), servicing_remit_to_name (text), servicing_remit_to_address (text), servicing_wire_instructions (text), servicing_phone (text), servicing_email (text), servicing_business_hours (text)

### pre_approvals  ·  RLS=True, policies=9, 26 columns
- id (uuid), intake_submission_id (uuid), borrower_id (uuid), status (text), requested_loan_amount (numeric), recommended_amount (numeric), qualification_min (numeric), qualification_max (numeric), verified_liquidity (numeric), required_liquidity (numeric), passes_liquidity_check (boolean), conditions (jsonb), machine_decision (text), machine_confidence (numeric), letter_number (text), created_at (timestamp with time zone), updated_at (timestamp with time zone), prequalified_amount (numeric), sub_status (text), prequalified_range_low (numeric), prequalified_range_high (numeric), estimated_rate_low (numeric), estimated_rate_high (numeric), confidence (text), summary (text), loan_type (text)

### properties  ·  RLS=True, policies=2, 14 columns
- id (uuid), intake_submission_id (uuid), address_street (text), address_city (text), address_state (text), address_zip (text), property_type (text), occupancy_type (text), number_of_units (integer), purchase_price (numeric), estimated_value (numeric), monthly_rent (numeric), created_at (timestamp with time zone), updated_at (timestamp with time zone)

### uploaded_documents  ·  RLS=True, policies=12, 17 columns
- id (uuid), intake_submission_id (uuid), borrower_id (uuid), document_type (text), document_subtype (text), file_name (text), file_path (text), mime_type (text), file_size (bigint), processing_status (text), extraction_status (text), extraction_confidence (numeric), is_processed (boolean), loan_scenario_id (uuid), created_at (timestamp with time zone), updated_at (timestamp with time zone), error_message (text)

### user_accounts  ·  RLS=True, policies=4, 24 columns
- id (uuid), email (text), first_name (text), last_name (text), user_role (text), is_active (boolean), created_at (timestamp with time zone), updated_at (timestamp with time zone), pos_slug (text), broker_role (text), phone (text), isc_username (text), isc_password_encrypted (text), valora_username (text), valora_password_encrypted (text), saved_card_last4 (text), saved_card_brand (text), saved_card_holder_name (text), saved_card_zip (text), saved_card_exp_month (text), saved_card_exp_year (text), saved_card_updated_at (timestamp with time zone), isc_session_state (jsonb), isc_session_captured_at (timestamp with time zone)

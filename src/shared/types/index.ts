export type ApplicationStatus =
  | 'draft'
  | 'in_progress'
  | 'submitted'
  | 'pending_review'
  | 'needs_revision'
  | 'preapproved'
  | 'declined'
  | 'placed'
  | 'funded';

export type BorrowerStatus =
  | 'draft'
  | 'submitted'
  | 'documents_processing'
  | 'prequalified'
  | 'under_review'
  | 'additional_docs_requested'
  | 'approved'
  | 'conditionally_approved'
  | 'declined';

export type LoanScenarioStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'matched'
  | 'conditionally_approved'
  | 'approved'
  | 'declined';

export type IdentityVerificationStatus =
  | 'not_uploaded'
  | 'pending_review'
  | 'verified'
  | 'rejected';

export type IdentityDocumentType = 'drivers_license' | 'passport' | 'government_id';

export type AnalystDecision = 'approved' | 'conditionally_approved' | 'declined' | 'additional_docs_requested';

export type UserRole = 'borrower' | 'broker' | 'reviewer' | 'admin';

export interface User {
  id: string;
  email: string;
  role?: UserRole;
}

export interface Organization {
  id: string;
  name: string;
  slug?: string;
}

export interface OrganizationMember {
  id: string;
  user_id: string;
  organization_id: string;
  role: string;
  display_name?: string;
  email?: string;
  is_active: boolean;
}

export type LifecycleStage =
  | 'profile_created'
  | 'loan_type_selected'
  | 'documents_uploaded'
  | 'liquidity_verified'
  | 'pre_approved'
  | 'application_started'
  | 'application_submitted';

export interface Borrower {
  id: string;
  borrower_name: string;
  email: string | null;
  phone: string | null;
  entity_type: string;
  credit_score: number | null;
  state_of_residence: string | null;
  real_estate_experience_years: number | null;
  properties_owned_count: number | null;
  portfolio_value: number | null;
  user_id?: string;
  organization_id?: string | null;
  borrower_status?: BorrowerStatus;
  lifecycle_stage?: LifecycleStage;
  preferred_loan_type?: string | null;
  id_document_type?: IdentityDocumentType | null;
  id_document_number?: string | null;
  id_document_state?: string | null;
  id_document_country?: string | null;
  id_document_expiration?: string | null;
  id_document_verified?: boolean;
  id_document_file_path?: string | null;
  id_document_file_name?: string | null;
  id_document_uploaded_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BorrowerFinancialProfile {
  id: string;
  borrower_id: string;
  monthly_income: number | null;
  avg_monthly_deposits: number | null;
  ending_balance_avg: number | null;
  liquidity_estimate: number | null;
  income_estimate: number | null;
  cash_flow_estimate: number | null;
  confidence_score: number | null;
  summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PrequalResult {
  id: string;
  borrower_id: string;
  prequalified_amount: number;
  qualification_range_low: number | null;
  qualification_range_high: number | null;
  estimated_rate_low: number | null;
  estimated_rate_high: number | null;
  confidence: string | null;
  summary: string | null;
  generated_at: string;
  updated_at: string;
}

export interface BorrowerIdentityDocument {
  id: string;
  borrower_id: string;
  document_type: IdentityDocumentType;
  file_name: string;
  storage_path: string;
  verification_status: IdentityVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface AnalystDecisionRecord {
  id: string;
  borrower_id: string;
  analyst_id: string | null;
  decision: AnalystDecision;
  notes: string | null;
  conditions: string[] | null;
  approved_amount: number | null;
  created_at: string;
  updated_at: string;
}

export interface LoanScenario {
  id: string;
  borrower_id: string;
  scenario_name: string;
  loan_type: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  property_type: string | null;
  occupancy: string | null;
  purchase_price: number | null;
  estimated_value: number | null;
  loan_amount: number | null;
  ltv: number | null;
  rent: number | null;
  dscr: number | null;
  loan_purpose: string | null;
  status: LoanScenarioStatus;
  created_at: string;
  updated_at: string;
}

export interface LoanScenarioUnderwritingResult {
  id: string;
  loan_scenario_id: string;
  recommended_loan_type: string | null;
  routing_result_json: Record<string, unknown> | null;
  dscr_result_json: Record<string, unknown> | null;
  nqm_result_json: Record<string, unknown> | null;
  lender_matches_json: Record<string, unknown> | null;
  summary: string | null;
  confidence_score: number | null;
  generated_at: string;
  updated_at: string;
}

export interface BorrowerUnderwritingResult {
  id: string;
  borrower_id: string;
  recommended_loan_type: string | null;
  routing_result_json: Record<string, unknown> | null;
  dscr_result_json: Record<string, unknown> | null;
  nqm_result_json: Record<string, unknown> | null;
  lender_matches_json: Record<string, unknown> | null;
  summary: string | null;
  confidence_score: number | null;
  generated_at: string;
  updated_at: string;
}

export interface UnderwritingRun {
  id: string;
  borrower_id: string | null;
  loan_scenario_id: string | null;
  run_type: 'borrower_underwriting' | 'scenario_underwriting';
  run_status: 'pending' | 'running' | 'completed' | 'failed';
  triggered_by: string | null;
  input_snapshot: Record<string, unknown> | null;
  output_snapshot: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Application {
  id: string;
  status: ApplicationStatus;
  processing_stage: string;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  user_id?: string;
  organization_id?: string | null;
  borrower_id?: string;
  borrowers?: Borrower | null;
  loan_requests?: LoanRequest[];
  properties?: Property[];
  uploaded_documents?: UploadedDocument[];
}

export interface LoanRequest {
  id: string;
  intake_submission_id: string;
  requested_amount: number;
  loan_purpose: string;
  estimated_purchase_price: number | null;
  down_payment_amount: number | null;
  down_payment_source: string | null;
}

export interface Property {
  id: string;
  intake_submission_id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  property_type: string;
  occupancy_type: string | null;
  number_of_units: number | null;
  purchase_price: number | null;
  estimated_value: number | null;
  monthly_rent: number | null;
}

export interface UploadedDocument {
  id: string;
  intake_submission_id: string;
  borrower_id: string;
  document_type: string;
  file_name: string;
  file_path: string;
  processing_status: string;
  extraction_status: string | null;
  extraction_confidence: number | null;
  created_at: string;
}

export interface PreApproval {
  id: string;
  status: string;
  requested_loan_amount: number | null;
  recommended_amount: number | null;
  qualification_min: number | null;
  qualification_max: number | null;
  verified_liquidity: number | null;
  required_liquidity: number | null;
  passes_liquidity_check: boolean | null;
  conditions: string[] | null;
  machine_decision: string | null;
  machine_confidence: number | null;
  letter_number: string | null;
  created_at: string;
  intake_submission_id?: string | null;
}

export interface ApplicationStatusHistory {
  id: string;
  application_id: string;
  previous_status: string | null;
  new_status: string;
  changed_by_user_id: string | null;
  changed_at: string;
  notes: string | null;
}

export interface NormalizedBankAccount {
  id: string;
  intake_submission_id: string;
  institution_name: string | null;
  account_number_last4: string | null;
  account_type: string | null;
  account_holder_name: string | null;
  beginning_balance: number | null;
  ending_balance: number | null;
  average_daily_balance: number | null;
  lowest_balance: number | null;
  highest_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  deposit_count: number | null;
  withdrawal_count: number | null;
  avg_monthly_deposits: number | null;
  avg_monthly_withdrawals: number | null;
  avg_monthly_balance: number | null;
  statement_start_date: string | null;
  statement_end_date: string | null;
  nsf_count: number | null;
  overdraft_count: number | null;
  returned_item_count: number | null;
  normalization_confidence: number | null;
  requires_manual_review: boolean;
  uploaded_document_id: string | null;
}

export interface DocumentClassification {
  id: string;
  uploaded_document_id: string;
  detected_type: string;
  sub_type: string | null;
  classification_confidence: number | null;
  classification_method: string | null;
  is_confirmed: boolean;
  confirmed_type: string | null;
}

export interface ExtractionAuditEntry {
  id: string;
  uploaded_document_id: string;
  field_name: string;
  normalized_field_name: string | null;
  raw_extracted_value: string | null;
  normalized_value: string | null;
  source_page: number | null;
  extraction_confidence: number | null;
  validation_status: string | null;
}

export interface LoanPackage {
  submission_id: string;
  borrower_profile: {
    borrower_id: string;
    borrower_name: string;
    entity_type: string;
    credit_score: number | null;
    estimated_dscr: number | null;
    borrower_type: 'individual' | 'entity';
    is_foreign_national: boolean;
    is_first_time_investor: boolean;
  };
  loan_terms: {
    requested_amount: number;
    purchase_price: number;
    loan_type: string;
    occupancy_type: string;
    transaction_type: string;
    ltv: number;
  };
  property_details: {
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    property_type: string | null;
    total_units: number | null;
    appraised_value: number | null;
    purchase_price: number;
  };
  financial_metrics: {
    total_available_cash: number;
    total_closing_balance: number;
    avg_monthly_deposits: number;
    avg_monthly_withdrawals: number;
    avg_monthly_net_flow: number;
    avg_monthly_balance: number;
    months_of_data: number;
    accounts_found: number;
  };
  underwriting_metrics: {
    loan_to_value: number;
    debt_service_coverage: number | null;
    borrower_liquidity_ratio: number;
    required_liquidity: number;
    passes_liquidity_check: boolean;
  };
  documents: {
    total_documents: number;
    bank_statements: number;
    processed_documents: number;
    pending_documents: number;
    failed_documents: number;
  };
  packaged_at: string;
}

export interface EligibilityCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface EligibilityResult {
  program_id: string;
  lender_name: string;
  program_name: string;
  eligible: boolean;
  checks: EligibilityCheck[];
  blocking_reasons: string[];
  passing_criteria?: string[];
  qualification_gaps?: string[];
  salvage_suggestions?: SalvageSuggestion[];
  score?: number;
  fit_category?: 'strong_fit' | 'good_fit' | 'conditional_fit' | 'closest_option' | 'no_fit';
  strategy_reason?: string;
}

export interface PlacementRun {
  id: string;
  application_id: string;
  run_at: string;
  total_lenders_evaluated: number;
  eligible_count: number;
}

export interface SalvageSuggestion {
  field: string;
  current_value: string;
  required_value: string;
  fix: string;
}

export interface PlacementResult {
  program_id: string;
  lender_name: string;
  program_name: string;
  match_score: number;
  fit_category: 'strong_fit' | 'good_fit' | 'conditional_fit' | 'closest_option' | 'no_fit';
  eligible: boolean;
  blocking_reasons: string[];
  passing_criteria: string[];
  near_misses: string[];
  salvage_suggestions: SalvageSuggestion[];
  indicative_rate: number | null;
  explanation: string;
}

export interface Notification {
  id: string;
  user_id: string;
  organization_id: string | null;
  event_type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  channel: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  action_url: string | null;
  created_at: string;
}

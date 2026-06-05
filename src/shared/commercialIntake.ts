// Commercial Project Intake & Loan Request Form — data model + option lists.
// Stored as loan_scenarios.commercial_intake (jsonb).

export interface CommercialPrincipal {
  name: string;
  address: string;
  phoneOffice: string;
  phoneCell: string;
  email: string;
  currentLiquidity: number | null;
  netWorthExclSubject: number | null;
  ownershipPct: number | null;
}

export interface CommercialIntake {
  date: string;

  // Loan information
  requestedLoanAmount: number | null;
  loanTermDuration: string;
  targetClosingDeadline: string;
  reasonForDeadline: string;

  // Loan type request (check all that apply)
  loanTypes: string[];
  targetLoanSize: number | null;
  targetLeverage: string; // LTV / LTC
  interestOnlyRequired: boolean | null;
  recoursePreference: 'recourse' | 'non_recourse' | 'flexible' | null;

  // Property type
  primaryPropertyType: string;
  primaryPropertyTypeOther: string;
  propertyClass: 'A' | 'B' | 'C' | 'NA' | null;
  stabilizationStatus: 'stabilized' | 'value_add' | 'lease_up' | 'distressed' | null;

  // Lien information
  existingFirstLienAmount: number | null;
  otherLiens: string;
  currentLienholders: string;

  // Project information
  executiveSummary: string;
  fundingSourcesApproached: string;
  reasonsNotClosed: string;

  // Capital stack
  totalProjectCost: number | null;
  equityInvestedToDate: number | null;
  remainingEquityToFund: number | null;
  requestedSeniorLoanAmount: number | null;

  // Representation
  workingWithOtherBroker: boolean | null;
  otherBrokerNameRole: string;

  // Borrower information & experience
  borrowingEntityName: string;
  projectName: string;
  projectAddress: string;
  propertyTypeText: string;
  propertyDescription: string;
  businessType: string;
  numSimilarAssets: number | null;
  totalPortfolioSize: string;
  yearsOperatingExperience: number | null;
  sponsorExperience: 'first_time' | 'experienced' | 'institutional' | null;

  // Purchase details (if applicable)
  purchasePrice: number | null;
  sellerCredit: number | null;
  cashEquityDownPayment: number | null;
  purchaseRequestedLoanAmount: number | null;
  sourceOfEquity: string;
  purchaseDeferredMaintenance: string;
  purchaseDateNeededToClose: string;

  // Refinance details (if applicable)
  refiRequestedLoanAmount: number | null;
  refiEstimatedValue: number | null;
  originalAcquisitionDate: string;
  originalCost: number | null;
  existingDebtBalance: number | null;
  currentLender: string;
  loanStatus: string;
  useOfFunds: string;
  refiDeferredMaintenance: string;
  refiDateNeededToClose: string;

  // Construction (if applicable)
  asIsValue: number | null;
  asCompletedValue: number | null;
  costToComplete: number | null;

  // Income overview
  grossRevenue2023: string;
  grossRevenue2024: string;
  grossRevenue2025: string;
  grossRevenueYtd: string;
  currentOccupancy: string;
  loanAmountPerSf: string;
  forecastDscr: string;

  // Hotel-specific (if applicable)
  hotelNumberOfRooms: number | null;
  hotelLoanPerKey: string;
  hotelForecastDscr: string;

  // Principal credit & background
  hadCreditEvents: boolean | null;
  creditEventsExplain: string;
  principals: CommercialPrincipal[];

  // Supporting documents the sponsor can provide (checklist)
  supportingDocs: string[];

  // Exit strategy
  exitStrategy: string;
  saleBrokerStrategy: string;
}

export const COMMERCIAL_LOAN_TYPES = [
  'Bridge Loan',
  'Permanent / Stabilized Loan',
  'CMBS',
  'Agency Loan (Freddie Mac / Fannie Mae)',
  'Construction Loan',
  'Not Sure / Open to Advisory Recommendation',
];

export const COMMERCIAL_PROPERTY_TYPES = [
  'Multifamily', 'Mixed-Use', 'Office', 'Retail', 'Industrial',
  'Hospitality / Hotel', 'Self-Storage', 'Senior Housing', 'Student Housing', 'Land', 'Other',
];

export const SUPPORTING_DOCUMENTS = [
  'Sources & Uses (Excel)',
  'Pro Forma (Excel)',
  'Profit & Loss Statements (3 Years)',
  'T-12 Financials',
  'YTD P&L',
  'Track Record / Schedule of REO',
  'Asset Statement',
  'Sponsor Bio / Resume',
  'Personal Financial Statements (Guarantors)',
  'Debt Schedule',
  'Itemized Construction Budget & Timeline',
  'Current Rent Roll',
  'Tax Returns (Last 3 Years)',
  'Purchase & Sale Agreement (if applicable)',
];

export function emptyCommercialPrincipal(): CommercialPrincipal {
  return { name: '', address: '', phoneOffice: '', phoneCell: '', email: '', currentLiquidity: null, netWorthExclSubject: null, ownershipPct: null };
}

export function emptyCommercialIntake(): CommercialIntake {
  return {
    date: '', requestedLoanAmount: null, loanTermDuration: '', targetClosingDeadline: '', reasonForDeadline: '',
    loanTypes: [], targetLoanSize: null, targetLeverage: '', interestOnlyRequired: null, recoursePreference: null,
    primaryPropertyType: '', primaryPropertyTypeOther: '', propertyClass: null, stabilizationStatus: null,
    existingFirstLienAmount: null, otherLiens: '', currentLienholders: '',
    executiveSummary: '', fundingSourcesApproached: '', reasonsNotClosed: '',
    totalProjectCost: null, equityInvestedToDate: null, remainingEquityToFund: null, requestedSeniorLoanAmount: null,
    workingWithOtherBroker: null, otherBrokerNameRole: '',
    borrowingEntityName: '', projectName: '', projectAddress: '', propertyTypeText: '', propertyDescription: '',
    businessType: '', numSimilarAssets: null, totalPortfolioSize: '', yearsOperatingExperience: null, sponsorExperience: null,
    purchasePrice: null, sellerCredit: null, cashEquityDownPayment: null, purchaseRequestedLoanAmount: null,
    sourceOfEquity: '', purchaseDeferredMaintenance: '', purchaseDateNeededToClose: '',
    refiRequestedLoanAmount: null, refiEstimatedValue: null, originalAcquisitionDate: '', originalCost: null,
    existingDebtBalance: null, currentLender: '', loanStatus: '', useOfFunds: '', refiDeferredMaintenance: '', refiDateNeededToClose: '',
    asIsValue: null, asCompletedValue: null, costToComplete: null,
    grossRevenue2023: '', grossRevenue2024: '', grossRevenue2025: '', grossRevenueYtd: '',
    currentOccupancy: '', loanAmountPerSf: '', forecastDscr: '',
    hotelNumberOfRooms: null, hotelLoanPerKey: '', hotelForecastDscr: '',
    hadCreditEvents: null, creditEventsExplain: '', principals: [emptyCommercialPrincipal()],
    supportingDocs: [], exitStrategy: '', saleBrokerStrategy: '',
  };
}

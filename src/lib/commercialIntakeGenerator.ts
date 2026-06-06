import jsPDF from 'jspdf';
import {
  COMMERCIAL_LOAN_TYPES, SUPPORTING_DOCUMENTS,
  type CommercialIntake, type CommercialPrincipal,
} from '../shared/commercialIntake';

// ============================================
// Commercial Project Intake & Loan Request — PDF.
// Renders the completed intake as a clean, emailable document.
// ============================================

export interface CommercialIntakeMeta {
  orgName?: string;
  borrowerName?: string;
  generatedDate?: string;
  fileName?: string;
}

const PROPERTY_CLASS_LABEL: Record<string, string> = { A: 'Class A', B: 'Class B', C: 'Class C', NA: 'Not Applicable' };
const STAB_LABEL: Record<string, string> = { stabilized: 'Stabilized', value_add: 'Value-Add', lease_up: 'Lease-Up', distressed: 'Distressed' };
const RECOURSE_LABEL: Record<string, string> = { recourse: 'Recourse', non_recourse: 'Non-Recourse', flexible: 'Flexible' };
const SPONSOR_LABEL: Record<string, string> = { first_time: 'First-time sponsor', experienced: 'Experienced operator', institutional: 'Institutional sponsor' };

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}
function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}
function yn(v: boolean | null | undefined): string {
  return v == null ? '—' : v ? 'Yes' : 'No';
}
function txt(s: string | null | undefined): string {
  return s && String(s).trim() ? String(s) : '—';
}

function buildDoc(intake: CommercialIntake, meta: CommercialIntakeMeta): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensure = (h: number) => { if (y + h > pageH - margin) { doc.addPage(); y = margin; } };

  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 20, 40);
    doc.text(meta.orgName || 'Key Real Estate Capital', margin, y); y += 20;
    doc.setFontSize(12); doc.setTextColor(13, 148, 136);
    doc.text('Commercial Project Intake & Loan Request', margin, y); y += 8;
    doc.setDrawColor(220, 220, 224); doc.line(margin, y, pageW - margin, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 110, 120);
    const sub = `${meta.borrowerName ? meta.borrowerName + '  ·  ' : ''}Generated ${meta.generatedDate || new Date().toLocaleDateString()}`;
    doc.text(sub, margin, y); y += 18;
  };

  const sectionHeader = (title: string) => {
    ensure(40);
    doc.setFillColor(243, 244, 246); doc.rect(margin, y, contentW, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(30, 30, 46);
    doc.text(title, margin + 8, y + 14); y += 28;
  };

  // Two-column key/value rows.
  const kv = (rows: Array<[string, string]>) => {
    doc.setFontSize(9.5);
    for (const [label, value] of rows) {
      const valLines = doc.splitTextToSize(value, contentW - 180);
      const rowH = Math.max(16, valLines.length * 12 + 4);
      ensure(rowH);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 110, 120);
      doc.text(label, margin, y + 10);
      doc.setTextColor(30, 30, 46);
      doc.text(valLines, margin + 180, y + 10);
      y += rowH;
    }
    y += 6;
  };

  const para = (label: string, value: string) => {
    ensure(28);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 95);
    doc.text(label, margin, y + 10); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 46);
    const lines = doc.splitTextToSize(txt(value), contentW);
    ensure(lines.length * 12 + 6);
    doc.text(lines, margin, y + 8); y += lines.length * 12 + 12;
  };

  header();

  sectionHeader('Overview & Loan Information');
  kv([
    ['Date', txt(intake.date)],
    ['Requested Loan Amount', fmtMoney(intake.requestedLoanAmount)],
    ['Loan Term / Duration', txt(intake.loanTermDuration)],
    ['Target Closing Deadline', txt(intake.targetClosingDeadline)],
    ['Reason for Deadline', txt(intake.reasonForDeadline)],
  ]);

  sectionHeader('Loan Type Request');
  kv([
    ['Financing Requested', intake.loanTypes.length ? intake.loanTypes.join(', ') : '—'],
    ['Target Loan Size', fmtMoney(intake.targetLoanSize)],
    ['Target Leverage (LTV/LTC)', txt(intake.targetLeverage)],
    ['Interest-Only Required?', yn(intake.interestOnlyRequired)],
    ['Recourse Preference', intake.recoursePreference ? RECOURSE_LABEL[intake.recoursePreference] : '—'],
  ]);

  sectionHeader('Property Type');
  kv([
    ['Primary Property Type', txt(intake.primaryPropertyType === 'Other' ? intake.primaryPropertyTypeOther : intake.primaryPropertyType)],
    ['Property Class', intake.propertyClass ? PROPERTY_CLASS_LABEL[intake.propertyClass] : '—'],
    ['Stabilization Status', intake.stabilizationStatus ? STAB_LABEL[intake.stabilizationStatus] : '—'],
  ]);

  sectionHeader('Lien Information');
  kv([
    ['Existing First Lien Amount', fmtMoney(intake.existingFirstLienAmount)],
    ['Other Liens', txt(intake.otherLiens)],
    ['Current Lienholder(s)', txt(intake.currentLienholders)],
  ]);

  sectionHeader('Project Information');
  para('Executive Summary', intake.executiveSummary);
  para('Funding Sources Approached (last 6 months)', intake.fundingSourcesApproached);
  para('Reasons Not Yet Closed / Key Blockers', intake.reasonsNotClosed);

  sectionHeader('Capital Stack');
  kv([
    ['Total Project Cost', fmtMoney(intake.totalProjectCost)],
    ['Equity Invested to Date', fmtMoney(intake.equityInvestedToDate)],
    ['Remaining Equity to Fund', fmtMoney(intake.remainingEquityToFund)],
    ['Requested Senior Loan', fmtMoney(intake.requestedSeniorLoanAmount)],
  ]);

  sectionHeader('Representation');
  kv([
    ['Working with another broker/advisor?', yn(intake.workingWithOtherBroker)],
    ['Name & Role', txt(intake.otherBrokerNameRole)],
  ]);

  sectionHeader('Borrower Information & Experience');
  kv([
    ['Borrowing Entity', txt(intake.borrowingEntityName)],
    ['Project Name', txt(intake.projectName)],
    ['Project Address', txt(intake.projectAddress)],
    ['Property Type', txt(intake.propertyTypeText)],
    ['Business Type', txt(intake.businessType)],
    ['Similar Assets Owned/Operated', fmtNum(intake.numSimilarAssets)],
    ['Total Portfolio Size', txt(intake.totalPortfolioSize)],
    ['Years of Operating Experience', fmtNum(intake.yearsOperatingExperience)],
    ['Sponsor Experience', intake.sponsorExperience ? SPONSOR_LABEL[intake.sponsorExperience] : '—'],
  ]);
  para('Property Description', intake.propertyDescription);

  sectionHeader('Purchase Details');
  kv([
    ['Purchase Price', fmtMoney(intake.purchasePrice)],
    ['Seller Credit', fmtMoney(intake.sellerCredit)],
    ['Cash Equity / Down Payment', fmtMoney(intake.cashEquityDownPayment)],
    ['Requested Loan Amount', fmtMoney(intake.purchaseRequestedLoanAmount)],
    ['Source of Equity', txt(intake.sourceOfEquity)],
    ['Deferred Maintenance', txt(intake.purchaseDeferredMaintenance)],
    ['Date Needed to Close', txt(intake.purchaseDateNeededToClose)],
  ]);

  sectionHeader('Refinance Details');
  kv([
    ['Requested Loan Amount', fmtMoney(intake.refiRequestedLoanAmount)],
    ['Estimated Property Value', fmtMoney(intake.refiEstimatedValue)],
    ['Original Acquisition Date', txt(intake.originalAcquisitionDate)],
    ['Original Cost', fmtMoney(intake.originalCost)],
    ['Existing Debt Balance', fmtMoney(intake.existingDebtBalance)],
    ['Current Lender', txt(intake.currentLender)],
    ['Loan Status', txt(intake.loanStatus)],
    ['Use of Funds', txt(intake.useOfFunds)],
    ['Deferred Maintenance', txt(intake.refiDeferredMaintenance)],
    ['Date Needed to Close', txt(intake.refiDateNeededToClose)],
  ]);

  sectionHeader('Construction');
  kv([
    ['As-Is Value', fmtMoney(intake.asIsValue)],
    ['As-Completed Value', fmtMoney(intake.asCompletedValue)],
    ['Cost to Complete', fmtMoney(intake.costToComplete)],
  ]);

  sectionHeader('Income Overview');
  kv([
    ['2023 Gross Revenue / NOI', txt(intake.grossRevenue2023)],
    ['2024 Gross Revenue / NOI', txt(intake.grossRevenue2024)],
    ['2025 Gross Revenue / NOI', txt(intake.grossRevenue2025)],
    ['YTD Gross Revenue / NOI', txt(intake.grossRevenueYtd)],
    ['Current Occupancy', txt(intake.currentOccupancy)],
    ['Loan Amount per SF', txt(intake.loanAmountPerSf)],
    ['Forecast DSCR (Proposed Loan)', txt(intake.forecastDscr)],
  ]);

  if (intake.hotelNumberOfRooms != null || intake.hotelLoanPerKey || intake.hotelForecastDscr) {
    sectionHeader('Hotel-Specific');
    kv([
      ['Number of Rooms', fmtNum(intake.hotelNumberOfRooms)],
      ['Loan Amount per Key', txt(intake.hotelLoanPerKey)],
      ['Forecast DSCR', txt(intake.hotelForecastDscr)],
    ]);
  }

  sectionHeader('Principal Information');
  kv([
    ['Bankruptcy/foreclosure/major credit events (7 yrs)?', yn(intake.hadCreditEvents)],
    ['Explanation', txt(intake.creditEventsExplain)],
  ]);
  intake.principals.forEach((p: CommercialPrincipal, i) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(13, 148, 136);
    ensure(18); doc.text(`Principal #${i + 1}`, margin, y + 10); y += 16;
    kv([
      ['Name', txt(p.name)],
      ['Address', txt(p.address)],
      ['Phone (Office)', txt(p.phoneOffice)],
      ['Phone (Cell)', txt(p.phoneCell)],
      ['Email', txt(p.email)],
      ['Current Liquidity', fmtMoney(p.currentLiquidity)],
      ['Net Worth (excl. subject)', fmtMoney(p.netWorthExclSubject)],
      ['Ownership %', p.ownershipPct != null ? `${p.ownershipPct}%` : '—'],
    ]);
  });

  sectionHeader('Supporting Documents');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 46);
  for (const d of SUPPORTING_DOCUMENTS) {
    ensure(14);
    const checked = intake.supportingDocs.includes(d);
    doc.text(`${checked ? '[X]' : '[ ]'}  ${d}`, margin, y + 9); y += 14;
  }
  y += 8;

  sectionHeader('Exit Strategy / Repayment Plan');
  kv([['Refinance / Hold / Sale', txt(intake.exitStrategy)]]);
  para('If sale — broker & marketing strategy', intake.saleBrokerStrategy);

  // void unused import guard
  void COMMERCIAL_LOAN_TYPES;
  return doc;
}

export function commercialIntakePdfToBlob(intake: CommercialIntake, meta: CommercialIntakeMeta = {}): Blob {
  return buildDoc(intake, meta).output('blob');
}

export function commercialIntakePdfBase64(intake: CommercialIntake, meta: CommercialIntakeMeta = {}): string {
  // jsPDF datauristring → strip the "data:...;base64," prefix.
  const uri = buildDoc(intake, meta).output('datauristring');
  return uri.substring(uri.indexOf(',') + 1);
}

export function downloadCommercialIntakePdf(intake: CommercialIntake, meta: CommercialIntakeMeta = {}): void {
  const safe = (meta.borrowerName || intake.borrowingEntityName || 'commercial').replace(/[^a-zA-Z0-9]+/g, '_');
  buildDoc(intake, meta).save(meta.fileName || `commercial_intake_${safe}.pdf`);
}

import jsPDF from 'jspdf';

// ============================================
// Uniform Residential Loan Application (URLA / Form 1003)
// Styled multi-page PDF generated from scratch with jsPDF.
// Mirrors the 2020 redesigned URLA section structure but is
// drawn — not the official Fannie Mae fillable PDF.
// ============================================

export interface URLA1003BorrowerInput {
  borrowerName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  ssn: string | null;
  ssnLast4: string | null;
  creditScore: number | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  entityType: string | null;
  stateOfResidence: string | null;
  monthlyIncome: number | null;
  liquidity: number | null;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed' | null;
  isFirstTimeInvestor?: boolean;
  isForeignNational?: boolean;
}

export interface URLA1003LoanInput {
  loanAmount: number | null;
  loanPurpose: string | null;
  loanType: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  propertyType: string | null;
  occupancy: string | null;
  purchasePrice: number | null;
  estimatedValue: number | null;
  rent: number | null;
  ltv: number | null;
}

export interface URLA1003Options {
  primary: URLA1003BorrowerInput;
  coBorrowers: URLA1003BorrowerInput[];
  loan: URLA1003LoanInput | null;
  orgName: string;
  brokerName: string;
  brokerEmail: string | null;
  brokerPhone: string | null;
  generatedDate: string;
  fileName?: string;
}

const BLANK = '____________________';
const BLANK_SHORT = '_______';

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return BLANK;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

function fmtSSN(raw: string | null, last4: string | null): string {
  if (raw) {
    const d = raw.replace(/\D/g, '');
    if (d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  }
  if (last4) return `XXX-XX-${last4}`;
  return BLANK;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return BLANK_SHORT;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function val(s: string | number | null | undefined, fallback = BLANK): string {
  if (s == null || s === '') return fallback;
  return String(s);
}

const LOAN_PURPOSE_LABEL: Record<string, string> = {
  purchase: 'Purchase',
  refinance: 'Refinance',
  cash_out: 'Cash-Out Refinance',
  construction: 'Construction',
  other: 'Other',
};

const PROPERTY_TYPE_LABEL: Record<string, string> = {
  sfr: 'Single Family Residence',
  condo: 'Condominium',
  townhouse: 'Townhouse',
  multi_family: 'Multi-Family (2-4 units)',
  '2_4_unit': '2-4 Unit',
  manufactured: 'Manufactured Home',
  pud: 'PUD',
};

export async function generateURLA1003Pdf(opts: URLA1003Options): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;
  let pageNum = 1;

  const setBody = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(20, 20, 30); };
  const setBold = () => { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(20, 20, 30); };
  const setSmall = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 90); };

  const drawPageHeader = (subjectName: string) => {
    // Title bar
    doc.setFillColor(30, 64, 88);
    doc.rect(margin, y, contentWidth, 28, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text('Uniform Residential Loan Application', margin + 10, y + 18);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Form 1003  ·  ${opts.orgName}`, pageWidth - margin - 10, y + 18, { align: 'right' });
    y += 32;

    // Subject line
    setSmall();
    doc.text(`Borrower: ${subjectName}    ·    Generated: ${opts.generatedDate}`, margin, y + 10);
    y += 18;
    setBody();
  };

  const drawPageFooter = () => {
    setSmall();
    doc.text(
      `Form 1003 — Uniform Residential Loan Application  ·  Page ${pageNum}  ·  This document was auto-generated from borrower profile data and may require additional information before submission to a lender.`,
      pageWidth / 2,
      pageHeight - 22,
      { align: 'center', maxWidth: contentWidth }
    );
    setBody();
  };

  const newPage = (subjectName: string) => {
    drawPageFooter();
    doc.addPage();
    pageNum++;
    y = margin;
    drawPageHeader(subjectName);
  };

  const ensureSpace = (needed: number, subjectName: string) => {
    if (y + needed > pageHeight - 50) newPage(subjectName);
  };

  const sectionHeader = (title: string, subjectName: string) => {
    ensureSpace(28, subjectName);
    doc.setFillColor(30, 64, 88);
    doc.rect(margin, y, contentWidth, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(title, margin + 8, y + 13);
    y += 22;
    setBody();
  };

  const subsection = (title: string, subjectName: string) => {
    ensureSpace(16, subjectName);
    doc.setFillColor(225, 232, 238);
    doc.rect(margin, y, contentWidth, 14, 'F');
    setBold();
    doc.text(title, margin + 6, y + 10);
    y += 18;
    setBody();
  };

  // Render a row of label/value cells. cells = [{label, value, weight?}]
  const fieldRow = (cells: { label: string; value: string; weight?: number }[], subjectName: string) => {
    ensureSpace(28, subjectName);
    const totalWeight = cells.reduce((s, c) => s + (c.weight || 1), 0);
    let x = margin;
    for (const cell of cells) {
      const w = (contentWidth * (cell.weight || 1)) / totalWeight;
      // Label
      setSmall();
      doc.text(cell.label, x + 4, y + 8);
      // Value
      setBody();
      doc.setFont('helvetica', 'bold');
      doc.text(cell.value, x + 4, y + 22, { maxWidth: w - 8 });
      doc.setFont('helvetica', 'normal');
      // Border bottom
      doc.setDrawColor(180, 188, 196);
      doc.setLineWidth(0.4);
      doc.line(x, y + 26, x + w, y + 26);
      // Border right (between cells)
      if (x + w < margin + contentWidth - 0.5) {
        doc.line(x + w, y, x + w, y + 26);
      }
      x += w;
    }
    y += 28;
  };

  const checkboxRow = (label: string, options: { label: string; checked: boolean }[], subjectName: string) => {
    ensureSpace(20, subjectName);
    setBold();
    doc.text(label, margin + 4, y + 10);
    let x = margin + Math.max(120, doc.getTextWidth(label) + 16);
    setBody();
    for (const opt of options) {
      doc.setDrawColor(80, 80, 90);
      doc.setLineWidth(0.6);
      doc.rect(x, y + 3, 9, 9);
      if (opt.checked) {
        doc.setFont('helvetica', 'bold');
        doc.text('X', x + 1.5, y + 11);
        doc.setFont('helvetica', 'normal');
      }
      doc.text(opt.label, x + 14, y + 11);
      x += 18 + doc.getTextWidth(opt.label);
    }
    // Underline at bottom
    doc.setDrawColor(180, 188, 196);
    doc.setLineWidth(0.4);
    doc.line(margin, y + 18, margin + contentWidth, y + 18);
    y += 22;
  };

  const note = (text: string, subjectName: string) => {
    ensureSpace(16, subjectName);
    setSmall();
    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, margin, y + 8);
    y += lines.length * 9 + 4;
    setBody();
  };

  // ==========================================================
  // SECTION 1 — Borrower Information (one block per borrower)
  // ==========================================================
  const renderBorrowerSection1 = (b: URLA1003BorrowerInput, header: string) => {
    sectionHeader(header, b.borrowerName);

    // 1a. Personal Information
    subsection('1a. Personal Information', b.borrowerName);
    fieldRow([
      { label: 'Name (First, Middle, Last, Suffix)', value: val(b.borrowerName), weight: 3 },
      { label: 'Social Security Number', value: fmtSSN(b.ssn, b.ssnLast4), weight: 2 },
      { label: 'Date of Birth (mm/dd/yyyy)', value: fmtDate(b.dateOfBirth), weight: 2 },
    ], b.borrowerName);
    checkboxRow('Citizenship', [
      { label: 'U.S. Citizen', checked: !b.isForeignNational },
      { label: 'Permanent Resident Alien', checked: false },
      { label: 'Non-Permanent Resident Alien', checked: !!b.isForeignNational },
    ], b.borrowerName);
    checkboxRow('Marital Status', [
      // URLA only has Married / Separated / Unmarried buckets; Single/Divorced/Widowed
      // all roll up to Unmarried per Fannie Mae's URLA instructions.
      { label: 'Married', checked: b.maritalStatus === 'married' },
      { label: 'Separated', checked: false },
      { label: 'Unmarried', checked: b.maritalStatus === 'single' || b.maritalStatus === 'divorced' || b.maritalStatus === 'widowed' },
    ], b.borrowerName);
    fieldRow([
      { label: 'Dependents (number)', value: BLANK_SHORT, weight: 1 },
      { label: 'Ages', value: BLANK, weight: 2 },
      { label: 'Home Phone', value: val(b.phone), weight: 2 },
      { label: 'Cell Phone', value: val(b.phone), weight: 2 },
      { label: 'Email', value: val(b.email), weight: 3 },
    ], b.borrowerName);

    // Current Address
    subsection('Current Address', b.borrowerName);
    fieldRow([
      { label: 'Street', value: val(b.addressStreet), weight: 4 },
      { label: 'Unit #', value: BLANK_SHORT, weight: 1 },
    ], b.borrowerName);
    fieldRow([
      { label: 'City', value: val(b.addressCity), weight: 3 },
      { label: 'State', value: val(b.addressState || b.stateOfResidence), weight: 1 },
      { label: 'ZIP', value: val(b.addressZip), weight: 1 },
      { label: 'Country', value: 'USA', weight: 1 },
    ], b.borrowerName);
    fieldRow([
      { label: 'How Long at Current Address?', value: BLANK, weight: 2 },
      { label: 'Housing', value: 'No primary housing expense / Own / Rent', weight: 3 },
      { label: 'Monthly Housing Expense', value: BLANK, weight: 2 },
    ], b.borrowerName);

    // 1b. Current Employment/Self-Employment and Income
    subsection('1b. Current Employment / Self-Employment and Income', b.borrowerName);
    fieldRow([
      { label: 'Employer or Business Name', value: BLANK, weight: 3 },
      { label: 'Phone', value: BLANK, weight: 2 },
    ], b.borrowerName);
    fieldRow([
      { label: 'Street', value: BLANK, weight: 4 },
      { label: 'Unit #', value: BLANK_SHORT, weight: 1 },
    ], b.borrowerName);
    fieldRow([
      { label: 'City', value: BLANK, weight: 3 },
      { label: 'State', value: BLANK_SHORT, weight: 1 },
      { label: 'ZIP', value: BLANK_SHORT, weight: 1 },
      { label: 'Country', value: 'USA', weight: 1 },
    ], b.borrowerName);
    fieldRow([
      { label: 'Position or Title', value: BLANK, weight: 3 },
      { label: 'Start Date', value: BLANK, weight: 2 },
      { label: 'How long in line of work? (years)', value: BLANK_SHORT, weight: 2 },
    ], b.borrowerName);
    checkboxRow('Self-Employed?', [
      { label: 'Yes', checked: false },
      { label: 'No', checked: false },
      { label: 'Owner ≥ 25%', checked: false },
    ], b.borrowerName);
    fieldRow([
      { label: 'Gross Monthly Income — Base', value: fmtCurrency(b.monthlyIncome), weight: 2 },
      { label: 'Overtime', value: '$0', weight: 1 },
      { label: 'Bonus', value: '$0', weight: 1 },
      { label: 'Commission', value: '$0', weight: 1 },
      { label: 'Other', value: '$0', weight: 1 },
      { label: 'TOTAL', value: fmtCurrency(b.monthlyIncome), weight: 2 },
    ], b.borrowerName);

    // 1c. Additional Employment
    subsection('1c. IF APPLICABLE, Complete Information for Additional Employment / Self-Employment', b.borrowerName);
    note('Does not apply.', b.borrowerName);

    // 1d. Previous Employment
    subsection('1d. IF APPLICABLE, Complete Information for Previous Employment', b.borrowerName);
    note('Required only if current employment is less than 2 years.', b.borrowerName);

    // 1e. Income from Other Sources
    subsection('1e. Income from Other Sources', b.borrowerName);
    note('Examples: alimony, child support, social security, retirement, rental income, capital gains, etc. Auto-fill not available.', b.borrowerName);
    fieldRow([
      { label: 'Income Source', value: BLANK, weight: 3 },
      { label: 'Monthly Income', value: BLANK, weight: 2 },
    ], b.borrowerName);

    // Notable signals from the file
    if (b.creditScore || b.liquidity || b.entityType) {
      subsection('Auto-filled signals from borrower file', b.borrowerName);
      fieldRow([
        { label: 'Mid Credit Score (informational)', value: val(b.creditScore), weight: 2 },
        { label: 'Verified Liquid Assets', value: fmtCurrency(b.liquidity), weight: 2 },
        { label: 'Entity Type', value: val(b.entityType), weight: 2 },
      ], b.borrowerName);
    }
  };

  // ==========================================================
  // PAGE 1 — Section 1 for primary borrower
  // ==========================================================
  drawPageHeader(opts.primary.borrowerName);
  renderBorrowerSection1(opts.primary, 'Section 1: Borrower Information');

  // ==========================================================
  // PAGE 2 — Section 2 (Assets and Liabilities)
  // ==========================================================
  newPage(opts.primary.borrowerName);
  sectionHeader('Section 2: Financial Information — Assets and Liabilities', opts.primary.borrowerName);

  subsection('2a. Assets — Bank Accounts, Retirement, and Other Accounts You Have', opts.primary.borrowerName);
  fieldRow([
    { label: 'Account Type', value: 'Checking / Savings (verified via bank statements)', weight: 3 },
    { label: 'Financial Institution', value: BLANK, weight: 3 },
    { label: 'Account Number', value: BLANK, weight: 2 },
    { label: 'Cash or Market Value', value: fmtCurrency(opts.primary.liquidity), weight: 2 },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'Account Type', value: BLANK, weight: 3 },
    { label: 'Financial Institution', value: BLANK, weight: 3 },
    { label: 'Account Number', value: BLANK, weight: 2 },
    { label: 'Cash or Market Value', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);

  subsection('2b. Other Assets You Have', opts.primary.borrowerName);
  fieldRow([
    { label: 'Asset Type', value: BLANK, weight: 3 },
    { label: 'Cash or Market Value', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);

  subsection('2c. Liabilities — Credit Cards, Other Debts, and Leases that You Owe', opts.primary.borrowerName);
  note('Pull from credit report. Auto-fill not available.', opts.primary.borrowerName);
  fieldRow([
    { label: 'Account Type (Revolving/Installment/Lease/Other)', value: BLANK, weight: 3 },
    { label: 'Company Name', value: BLANK, weight: 3 },
    { label: 'Account Number', value: BLANK, weight: 2 },
    { label: 'Unpaid Balance', value: BLANK, weight: 2 },
    { label: 'Monthly Payment', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);

  subsection('2d. Other Liabilities and Expenses', opts.primary.borrowerName);
  fieldRow([
    { label: 'Type (Alimony, Child Support, Job-Related Expenses, etc.)', value: BLANK, weight: 3 },
    { label: 'Monthly Payment', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);

  // ==========================================================
  // PAGE 3 — Section 3 (Real Estate Owned) and Section 4 (Loan & Property)
  // ==========================================================
  newPage(opts.primary.borrowerName);
  sectionHeader('Section 3: Financial Information — Real Estate', opts.primary.borrowerName);

  subsection('3a. Property You Own', opts.primary.borrowerName);
  note('List each property currently owned. Required if borrower owns real estate other than the subject property.', opts.primary.borrowerName);
  fieldRow([
    { label: 'Address', value: BLANK, weight: 4 },
    { label: 'Status (Sold/Pending Sale/Retained)', value: BLANK, weight: 2 },
    { label: 'Intended Occupancy', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'Property Value', value: BLANK, weight: 2 },
    { label: 'Monthly Insurance, Taxes, HOA', value: BLANK, weight: 2 },
    { label: 'Mortgage Balance', value: BLANK, weight: 2 },
    { label: 'Monthly Mortgage Payment', value: BLANK, weight: 2 },
    { label: 'Gross Monthly Rental Income', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);

  sectionHeader('Section 4: Loan and Property Information', opts.primary.borrowerName);

  const loan = opts.loan;
  subsection('4a. Loan and Property Information', opts.primary.borrowerName);
  fieldRow([
    { label: 'Loan Amount', value: fmtCurrency(loan?.loanAmount ?? null), weight: 2 },
    { label: 'Loan Purpose', value: loan?.loanPurpose ? (LOAN_PURPOSE_LABEL[loan.loanPurpose] || loan.loanPurpose) : BLANK, weight: 2 },
    { label: 'Loan Product', value: val(loan?.loanType), weight: 2 },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'Property Address', value: val(loan?.propertyAddress), weight: 4 },
    { label: 'Unit #', value: BLANK_SHORT, weight: 1 },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'City', value: val(loan?.propertyCity), weight: 3 },
    { label: 'State', value: val(loan?.propertyState), weight: 1 },
    { label: 'ZIP', value: val(loan?.propertyZip), weight: 1 },
    { label: 'County', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'Number of Units', value: BLANK_SHORT, weight: 1 },
    { label: 'Property Value', value: fmtCurrency(loan?.estimatedValue ?? null), weight: 2 },
    { label: 'Purchase Price', value: fmtCurrency(loan?.purchasePrice ?? null), weight: 2 },
    { label: 'LTV', value: loan?.ltv != null ? `${loan.ltv.toFixed(1)}%` : BLANK_SHORT, weight: 1 },
  ], opts.primary.borrowerName);
  checkboxRow('Occupancy', [
    { label: 'Primary Residence', checked: loan?.occupancy === 'primary' },
    { label: 'Second Home', checked: loan?.occupancy === 'secondary' },
    { label: 'Investment Property', checked: loan?.occupancy === 'investment' || !loan?.occupancy },
  ], opts.primary.borrowerName);
  checkboxRow('Property Type', [
    { label: '1-Unit', checked: loan?.propertyType === 'sfr' },
    { label: '2-4 Units', checked: loan?.propertyType === 'multi_family' || loan?.propertyType === '2_4_unit' },
    { label: 'Condo', checked: loan?.propertyType === 'condo' },
    { label: 'PUD', checked: loan?.propertyType === 'pud' },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'Property Type (free text)', value: loan?.propertyType ? (PROPERTY_TYPE_LABEL[loan.propertyType] || loan.propertyType) : BLANK, weight: 2 },
    { label: 'Mixed-Use Property?', value: 'No', weight: 1 },
    { label: 'Manufactured Home?', value: 'No', weight: 1 },
  ], opts.primary.borrowerName);

  subsection('4b. Other New Mortgage Loans on the Property You Are Buying or Refinancing', opts.primary.borrowerName);
  note('Does not apply unless additional financing exists.', opts.primary.borrowerName);

  subsection('4c. Rental Income on the Property You Are Buying or Refinancing', opts.primary.borrowerName);
  fieldRow([
    { label: 'Expected Monthly Rental Income', value: fmtCurrency(loan?.rent ?? null), weight: 2 },
    { label: 'Expected Monthly Net Rental Income (for qualifying)', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);

  subsection('4d. Gifts or Grants You Have Been Given or Will Receive for this Loan', opts.primary.borrowerName);
  note('Does not apply.', opts.primary.borrowerName);

  // ==========================================================
  // PAGE 4 — Sections 5 & 6 (Declarations and Acknowledgments)
  // ==========================================================
  newPage(opts.primary.borrowerName);
  sectionHeader('Section 5: Declarations', opts.primary.borrowerName);
  subsection('5a. About this Property and Your Money for this Loan', opts.primary.borrowerName);
  const declarations5a = [
    'A. Will you occupy the property as your primary residence?',
    'B. Have you had an ownership interest in another property in the last three years?',
    'C. If yes to B, what type of property (Primary, Secondary, Investment)?',
    'D. How did you hold title to that property (Sole, Joint with Spouse, Joint with Other)?',
    'E. Are you borrowing any money for this transaction (other than the loan)?',
    'F. Have you or will you be applying for a mortgage loan on another property before this loan closes?',
    'G. Have you or will you be applying for any new credit (e.g., installment loan, credit card) before this loan closes?',
    'H. Will this property be subject to a lien that could take priority over the first mortgage?',
  ];
  for (const q of declarations5a) {
    checkboxRow(q, [
      { label: 'Yes', checked: false },
      { label: 'No', checked: false },
    ], opts.primary.borrowerName);
  }

  subsection('5b. About Your Finances', opts.primary.borrowerName);
  const declarations5b = [
    'I. Are you a co-signer or guarantor on any debt or loan that is not disclosed on this application?',
    'J. Are there any outstanding judgments against you?',
    'K. Are you currently delinquent or in default on a Federal debt?',
    'L. Are you a party to a lawsuit in which you potentially have any personal financial liability?',
    'M. Have you conveyed title to any property in lieu of foreclosure in the past 7 years?',
    'N. Have you completed a pre-foreclosure sale or short sale in the past 7 years?',
    'O. Have you had property foreclosed upon in the past 7 years?',
    'P. Have you declared bankruptcy in the past 7 years?',
  ];
  for (const q of declarations5b) {
    checkboxRow(q, [
      { label: 'Yes', checked: false },
      { label: 'No', checked: false },
    ], opts.primary.borrowerName);
  }

  sectionHeader('Section 6: Acknowledgments and Agreements', opts.primary.borrowerName);
  note(
    'By signing below, each Borrower acknowledges and agrees that the information provided in this application is true, accurate, and complete as of the date set forth opposite my signature; that the lender, mortgage brokers, their successors and assigns, may retain the original and/or an electronic record of this application; that each Borrower has read and understands the acknowledgments and agreements that accompany the Uniform Residential Loan Application (URLA / Form 1003).',
    opts.primary.borrowerName,
  );

  ensureSpace(80, opts.primary.borrowerName);
  // Signature blocks
  const sigWidth = (contentWidth - 20) / 2;
  doc.setDrawColor(80, 80, 90);
  doc.setLineWidth(0.6);
  doc.line(margin, y + 28, margin + sigWidth, y + 28);
  doc.line(margin + sigWidth + 20, y + 28, margin + contentWidth, y + 28);
  setSmall();
  doc.text('Borrower Signature', margin, y + 40);
  doc.text(`Printed: ${opts.primary.borrowerName}`, margin, y + 50);
  doc.text('Co-Borrower Signature (if applicable)', margin + sigWidth + 20, y + 40);
  doc.text(`Printed: ${opts.coBorrowers[0]?.borrowerName || ''}`, margin + sigWidth + 20, y + 50);
  y += 60;

  doc.line(margin, y + 28, margin + sigWidth, y + 28);
  doc.line(margin + sigWidth + 20, y + 28, margin + contentWidth, y + 28);
  doc.text('Date', margin, y + 40);
  doc.text('Date', margin + sigWidth + 20, y + 40);
  setBody();
  y += 50;

  // ==========================================================
  // CO-BORROWER PAGES — one Section 1 per additional borrower
  // ==========================================================
  for (let i = 0; i < opts.coBorrowers.length; i++) {
    const co = opts.coBorrowers[i];
    newPage(co.borrowerName);
    renderBorrowerSection1(co, `Additional Borrower ${i + 1}: Section 1`);
  }

  // ==========================================================
  // FINAL PAGE — Loan Originator Information (Section 9)
  // ==========================================================
  newPage(opts.primary.borrowerName);
  sectionHeader('Section 9: Loan Originator Information', opts.primary.borrowerName);
  fieldRow([
    { label: 'Loan Originator Organization', value: opts.orgName, weight: 3 },
    { label: 'Loan Originator', value: opts.brokerName, weight: 3 },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'Originator Email', value: val(opts.brokerEmail), weight: 3 },
    { label: 'Originator Phone', value: val(opts.brokerPhone), weight: 2 },
    { label: 'Date Application Prepared', value: opts.generatedDate, weight: 2 },
  ], opts.primary.borrowerName);
  fieldRow([
    { label: 'NMLS ID — Organization', value: BLANK, weight: 2 },
    { label: 'NMLS ID — Individual', value: BLANK, weight: 2 },
    { label: 'State License — Organization', value: BLANK, weight: 2 },
    { label: 'State License — Individual', value: BLANK, weight: 2 },
  ], opts.primary.borrowerName);

  drawPageFooter();

  const safeName = opts.primary.borrowerName.replace(/[^a-zA-Z0-9]+/g, '_');
  doc.save(opts.fileName || `URLA_1003_${safeName}.pdf`);
}

import type { URLA1003BorrowerInput, URLA1003LoanInput, URLA1003Options } from './urla1003Generator';

// ============================================
// MISMO v3.4 (URLA) XML generator.
// Produces a MISMO v3.4 dataset for AUS/LOS consumption from the same
// inputs the PDF 1003 generator takes. Fields with no source data are
// omitted (rather than emitted blank) so downstream parsers don't choke.
// ============================================

const MISMO_VERSION = '3.4.032420160128.5';
const MISMO_NS = 'http://www.mismo.org/residential/2009/schemas';

// Key Real Estate Capital company (loan-origination-company) NMLS identifier.
const COMPANY_NMLS_ID = '2676974';

export async function generateURLA1003MismoXml(opts: URLA1003Options): Promise<string> {
  const xml = buildMessage(opts);
  triggerDownload(xml, opts.fileName || defaultFileName(opts));
  return xml;
}

function defaultFileName(opts: URLA1003Options): string {
  const safe = (opts.primary.borrowerName || 'borrower').replace(/[^a-zA-Z0-9]+/g, '_');
  return `URLA_MISMO_3.4_${safe}.xml`;
}

function triggerDownload(xml: string, fileName: string) {
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ----------------- XML helpers -----------------

function esc(s: string | number | null | undefined): string {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Open/close tag pair with text content. Returns '' if value is empty so callers can compose conditionally. */
function tag(name: string, value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  return `<${name}>${esc(value)}</${name}>`;
}

/** Wrap children in a parent tag. Returns '' if children is empty. */
function wrap(name: string, children: string, attrs = ''): string {
  if (!children.trim()) return '';
  return `<${name}${attrs ? ' ' + attrs : ''}>${children}</${name}>`;
}

function isoDate(s: string | null | undefined): string {
  if (!s) return '';
  // Accepts YYYY-MM-DD or any Date-parseable; emits YYYY-MM-DD
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function isoDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

function digits(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/\D/g, '');
}

function splitName(full: string | null | undefined): { first: string; middle: string; last: string } {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', middle: '', last: '' };
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
}

// ----------------- Mappers -----------------

const LOAN_PURPOSE_MISMO: Record<string, string> = {
  purchase: 'Purchase',
  refinance: 'NoCashOutRefinance',
  cash_out: 'CashOutRefinance',
  construction: 'Construction',
  other: 'Other',
};

const PROPERTY_USAGE_MISMO: Record<string, string> = {
  primary: 'PrimaryResidence',
  secondary: 'SecondHome',
  investment: 'Investment',
};

const ATTACHMENT_TYPE_MISMO: Record<string, string> = {
  sfr: 'Detached',
  multi_family: 'Detached',
  '2_4_unit': 'Detached',
  condo: 'Attached',
  townhouse: 'Attached',
  pud: 'Attached',
  manufactured: 'Detached',
};

const FINANCED_UNITS: Record<string, string> = {
  sfr: '1',
  multi_family: '4',
  '2_4_unit': '4',
  condo: '1',
  townhouse: '1',
  pud: '1',
  manufactured: '1',
};

// ----------------- Section builders -----------------

function buildMessage(opts: URLA1003Options): string {
  const now = new Date();
  const inner = [
    buildAboutVersions(now),
    wrap('DEAL_SETS',
      wrap('DEAL_SET',
        wrap('DEALS',
          wrap('DEAL', [
            buildCollaterals(opts.loan),
            buildLoans(opts.loan),
            buildParties(opts),
            buildAssets(opts.primary),
          ].join(''))
        )
      )
    ),
  ].join('');

  const attrs = `xmlns="${MISMO_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" MISMOReferenceModelIdentifier="${MISMO_VERSION}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${wrap('MESSAGE', inner, attrs)}\n`;
}

function buildAboutVersions(now: Date): string {
  return wrap('ABOUT_VERSIONS',
    wrap('ABOUT_VERSION', [
      tag('AddressChangeDate', ''),
      tag('CreatedDatetime', isoDateTime(now)),
      tag('DataVersionIdentifier', '1003 v5'),
      tag('DataVersionName', 'URLA'),
    ].join(''))
  );
}

function buildCollaterals(loan: URLA1003LoanInput | null): string {
  if (!loan) return '';
  const address = buildAddress({
    street: loan.propertyAddress,
    city: loan.propertyCity,
    state: loan.propertyState,
    zip: loan.propertyZip,
  }, 'Mailing');

  const propertyDetail = wrap('PROPERTY_DETAIL', [
    tag('AttachmentType', loan.propertyType ? ATTACHMENT_TYPE_MISMO[loan.propertyType] : ''),
    tag('FinancedUnitCount', loan.propertyType ? FINANCED_UNITS[loan.propertyType] : '1'),
    tag('PropertyEstateType', 'FeeSimple'),
    tag('PropertyUsageType', loan.occupancy ? PROPERTY_USAGE_MISMO[loan.occupancy] : 'Investment'),
  ].join(''));

  const valuation = loan.estimatedValue
    ? wrap('PROPERTY_VALUATIONS',
        wrap('PROPERTY_VALUATION',
          wrap('PROPERTY_VALUATION_DETAIL', [
            tag('PropertyValuationAmount', String(loan.estimatedValue)),
            tag('PropertyValuationMethodType', 'Estimate'),
          ].join(''))
        )
      )
    : '';

  const salesContract = loan.purchasePrice
    ? wrap('SALES_CONTRACTS',
        wrap('SALES_CONTRACT',
          wrap('SALES_CONTRACT_DETAIL',
            tag('RealPropertyAmount', String(loan.purchasePrice))
          )
        )
      )
    : '';

  return wrap('COLLATERALS',
    wrap('COLLATERAL',
      wrap('SUBJECT_PROPERTY', [address, propertyDetail, valuation, salesContract].join(''))
    )
  );
}

function buildLoans(loan: URLA1003LoanInput | null): string {
  if (!loan) {
    return wrap('LOANS', wrap('LOAN', wrap('LOAN_DETAIL', tag('LienPriorityType', 'FirstLien')), 'LoanRoleType="SubjectLoan"'));
  }

  const loanDetail = wrap('LOAN_DETAIL', [
    tag('LienPriorityType', 'FirstLien'),
    tag('LoanAmortizationMaximumTermMonths', ''),
    tag('LoanRepaymentType', ''),
  ].join(''));

  // dscr, fix_flip, bridge, bank_statement, etc. don't map to a MISMO enumerated
  // LoanProductType. We emit Other and put the broker's product name in
  // LoanProductDescription so the downstream LOS can read it.
  const loanProduct = wrap('LOAN_PRODUCT',
    wrap('LOAN_PRODUCT_DETAIL', [
      tag('LoanProductType', 'Other'),
      tag('LoanProductDescription', loan.loanType || ''),
    ].join(''))
  );

  const loanPurpose = loan.loanPurpose
    ? wrap('LOAN_PURPOSE', tag('LoanPurposeType', LOAN_PURPOSE_MISMO[loan.loanPurpose] || 'Other'))
    : '';

  const terms = loan.loanAmount
    ? wrap('TERMS_OF_LOAN', [
        tag('BaseLoanAmount', String(loan.loanAmount)),
        tag('LoanAmountIncreaseIndicator', 'false'),
        tag('MortgageType', 'Conventional'),
      ].join(''))
    : '';

  return wrap('LOANS',
    wrap('LOAN', [loanDetail, loanProduct, loanPurpose, terms].join(''), 'LoanRoleType="SubjectLoan"')
  );
}

function buildParties(opts: URLA1003Options): string {
  const parties: string[] = [];
  parties.push(buildBorrowerParty(opts.primary, 'Borrower'));
  for (const co of opts.coBorrowers) {
    parties.push(buildBorrowerParty(co, 'Borrower'));
  }
  parties.push(buildOriginatorParty(opts));
  return wrap('PARTIES', parties.join(''));
}

function buildBorrowerParty(b: URLA1003BorrowerInput, roleType: 'Borrower'): string {
  const name = splitName(b.borrowerName);
  const ssn = digits(b.ssn);
  const dob = isoDate(b.dateOfBirth);

  const individual = wrap('INDIVIDUAL', [
    wrap('NAME', [
      tag('FirstName', name.first),
      tag('MiddleName', name.middle),
      tag('LastName', name.last),
    ].join('')),
    buildContactPoints(b),
  ].join(''));

  const taxpayer = ssn
    ? wrap('TAXPAYER_IDENTIFIERS',
        wrap('TAXPAYER_IDENTIFIER', [
          tag('TaxpayerIdentifierType', 'SocialSecurityNumber'),
          tag('TaxpayerIdentifierValue', ssn),
        ].join(''))
      )
    : '';

  // MISMO only enumerates Married / Separated / Unmarried / NotDisclosed.
  // Single/Divorced/Widowed all map to Unmarried per Fannie Mae's URLA spec.
  const maritalStatusType =
    b.maritalStatus === 'married' ? 'Married' :
    b.maritalStatus === 'single' || b.maritalStatus === 'divorced' || b.maritalStatus === 'widowed' ? 'Unmarried' :
    'NotDisclosed';
  const borrowerDetail = wrap('BORROWER_DETAIL', [
    tag('BorrowerBirthDate', dob),
    tag('MaritalStatusType', maritalStatusType),
    tag('CitizenshipResidencyType', b.isForeignNational ? 'NonPermanentResidentAlien' : 'USCitizen'),
  ].join(''));

  const currentIncome = b.monthlyIncome
    ? wrap('CURRENT_INCOME',
        wrap('CURRENT_INCOME_ITEMS',
          wrap('CURRENT_INCOME_ITEM',
            wrap('CURRENT_INCOME_ITEM_DETAIL', [
              tag('CurrentIncomeMonthlyTotalAmount', String(b.monthlyIncome)),
              tag('IncomeType', 'Base'),
            ].join(''))
          )
        )
      )
    : '';

  const roles = wrap('ROLES',
    wrap('ROLE', [
      wrap('BORROWER', [borrowerDetail, currentIncome].join('')),
      wrap('ROLE_DETAIL', tag('PartyRoleType', roleType)),
    ].join(''))
  );

  const addresses = wrap('ADDRESSES',
    buildAddress({
      street: b.addressStreet,
      city: b.addressCity,
      state: b.addressState,
      zip: b.addressZip,
    }, 'Current')
  );

  // RESIDENCES — current + any prior addresses (URLA requires when current tenure < 2 years)
  const residenceNodes: string[] = [];
  residenceNodes.push(buildResidence({
    street: b.addressStreet,
    city: b.addressCity,
    state: b.addressState,
    zip: b.addressZip,
    yearsAt: b.housingYearsAt ?? null,
    monthsAt: b.housingMonthsAt ?? null,
    housingType: b.housingType ?? null,
    monthlyHousingExpense: b.monthlyHousingExpense ?? null,
    residencyType: 'Current',
  }));
  for (const prev of b.previousAddresses || []) {
    residenceNodes.push(buildResidence({
      street: prev.addressStreet,
      city: prev.addressCity,
      state: prev.addressState,
      zip: prev.addressZip,
      yearsAt: prev.yearsAt,
      monthsAt: prev.monthsAt,
      housingType: prev.housingType,
      monthlyHousingExpense: prev.monthlyHousingExpense,
      residencyType: 'Prior',
    }));
  }
  const residences = wrap('RESIDENCES', residenceNodes.join(''));

  return wrap('PARTY', [individual, taxpayer, roles, addresses, residences].join(''));
}

function buildResidence(r: {
  street: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  zip: string | null | undefined;
  yearsAt: number | null;
  monthsAt: number | null;
  housingType: 'own' | 'rent' | 'rent_free' | null;
  monthlyHousingExpense: number | null;
  residencyType: 'Current' | 'Prior';
}): string {
  // MISMO BorrowerResidencyBasisType: Own | Rent | LivingRentFree
  const basisType =
    r.housingType === 'own' ? 'Own' :
    r.housingType === 'rent' ? 'Rent' :
    r.housingType === 'rent_free' ? 'LivingRentFree' :
    '';

  const detail = wrap('RESIDENCE_DETAIL', [
    tag('BorrowerResidencyType', r.residencyType),
    tag('BorrowerResidencyDurationYearsCount', r.yearsAt != null ? String(r.yearsAt) : ''),
    tag('BorrowerResidencyDurationMonthsCount', r.monthsAt != null ? String(r.monthsAt) : ''),
    tag('BorrowerResidencyBasisType', basisType),
  ].join(''));

  const address = buildAddress({
    street: r.street ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    zip: r.zip ?? null,
  }, r.residencyType === 'Current' ? 'Current' : 'Prior');

  // Monthly rent only emitted for renters
  const rent = r.housingType === 'rent' && r.monthlyHousingExpense != null
    ? wrap('MONTHLY_RENT', [
        tag('MonthlyRentAmount', String(r.monthlyHousingExpense)),
      ].join(''))
    : '';

  return wrap('RESIDENCE', [detail, address, rent].join(''));
}

function buildOriginatorParty(opts: URLA1003Options): string {
  const legalEntity = wrap('LEGAL_ENTITY', [
    wrap('LEGAL_ENTITY_DETAIL', tag('FullName', opts.orgName)),
    wrap('LICENSES', wrap('LICENSE', wrap('LICENSE_DETAIL', [
      tag('LicenseAuthorityLevelType', 'Federal'),
      tag('LicenseIdentifier', COMPANY_NMLS_ID),
    ].join('')))),
  ].join(''));

  const contactName = splitName(opts.brokerName);
  const individual = wrap('INDIVIDUAL', [
    wrap('NAME', [
      tag('FirstName', contactName.first),
      tag('LastName', contactName.last),
    ].join('')),
    buildContactPoints({ email: opts.brokerEmail, phone: opts.brokerPhone }),
  ].join(''));

  const roles = wrap('ROLES',
    wrap('ROLE',
      wrap('ROLE_DETAIL', tag('PartyRoleType', 'LoanOriginationCompany'))
    )
  );

  return wrap('PARTY', [legalEntity, individual, roles].join(''));
}

function buildContactPoints(b: { email?: string | null; phone?: string | null }): string {
  const parts: string[] = [];
  if (b.email) {
    parts.push(wrap('CONTACT_POINT',
      wrap('CONTACT_POINT_EMAIL', tag('ContactPointEmailValue', b.email))
    ));
  }
  if (b.phone) {
    parts.push(wrap('CONTACT_POINT',
      wrap('CONTACT_POINT_TELEPHONE', [
        tag('ContactPointTelephoneValue', digits(b.phone)),
        tag('ContactPointRoleType', 'Mobile'),
      ].join(''))
    ));
  }
  return parts.length ? wrap('CONTACT_POINTS', parts.join('')) : '';
}

function buildAddress(addr: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }, addressType: string): string {
  if (!addr.street && !addr.city && !addr.state && !addr.zip) return '';
  return wrap('ADDRESS', [
    tag('AddressLineText', addr.street),
    tag('CityName', addr.city),
    tag('CountryCode', 'US'),
    tag('PostalCode', addr.zip),
    tag('StateCode', addr.state),
    tag('AddressType', addressType),
  ].join(''));
}

function buildAssets(b: URLA1003BorrowerInput): string {
  if (!b.liquidity) return '';
  // Liquidity from Plaid CRA goes in as a CheckingAccount asset so AUS engines see it.
  return wrap('ASSETS',
    wrap('ASSET', [
      wrap('ASSET_DETAIL', [
        tag('AssetAccountIdentifier', ''),
        tag('AssetCashOrMarketValueAmount', String(Math.round(b.liquidity))),
        tag('AssetType', 'CheckingAccount'),
      ].join('')),
      wrap('ASSET_HOLDER',
        wrap('NAME', tag('FullName', 'Verified via Plaid CRA'))
      ),
    ].join(''))
  );
}

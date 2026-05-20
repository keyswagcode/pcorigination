// Compute estimated annual income from a stored Plaid Check base report.
// Counts inflows on depository accounts that Plaid has classified as income.
// Excludes transfers, credit-card payments, refunds, and other non-income deposits.

interface Transaction {
  date?: string;
  amount?: number;
  description?: string;
  name?: string;
  original_description?: string;
  category?: string[] | null;
  personal_finance_category?: {
    primary?: string;
    detailed?: string;
  } | null;
}

interface Account {
  type?: string;
  transactions?: Transaction[];
}

interface Item {
  accounts?: Account[];
}

interface PlaidReport {
  items?: Item[];
}

export interface IncomeEstimate {
  annualIncome: number;
  monthlyAverage: number;
  monthsCovered: number;
  itemCount: number;
}

const DEPOSIT_INCOME_PRIMARY = new Set(['INCOME']);

const DEPOSIT_INCOME_LEGACY = new Set(['payroll', 'wages', 'salary', 'interest', 'dividends', 'retirement', 'pension']);

const EXCLUDE_PRIMARY = new Set([
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'LOAN_PAYMENTS',
  'BANK_FEES',
]);

const EXCLUDE_LEGACY = new Set(['transfer', 'credit', 'refund', 'reimbursement', 'cash advance', 'payment', 'fee', 'atm']);

function isIncomeTransaction(tx: Transaction): boolean {
  // Plaid convention: deposits/inflows have negative amounts on credit-card-style
  // accounts but POSITIVE on depository accounts when reported via the CRA Check
  // base report. We treat positive amounts on depository as the inflow direction.
  const amount = Number(tx.amount) || 0;
  if (amount <= 0) return false;

  const pfc = tx.personal_finance_category;
  if (pfc?.primary) {
    if (EXCLUDE_PRIMARY.has(pfc.primary)) return false;
    if (DEPOSIT_INCOME_PRIMARY.has(pfc.primary)) return true;
    return false;
  }

  // Fallback to legacy category array
  const cats = (tx.category || []).map(c => c.toLowerCase());
  if (cats.length === 0) return false;
  for (const c of cats) {
    if (EXCLUDE_LEGACY.has(c)) return false;
  }
  for (const c of cats) {
    if (DEPOSIT_INCOME_LEGACY.has(c)) return true;
  }
  return false;
}

export function estimateAnnualIncome(report: PlaidReport | null | undefined): IncomeEstimate | null {
  if (!report?.items) return null;

  // Use every income transaction Plaid gives us — Plaid CRA base reports
  // typically include 24 months of history, so capping at 12 throws away
  // half the signal. We use the actual span from the earliest to the
  // latest income transaction as the denominator, then extrapolate to
  // a yearly figure (monthlyAverage * 12) regardless of whether we
  // happened to land at exactly 12 months. This is what the underwriter
  // would do by hand: "they made $X over Y months, so monthly avg is
  // X/Y, annual is X/Y * 12."

  let total = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;
  let count = 0;

  for (const item of report.items) {
    for (const account of item.accounts || []) {
      if (account.type !== 'depository') continue;
      for (const tx of account.transactions || []) {
        if (!tx.date) continue;
        const d = new Date(tx.date);
        if (isNaN(d.getTime())) continue;
        if (!isIncomeTransaction(tx)) continue;
        total += Math.abs(Number(tx.amount) || 0);
        count += 1;
        if (!earliest || d < earliest) earliest = d;
        if (!latest || d > latest) latest = d;
      }
    }
  }

  if (count === 0 || !earliest || !latest) {
    return { annualIncome: 0, monthlyAverage: 0, monthsCovered: 0, itemCount: 0 };
  }

  // Months covered = span between the first and last detected income tx.
  // Floored at 1 month so a single paycheck doesn't divide by ~0.
  const spanMs = latest.getTime() - earliest.getTime();
  const monthsCovered = Math.max(
    1,
    Math.round((spanMs / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10
  );

  const monthlyAverage = total / monthsCovered;
  const annualIncome = monthlyAverage * 12;

  return {
    annualIncome: Math.round(annualIncome),
    monthlyAverage: Math.round(monthlyAverage),
    monthsCovered,
    itemCount: count,
  };
}

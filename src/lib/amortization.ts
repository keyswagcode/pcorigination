// Standard fixed-rate amortization. Pure functions; no DB, no React.
//
// Formula: M = P · r(1+r)^n / ((1+r)^n − 1)
//   where P = principal, r = periodic rate (annual_rate / payments_per_year),
//   n = total payment count.

export interface AmortizationInput {
  principal: number;
  annualInterestRate: number;    // decimal, e.g. 0.07250 for 7.25%
  amortizationTermMonths: number;
  paymentsPerYear?: number;       // default 12 (monthly)
}

export interface AmortizationRow {
  paymentNumber: number;
  dueDate: string;                // ISO yyyy-mm-dd
  scheduledPrincipal: number;
  scheduledInterest: number;
  scheduledEscrow: number;
  scheduledTotal: number;
  endingBalance: number;
}

export interface GenerateScheduleInput extends AmortizationInput {
  firstPaymentDate: string;       // ISO yyyy-mm-dd
  loanTermMonths?: number;        // for balloons; defaults to amortization term
  escrowMonthly?: number;         // taxes + insurance combined
}

/**
 * Standard monthly payment for a fixed-rate loan. Excludes escrow.
 * Returns dollars (not cents). Two-decimal rounded.
 */
export function monthlyPayment(input: AmortizationInput): number {
  const { principal, annualInterestRate, amortizationTermMonths } = input;
  const n = amortizationTermMonths;
  const r = (annualInterestRate || 0) / (input.paymentsPerYear || 12);

  if (n <= 0) throw new Error('amortizationTermMonths must be > 0');
  if (principal <= 0) return 0;

  // r = 0 → interest-free, pure straight-line
  if (r === 0) return round2(principal / n);

  const factor = Math.pow(1 + r, n);
  const payment = principal * (r * factor) / (factor - 1);
  return round2(payment);
}

/**
 * Generate the full amortization schedule (one row per scheduled payment).
 * loanTermMonths < amortizationTermMonths → balloon: the final row's
 * principal includes the remaining balance.
 */
export function generateSchedule(input: GenerateScheduleInput): AmortizationRow[] {
  const principal = input.principal;
  const r = (input.annualInterestRate || 0) / (input.paymentsPerYear || 12);
  const amortN = input.amortizationTermMonths;
  const loanN = input.loanTermMonths ?? amortN;
  const escrow = round2(input.escrowMonthly || 0);

  if (amortN <= 0) throw new Error('amortizationTermMonths must be > 0');
  if (loanN > amortN) throw new Error('loanTermMonths cannot exceed amortizationTermMonths');

  const base = monthlyPayment(input);  // P + I only
  const rows: AmortizationRow[] = [];
  let balance = principal;

  for (let i = 1; i <= loanN; i++) {
    const interest = round2(balance * r);
    let principalPay = round2(base - interest);

    // Last scheduled payment of either the loan term (balloon) or the
    // amortization term — pay off the remaining balance exactly.
    const isLast = i === loanN;
    if (isLast) {
      principalPay = round2(balance);
    }

    // Edge case: tiny rounding over-payment in the last regular row
    if (principalPay > balance) principalPay = round2(balance);

    const endingBalance = round2(balance - principalPay);
    const total = round2(principalPay + interest + escrow);

    rows.push({
      paymentNumber: i,
      dueDate: addMonths(input.firstPaymentDate, i - 1),
      scheduledPrincipal: principalPay,
      scheduledInterest: interest,
      scheduledEscrow: escrow,
      scheduledTotal: total,
      endingBalance,
    });

    balance = endingBalance;
    if (balance <= 0) break;
  }

  return rows;
}

/**
 * Per-diem interest for payoff calculations.
 * Standard 360-day count (most loan docs use this; switch to 365 if needed).
 */
export function perDiemInterest(currentPrincipal: number, annualInterestRate: number, dayBasis: 360 | 365 = 360): number {
  if (currentPrincipal <= 0 || annualInterestRate <= 0) return 0;
  return round2(currentPrincipal * annualInterestRate / dayBasis);
}

/**
 * Maturity date = first_payment_date + (loan_term_months - 1) months.
 * E.g. 360-month loan with first payment 2026-06-01 matures 2056-05-01.
 */
export function maturityDateFrom(firstPaymentDate: string, loanTermMonths: number): string {
  return addMonths(firstPaymentDate, loanTermMonths - 1);
}

// ---------------- helpers ----------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Add N calendar months to an ISO yyyy-mm-dd date, preserving the day
 * when possible (clamping for shorter months e.g. Jan 31 + 1mo = Feb 28).
 */
export function addMonths(isoDate: string, months: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Invalid ISO date: ${isoDate}`);
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);

  // 0-indexed month math
  const targetMonth0 = mo - 1 + months;
  const targetYear = y + Math.floor(targetMonth0 / 12);
  const targetMo0 = ((targetMonth0 % 12) + 12) % 12;
  const lastDayOfTarget = new Date(targetYear, targetMo0 + 1, 0).getDate();
  const targetDay = Math.min(d, lastDayOfTarget);

  return `${targetYear.toString().padStart(4, '0')}-${(targetMo0 + 1).toString().padStart(2, '0')}-${targetDay.toString().padStart(2, '0')}`;
}

import jsPDF from 'jspdf';
import { perDiemInterest } from './amortization';

// ============================================
// Payoff Statement PDF generator
// Lender-facing statement showing the exact amount required to pay off
// the loan as of a given date. Per-diem interest accrues until payoff.
// ============================================

export interface PayoffStatementInput {
  orgName: string;
  orgLogoUrl: string | null;
  borrowerName: string;
  loanNumber: string;
  propertyAddress: string;
  currentPrincipal: number;
  interestRate: number;          // decimal
  lastPaidThroughDate: string | null;  // ISO yyyy-mm-dd
  payoffDate: string;            // ISO yyyy-mm-dd (good-through date)
  escrowBalance: number;         // negative if borrower owes; positive credits back
  unpaidLateFees: number;
  recordingFee?: number;         // typical $20-50 for satisfaction-of-mortgage
  goodThroughDays?: number;      // how many days the quote is honored, default 30
  remitToName: string;
  remitToAddress: string;
  remitToWireInstructions?: string;
}

export async function generatePayoffStatementPdf(opts: PayoffStatementInput, fileName?: string): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
  const fmtDate = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // Header
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 46);
  doc.text(opts.orgName, margin, y);
  y += 26;

  doc.setFontSize(16);
  doc.setTextColor(80, 80, 96);
  doc.text('Payoff Statement', margin, y);
  y += 24;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 130);
  doc.text(`Issued ${fmtDate(new Date().toISOString().slice(0, 10))}`, margin, y);
  y += 16;
  doc.text(`Good through ${fmtDate(opts.payoffDate)} (${opts.goodThroughDays || 30} days)`, margin, y);
  y += 24;

  // Borrower + loan block
  doc.setDrawColor(220, 224, 230);
  doc.setLineWidth(0.6);
  doc.line(margin, y, margin + contentWidth, y);
  y += 14;

  const labelCol = margin;
  const valueCol = margin + 170;
  const writeRow = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 120);
    doc.text(label, labelCol, y);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(30, 30, 46);
    doc.text(value, valueCol, y);
    y += 16;
  };

  writeRow('Borrower', opts.borrowerName);
  writeRow('Loan Number', opts.loanNumber);
  writeRow('Property', opts.propertyAddress || '—');
  if (opts.lastPaidThroughDate) writeRow('Paid Through', fmtDate(opts.lastPaidThroughDate));
  writeRow('Interest Rate', `${(opts.interestRate * 100).toFixed(4)}%`);
  y += 12;

  // Payoff breakdown
  doc.line(margin, y, margin + contentWidth, y);
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 46);
  doc.text('Payoff Breakdown', margin, y);
  y += 18;

  const daysToPayoff = daysBetween(opts.lastPaidThroughDate || new Date().toISOString().slice(0, 10), opts.payoffDate);
  const perDiem = perDiemInterest(opts.currentPrincipal, opts.interestRate);
  const accruedInterest = round2(perDiem * Math.max(0, daysToPayoff));

  writeRow('Principal Balance', fmtCurrency(opts.currentPrincipal));
  writeRow(`Interest (${daysToPayoff} days × ${fmtCurrency(perDiem)}/day)`, fmtCurrency(accruedInterest));
  if (opts.unpaidLateFees > 0) writeRow('Late Fees', fmtCurrency(opts.unpaidLateFees));
  if (opts.recordingFee && opts.recordingFee > 0) writeRow('Recording / Satisfaction Fee', fmtCurrency(opts.recordingFee));
  if (opts.escrowBalance !== 0) {
    writeRow('Escrow Balance', opts.escrowBalance >= 0 ? `(${fmtCurrency(opts.escrowBalance)}) credit` : fmtCurrency(Math.abs(opts.escrowBalance)));
  }

  const total = round2(
    opts.currentPrincipal +
    accruedInterest +
    opts.unpaidLateFees +
    (opts.recordingFee || 0) -
    Math.max(0, opts.escrowBalance)
  );

  y += 8;
  doc.line(margin, y, margin + contentWidth, y);
  y += 16;
  writeRow('TOTAL PAYOFF AMOUNT', fmtCurrency(total), true);
  y += 8;

  // Remit-to block
  doc.line(margin, y, margin + contentWidth, y);
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Remit Payment To', margin, y);
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 46);
  for (const line of opts.remitToName.split('\n')) { doc.text(line, margin, y); y += 14; }
  for (const line of opts.remitToAddress.split('\n')) { doc.text(line, margin, y); y += 14; }
  if (opts.remitToWireInstructions) {
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.text('Wire Instructions', margin, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    for (const line of opts.remitToWireInstructions.split('\n')) { doc.text(line, margin, y); y += 14; }
  }

  // Footer disclaimer
  y += 18;
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 150);
  const disclaimer = `This statement is provided in response to a request for payoff information. The Total Payoff Amount above is good through ${fmtDate(opts.payoffDate)}. After that date, additional interest of ${fmtCurrency(perDiem)} per day will accrue. Funds received after the good-through date may be returned and a new payoff statement requested. This is not a payoff in full and does not constitute a release of lien until funds are received and applied.`;
  const lines = doc.splitTextToSize(disclaimer, contentWidth);
  doc.text(lines, margin, y);

  const safeName = (opts.borrowerName || 'borrower').replace(/[^a-zA-Z0-9]+/g, '_');
  doc.save(fileName || `payoff_statement_${opts.loanNumber}_${safeName}_${opts.payoffDate}.pdf`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(isoStart: string, isoEnd: string): number {
  const s = new Date(isoStart + 'T00:00:00Z').getTime();
  const e = new Date(isoEnd + 'T00:00:00Z').getTime();
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}

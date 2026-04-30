import jsPDF from 'jspdf';

interface Transaction {
  date?: string;
  amount?: number;
  description?: string;
  name?: string;
  original_description?: string;
  merchant_name?: string;
  category?: string[];
}

interface Account {
  account_id?: string;
  name?: string;
  official_name?: string;
  type?: string;
  subtype?: string;
  mask?: string;
  balances?: { current?: number | null; available?: number | null };
  transactions?: Transaction[];
}

interface Item {
  institution_id?: string;
  institution_name?: string;
  accounts?: Account[];
}

interface PlaidReport {
  items?: Item[];
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const fmtDate = (d: string) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

interface BuildOptions {
  borrowerName: string;
  orgName: string;
  monthsToCover: number;
}

interface MonthBucket {
  year: number;
  month: number;
  label: string;
  start: Date;
  end: Date;
  transactions: Transaction[];
  startBalance: number | null;
  endBalance: number | null;
  totalDeposits: number;
  totalWithdrawals: number;
}

function bucketByMonth(transactions: Transaction[], months: number): MonthBucket[] {
  const now = new Date();
  const buckets: MonthBucket[] = [];
  for (let i = 0; i < months; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59);
    buckets.push({
      year: ref.getFullYear(),
      month: ref.getMonth(),
      label: ref.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      start,
      end,
      transactions: [],
      startBalance: null,
      endBalance: null,
      totalDeposits: 0,
      totalWithdrawals: 0,
    });
  }

  for (const tx of transactions) {
    if (!tx.date) continue;
    const d = new Date(tx.date);
    if (isNaN(d.getTime())) continue;
    const bucket = buckets.find(b => d >= b.start && d <= b.end);
    if (!bucket) continue;
    bucket.transactions.push(tx);
    const amount = Number(tx.amount) || 0;
    if (amount < 0) bucket.totalDeposits += Math.abs(amount);
    else bucket.totalWithdrawals += amount;
  }

  return buckets.filter(b => b.transactions.length > 0);
}

export function generateStatementsPdf(report: PlaidReport, opts: BuildOptions): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  const items = report.items || [];
  const depositoryAccounts: { account: Account; institution: string }[] = [];
  for (const item of items) {
    for (const acct of item.accounts || []) {
      if (acct.type === 'depository') {
        depositoryAccounts.push({ account: acct, institution: item.institution_name || item.institution_id || 'Unknown Bank' });
      }
    }
  }

  if (depositoryAccounts.length === 0) {
    doc.setFontSize(14);
    doc.text('No depository accounts found in the verified report.', margin, 100);
    doc.save(`statements-${opts.borrowerName.replace(/\s+/g, '_')}.pdf`);
    return;
  }

  let firstPage = true;

  for (const { account, institution } of depositoryAccounts) {
    const buckets = bucketByMonth(account.transactions || [], opts.monthsToCover);
    if (buckets.length === 0) continue;

    for (const bucket of buckets) {
      if (!firstPage) doc.addPage();
      firstPage = false;
      let y = margin;

      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(30, 30, 46);
      doc.text(opts.orgName, margin, y);
      y += 22;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(110, 110, 130);
      doc.text('Verified Bank Statement', margin, y);
      y += 24;

      // Account block
      doc.setDrawColor(220, 220, 230);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 16;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 30, 46);
      doc.text('Account Holder:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(opts.borrowerName, margin + 110, y);
      y += 16;

      doc.setFont('helvetica', 'bold');
      doc.text('Institution:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(institution, margin + 110, y);
      y += 16;

      doc.setFont('helvetica', 'bold');
      doc.text('Account:', margin, y);
      doc.setFont('helvetica', 'normal');
      const acctLabel = `${account.official_name || account.name || 'Account'}${account.mask ? ` ••${account.mask}` : ''} (${account.subtype || account.type})`;
      doc.text(acctLabel, margin + 110, y);
      y += 16;

      doc.setFont('helvetica', 'bold');
      doc.text('Statement Period:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(`${fmtDate(bucket.start.toISOString())} – ${fmtDate(bucket.end.toISOString())}`, margin + 110, y);
      y += 22;

      // Summary
      doc.setDrawColor(220, 220, 230);
      doc.line(margin, y, pageWidth - margin, y);
      y += 16;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Period Summary', margin, y);
      y += 16;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const summaryRows: [string, string][] = [
        ['Total Deposits', fmtCurrency(bucket.totalDeposits)],
        ['Total Withdrawals', fmtCurrency(bucket.totalWithdrawals)],
        ['Net Change', fmtCurrency(bucket.totalDeposits - bucket.totalWithdrawals)],
      ];
      if (account.balances?.current != null) {
        summaryRows.push(['Current Balance (as of report)', fmtCurrency(account.balances.current)]);
      }
      if (account.balances?.available != null) {
        summaryRows.push(['Available Balance (as of report)', fmtCurrency(account.balances.available)]);
      }
      for (const [label, value] of summaryRows) {
        doc.text(label, margin, y);
        doc.text(value, pageWidth - margin, y, { align: 'right' });
        y += 14;
      }
      y += 10;

      // Transactions table
      doc.setDrawColor(220, 220, 230);
      doc.line(margin, y, pageWidth - margin, y);
      y += 16;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Transactions', margin, y);
      y += 14;

      // Column headers
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 130);
      doc.text('Date', margin, y);
      doc.text('Description', margin + 70, y);
      doc.text('Amount', pageWidth - margin, y, { align: 'right' });
      y += 6;
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(40, 40, 60);

      const sorted = [...bucket.transactions].sort((a, b) => {
        const da = new Date(a.date || '').getTime();
        const db = new Date(b.date || '').getTime();
        return db - da;
      });

      for (const tx of sorted) {
        if (y > pageHeight - 60) {
          doc.addPage();
          y = margin;
        }
        const amount = Number(tx.amount) || 0;
        const isDeposit = amount < 0;
        const amountStr = isDeposit ? fmtCurrency(Math.abs(amount)) : `-${fmtCurrency(amount)}`;
        const descSource = tx.merchant_name || tx.name || tx.description || tx.original_description || '—';
        const descLines = doc.splitTextToSize(descSource, contentWidth - 180);

        doc.text(fmtDate(tx.date || ''), margin, y);
        doc.text(descLines, margin + 70, y);
        doc.setTextColor(isDeposit ? 16 : 180, isDeposit ? 130 : 50, isDeposit ? 100 : 50);
        doc.text(amountStr, pageWidth - margin, y, { align: 'right' });
        doc.setTextColor(40, 40, 60);
        y += descLines.length * 11 + 4;
      }

      // Footer
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 160);
      doc.text(
        `Generated from Plaid Check verified report · ${new Date().toLocaleDateString('en-US')} · ${opts.orgName}`,
        pageWidth / 2,
        pageHeight - 30,
        { align: 'center' }
      );
    }
  }

  doc.save(`statements-${opts.borrowerName.replace(/\s+/g, '_')}.pdf`);
}

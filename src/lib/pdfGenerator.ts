interface PdfOptions {
  borrowerName: string;
  borrowerType: string;
  entityName?: string;
  loanAmount: number;
  qualificationMin: number;
  qualificationMax: number;
  loanType: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  purchasePrice: number;
  verifiedLiquidity: number;
  requiredLiquidity: number;
  passesLiquidityCheck: boolean;
  conditions: string[];
  placerBotConditions: { category: string; condition: string; severity: string }[];
  matchedPrograms: { lenderName: string; programName: string; fitCategory: string; matchScore: number }[];
  issueDate: string;
  expirationDate: string;
  letterNumber: string;
  dscr?: number | null;
  ltv?: number | null;
  creditScore?: number | null;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

function generateApprovalId(): string {
  const prefix = 'CL';
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${timestamp}${random}`;
}

export function generatePreApprovalPdfHtml(opts: PdfOptions): string {
  const approvalId = generateApprovalId();

  const programs = opts.matchedPrograms
    .slice(0, 3)
    .map(p => {
      const fitBadge = p.fitCategory === 'strong_fit' ? 'Excellent Match' :
                       p.fitCategory === 'good_fit' ? 'Good Match' :
                       p.fitCategory === 'conditional_fit' ? 'Conditional' : 'Review Required';
      return `
        <div class="program-card">
          <div class="program-name">${p.lenderName}</div>
          <div class="program-detail">${p.programName}</div>
          <div class="program-score">
            <span class="score-badge">${p.matchScore}</span>
            <span class="fit-label">${fitBadge}</span>
          </div>
        </div>
      `;
    })
    .join('');

  const conditionsList = opts.conditions
    .map(c => `<li>${c}</li>`)
    .join('');

  const topProgram = opts.matchedPrograms[0];

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pre-Approval Letter | ${opts.letterNumber}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
      max-width: 850px;
      margin: 0 auto;
      padding: 48px 40px;
      color: #1a1a2e;
      line-height: 1.6;
      background: #fff;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 24px;
      border-bottom: 3px solid #0d9488;
      margin-bottom: 32px;
    }

    .logo {
      font-size: 28px;
      font-weight: 700;
      color: #0d9488;
      letter-spacing: -0.5px;
    }

    .logo-sub {
      font-size: 11px;
      color: #64748b;
      font-weight: 400;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-top: 2px;
    }

    .header-right {
      text-align: right;
      font-size: 13px;
      color: #64748b;
    }

    .header-right strong {
      color: #1a1a2e;
      display: block;
      font-size: 14px;
    }

    .title-section {
      text-align: center;
      margin-bottom: 32px;
    }

    .doc-title {
      font-size: 26px;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 8px;
    }

    .approval-badge {
      display: inline-block;
      background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
      color: white;
      padding: 6px 20px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .meta-row {
      display: flex;
      justify-content: center;
      gap: 24px;
      margin-top: 16px;
      font-size: 13px;
      color: #64748b;
    }

    .meta-row span { display: flex; align-items: center; gap: 6px; }

    .greeting {
      font-size: 15px;
      margin-bottom: 24px;
    }

    .amount-section {
      background: linear-gradient(135deg, #f0fdfa 0%, #ecfdf5 100%);
      border: 2px solid #0d9488;
      border-radius: 12px;
      padding: 28px;
      text-align: center;
      margin-bottom: 28px;
    }

    .amount-label {
      font-size: 13px;
      color: #0f766e;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .amount-value {
      font-size: 48px;
      font-weight: 700;
      color: #0d9488;
      letter-spacing: -1px;
    }

    .amount-range {
      font-size: 14px;
      color: #64748b;
      margin-top: 8px;
    }

    .amount-range strong { color: #1a1a2e; }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #0f766e;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
    }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }

    .detail-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
    }

    .detail-label {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .detail-value {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a2e;
    }

    .detail-value.pass { color: #059669; }
    .detail-value.fail { color: #d97706; }
    .detail-value.highlight { color: #0d9488; }

    .programs-section { margin-bottom: 28px; }

    .programs-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .program-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }

    .program-name {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a2e;
      margin-bottom: 2px;
    }

    .program-detail {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 8px;
    }

    .program-score {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .score-badge {
      background: #0d9488;
      color: white;
      font-size: 12px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .fit-label {
      font-size: 11px;
      color: #64748b;
    }

    .lender-network {
      background: #1a1a2e;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
    }

    .lender-network-label {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .lender-network-name {
      font-size: 16px;
      font-weight: 600;
    }

    .conditions-section { margin-bottom: 28px; }

    .conditions-list {
      list-style: none;
      padding: 0;
    }

    .conditions-list li {
      position: relative;
      padding: 8px 0 8px 24px;
      font-size: 14px;
      color: #475569;
      border-bottom: 1px solid #f1f5f9;
    }

    .conditions-list li:before {
      content: "\\2713";
      position: absolute;
      left: 0;
      color: #0d9488;
      font-weight: 700;
    }

    .conditions-list li:last-child { border-bottom: none; }

    .signature-section {
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid #e2e8f0;
    }

    .signature-text {
      font-size: 14px;
      color: #475569;
      margin-bottom: 24px;
    }

    .signature-line {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .signature-block {
      text-align: left;
    }

    .signature-name {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a2e;
    }

    .signature-title {
      font-size: 13px;
      color: #64748b;
    }

    .footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
      line-height: 1.8;
    }

    .footer-id {
      font-family: monospace;
      background: #f1f5f9;
      padding: 2px 8px;
      border-radius: 4px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">ClearLend</div>
      <div class="logo-sub">Lending Partner Network</div>
    </div>
    <div class="header-right">
      <strong>Letter #${opts.letterNumber}</strong>
      Approval ID: ${approvalId}
    </div>
  </div>

  <div class="title-section">
    <div class="doc-title">Pre-Approval Letter</div>
    <div class="approval-badge">Conditionally Approved</div>
    <div class="meta-row">
      <span>Issued: ${opts.issueDate}</span>
      <span>Valid Until: ${opts.expirationDate}</span>
    </div>
  </div>

  <div class="greeting">
    Dear ${opts.borrowerName}${opts.entityName ? ` (${opts.entityName})` : ''},
  </div>

  <p style="font-size: 15px; margin-bottom: 24px; color: #475569;">
    We are pleased to inform you that based on the information provided and our automated underwriting analysis,
    you have been <strong style="color: #0d9488;">pre-approved</strong> for financing under the following terms:
  </p>

  <div class="amount-section">
    <div class="amount-label">Pre-Approved Loan Amount</div>
    <div class="amount-value">${fmt(opts.loanAmount)}</div>
    <div class="amount-range">
      Qualification Range: <strong>${fmt(opts.qualificationMin)}</strong> – <strong>${fmt(opts.qualificationMax)}</strong>
    </div>
  </div>

  <div class="section-title">Loan Details</div>
  <div class="details-grid">
    <div class="detail-card">
      <div class="detail-label">Loan Type</div>
      <div class="detail-value highlight">${opts.loanType}</div>
    </div>
    <div class="detail-card">
      <div class="detail-label">Purchase Price</div>
      <div class="detail-value">${fmt(opts.purchasePrice)}</div>
    </div>
    <div class="detail-card">
      <div class="detail-label">Property Address</div>
      <div class="detail-value" style="font-size: 14px;">${opts.propertyAddress}<br/>${opts.propertyCity}, ${opts.propertyState} ${opts.propertyZip}</div>
    </div>
    <div class="detail-card">
      <div class="detail-label">Verified Liquidity</div>
      <div class="detail-value ${opts.passesLiquidityCheck ? 'pass' : 'fail'}">${fmt(opts.verifiedLiquidity)}</div>
    </div>
    ${opts.dscr ? `
    <div class="detail-card">
      <div class="detail-label">DSCR Ratio</div>
      <div class="detail-value highlight">${opts.dscr.toFixed(2)}</div>
    </div>
    ` : ''}
    ${opts.ltv ? `
    <div class="detail-card">
      <div class="detail-label">Loan-to-Value</div>
      <div class="detail-value">${opts.ltv.toFixed(1)}%</div>
    </div>
    ` : ''}
  </div>

  ${topProgram ? `
  <div class="lender-network">
    <div>
      <div class="lender-network-label">Approved Through</div>
      <div class="lender-network-name">${topProgram.lenderName} — ${topProgram.programName}</div>
    </div>
    <div class="score-badge" style="font-size: 14px; padding: 4px 12px;">${topProgram.matchScore}</div>
  </div>
  ` : ''}

  ${programs ? `
  <div class="programs-section">
    <div class="section-title">Alternative Lender Matches</div>
    <div class="programs-grid">${programs}</div>
  </div>
  ` : ''}

  ${conditionsList ? `
  <div class="conditions-section">
    <div class="section-title">Conditions for Final Approval</div>
    <ul class="conditions-list">${conditionsList}</ul>
  </div>
  ` : ''}

  <div class="signature-section">
    <p class="signature-text">
      This pre-approval is subject to final underwriting review, verification of all submitted documentation,
      property appraisal, and lender approval. We look forward to assisting you with your financing needs.
    </p>
    <div class="signature-line">
      <div class="signature-block">
        <div class="signature-name">ClearLend Underwriting Team</div>
        <div class="signature-title">Lending Partner Network</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div>This is not a commitment to lend. Rates, terms, and conditions are subject to change without notice.</div>
    <div>Equal Housing Lender | NMLS #XXXXXX</div>
    <div style="margin-top: 8px;">
      Document ID: <span class="footer-id">${approvalId}</span> |
      Letter: <span class="footer-id">${opts.letterNumber}</span>
    </div>
  </div>
</body>
</html>`;
}

export function downloadPdf(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openPdfPreview(html: string): void {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

export function openPdfPrintPreview(html: string): void {
  const win = window.open('', '_blank');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 500);
  }
}

export function openPdfAsBlob(html: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

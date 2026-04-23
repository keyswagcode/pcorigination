import jsPDF from 'jspdf';

// ============================================
// Real PDF Pre-Approval Letter Generator
// ============================================

export interface PreApprovalPdfOptions {
  orgName: string;
  orgLogoUrl: string | null;
  borrowerName: string;
  llcName: string | null;
  preApprovalAmount: number;
  loanType: string;
  loanPurpose: string;
  occupancy: string;
  propertyType: string;
  verifiedLiquidity: number;
  creditScore: number | null;
  expirationDate: string;
  brokerName: string;
  brokerEmail: string | null;
  brokerPhone: string | null;
  issueDate: string;
  conditions: string[];
}

const LOAN_TYPE_DISPLAY: Record<string, string> = {
  dscr: 'DSCR Rental Loan',
  fix_flip: 'Fix & Flip Loan',
  bridge: 'Bridge Loan',
};

async function loadImage(url: string): Promise<{ data: string; format: string; width: number; height: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = blob.type.toLowerCase();
    let format = 'PNG';
    if (type.includes('jpeg') || type.includes('jpg')) format = 'JPEG';
    else if (type.includes('webp')) format = 'WEBP';
    else if (type.includes('png')) format = 'PNG';
    else if (type.includes('svg')) return null; // jsPDF can't render SVG directly

    const data = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!data) return null;

    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ data, format, width: img.width, height: img.height });
      img.onerror = () => resolve(null);
      img.src = data;
    });
  } catch {
    return null;
  }
}

export async function generatePreApprovalPdf(opts: PreApprovalPdfOptions): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 60;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

  const labelCol = margin;
  const valueCol = margin + 160;

  // --- COMPANY LOGO ---
  const renderOrgTextHeader = () => {
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 46);
    doc.text(opts.orgName || 'Pre-Approval Letter', margin, y + 20);
    y += 40;
  };

  let renderedLogo = false;
  if (opts.orgLogoUrl) {
    const logo = await loadImage(opts.orgLogoUrl);
    if (logo) {
      const maxW = 200, maxH = 60;
      const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
      const w = logo.width * scale;
      const h = logo.height * scale;
      try {
        doc.addImage(logo.data, logo.format, margin, y, w, h);
        y += h + 15;
        renderedLogo = true;
      } catch (err) {
        console.warn('Failed to embed logo in PDF', err);
      }
    }
  }
  if (!renderedLogo) renderOrgTextHeader();

  // --- RE: LINE ---
  y += 10;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 46);
  const purposeLabel = opts.loanPurpose === 'refinance' ? 'Refinance' : 'Purchase';
  doc.text(`RE: Conditional Approval to ${purposeLabel}:`, margin, y);
  y += 24;

  // --- CONGRATULATIONS PARAGRAPH ---
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  const congrats = `Congratulations! After reviewing your application we have determined that your credit meets our requirements to conditionally approve you for a loan subject to the conditions below. While you're moving forward with the ${purposeLabel.toLowerCase()} of your new home, you may present a copy of this letter as proof to sellers and real estate agents that you're a qualified buyer subject to the conditions stated in this letter.`;
  const congratsLines = doc.splitTextToSize(congrats, contentWidth);
  doc.text(congratsLines, margin, y);
  y += congratsLines.length * 15 + 20;

  // --- BORROWER DETAILS TABLE ---
  const drawDetailRow = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 46);
    doc.text(`${label}:`, labelCol, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, valueCol, y);
    y += 20;
  };

  const displayName = opts.llcName || opts.borrowerName;
  drawDetailRow('Name', displayName);
  drawDetailRow('Loan Purpose', purposeLabel);
  drawDetailRow('Occupancy', opts.occupancy || 'Investment');
  drawDetailRow('Loan Type', LOAN_TYPE_DISPLAY[opts.loanType] || opts.loanType);
  drawDetailRow('Property Type', opts.propertyType || 'SFR');
  drawDetailRow('Date', opts.issueDate);

  y += 16;

  // --- ESTIMATED PURCHASE PRICE ---
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 46);
  const priceLabel = opts.loanPurpose === 'refinance' ? 'Estimated As-Is Value:' : 'Estimated Purchase Price:';
  doc.text(priceLabel, labelCol, y);
  doc.setFontSize(13);
  doc.text(fmtCurrency(opts.preApprovalAmount), valueCol + 40, y);

  y += 40;

  // --- CONDITIONS SECTION ---
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  const conditionsIntro = 'To continue with the process of obtaining loan approval, you will need to satisfy the following conditions:';
  const condIntroLines = doc.splitTextToSize(conditionsIntro, contentWidth);
  doc.text(condIntroLines, margin, y);
  y += condIntroLines.length * 15 + 12;

  const conditions = [
    `Within 30 calendar days from the date of this letter, deliver a fully executed ${purposeLabel.toLowerCase()} contract for your proposed subject property and your authorization to order an appraisal.`,
    `The subject property will need to meet our normal and customary requirements for determining value, condition and title.`,
    `Provide any necessary information required to complete your application.`,
    `Your creditworthiness and financial position must not change materially and must meet ${opts.orgName}'s full lending qualifications.`,
    `Satisfy all of ${opts.orgName}'s pre-closing and pre-funding loan conditions that are required to close and fund the loan.`,
  ];

  for (const condition of conditions) {
    const bullet = '•  ';
    const condLines = doc.splitTextToSize(condition, contentWidth - 20);
    doc.text(bullet, margin, y);
    doc.text(condLines, margin + 16, y);
    y += condLines.length * 14 + 8;
  }

  y += 16;

  // --- DISCLAIMER ---
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(120, 120, 120);
  const disclaimer = 'Your inquiry is not considered an application for credit until such time as you have chosen a property and locked your loan, the interest rate and loan terms detailed above may change. This is not an offer or commitment to extend credit.';
  const discLines = doc.splitTextToSize(disclaimer, contentWidth);
  doc.text(discLines, margin, y);

  // --- AE CONTACT INFO ---
  y += 20;
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 46);
  doc.text(opts.brokerName, margin, y);
  y += 16;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  if (opts.brokerEmail) {
    doc.text(opts.brokerEmail, margin, y);
    y += 14;
  }
  if (opts.brokerPhone) {
    doc.text(opts.brokerPhone, margin, y);
    y += 14;
  }
  doc.text(opts.orgName, margin, y);

  // --- FOOTER ---
  const footerY = doc.internal.pageSize.getHeight() - 30;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 160, 160);
  doc.text(`${opts.orgName} | Equal Housing Lender`, pageWidth / 2, footerY, { align: 'center' });

  // Download
  const filename = `Pre-Approval_${opts.loanType}_${(opts.llcName || opts.borrowerName).replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}

// ============================================
// Legacy HTML-based PDF generator (kept for backward compatibility)
// ============================================

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
  orgName?: string;
  orgLogoUrl?: string | null;
}

export async function fetchOrgBrandingForBorrower(borrowerId?: string): Promise<{ orgName: string; orgLogoUrl: string | null }> {
  const { supabase } = await import('./supabase');
  const fallback = { orgName: 'Key Real Estate Capital', orgLogoUrl: null };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return fallback;

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-branding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(borrowerId ? { borrower_id: borrowerId } : {}),
      }
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      orgName: data.orgName || fallback.orgName,
      orgLogoUrl: data.orgLogoUrl || null,
    };
  } catch {
    return fallback;
  }
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
      ${opts.orgLogoUrl
        ? `<img src="${opts.orgLogoUrl}" alt="${opts.orgName || ''}" style="max-height: 56px; max-width: 220px; object-fit: contain;" />`
        : `<div class="logo">${opts.orgName || 'Key Real Estate Capital'}</div><div class="logo-sub">Lending Partner</div>`
      }
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
        <div class="signature-name">${opts.orgName || 'Underwriting Team'}</div>
        <div class="signature-title">Underwriting</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div>This is not a commitment to lend. Rates, terms, and conditions are subject to change without notice.</div>
    <div>${opts.orgName || 'Equal Housing Lender'} | Equal Housing Lender</div>
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

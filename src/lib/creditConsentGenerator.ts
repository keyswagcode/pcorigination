import { jsPDF } from 'jspdf';

// ============================================
// Credit Report Authorization & Consent record.
//
// Generated when a borrower affirmatively checks the credit-consent box on
// their profile. Produces a PDF that documents the authorization (who, when,
// the exact language they agreed to, and that it was an electronic consent) so
// there's an auditable record in the borrower's Documents tab proving they
// consented to the (soft) credit pull.
// ============================================

// Canonical authorization language — keep in sync with the consent checkbox
// shown on the borrower application/profile form.
export const CREDIT_CONSENT_TEXT =
  'I authorize Key Real Estate Capital and its affiliates to obtain my credit report from one or more ' +
  'consumer reporting agencies for the purpose of evaluating my eligibility for a mortgage loan. I understand ' +
  'this will be a soft credit inquiry that will not affect my credit score. I consent to the collection and use ' +
  'of my personal information, including my Social Security Number, for credit evaluation purposes.';

export interface CreditConsentInput {
  borrowerName: string;
  email?: string | null;
  ssnLast4?: string | null;
  address?: string | null; // single-line "street, city, ST zip"
  consentedAt: string; // ISO timestamp
  orgName?: string; // defaults to Key Real Estate Capital
  consentText?: string; // defaults to CREDIT_CONSENT_TEXT
  fileName?: string;
}

function buildConsentDoc(input: CreditConsentInput): jsPDF {
  const orgName = input.orgName || 'Key Real Estate Capital';
  const consentText = input.consentText || CREDIT_CONSENT_TEXT;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 56;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 40);
  doc.text(orgName, margin, y);
  y += 22;

  doc.setFontSize(13);
  doc.setTextColor(13, 148, 136); // teal
  doc.text('Credit Report Authorization & Consent', margin, y);
  y += 10;

  doc.setDrawColor(220, 220, 224);
  doc.line(margin, y, pageWidth - margin, y);
  y += 26;

  // Consented date (human-readable, from the ISO timestamp)
  const when = formatTimestamp(input.consentedAt);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 100);
  doc.text(`Date of authorization: ${when}`, margin, y);
  y += 24;

  // Applicant details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 40);
  doc.text('Applicant', margin, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 55);
  const rows: Array<[string, string]> = [
    ['Name', input.borrowerName || '—'],
  ];
  if (input.email) rows.push(['Email', input.email]);
  if (input.ssnLast4) rows.push(['SSN', `***-**-${input.ssnLast4}`]);
  if (input.address) rows.push(['Address', input.address]);
  for (const [label, value] of rows) {
    doc.setTextColor(110, 110, 120);
    doc.text(`${label}:`, margin, y);
    doc.setTextColor(30, 30, 46);
    doc.text(String(value), margin + 90, y, { maxWidth: contentWidth - 90 });
    y += 18;
  }
  y += 12;

  // Authorization statement
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 40);
  doc.text('Authorization', margin, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(40, 40, 55);
  const lines = doc.splitTextToSize(consentText, contentWidth);
  doc.text(lines, margin, y, { lineHeightFactor: 1.5 });
  y += lines.length * 15.5 + 18;

  // Electronic consent affirmation box
  doc.setFillColor(244, 247, 247);
  doc.setDrawColor(200, 222, 220);
  const boxHeight = 70;
  doc.roundedRect(margin, y, contentWidth, boxHeight, 6, 6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(13, 148, 136);
  doc.text('Electronic Consent', margin + 14, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(60, 60, 75);
  const affirm = `The applicant named above affirmatively agreed to the authorization above by checking the ` +
    `credit-consent box on the online application on ${when}. This record was generated electronically ` +
    `at the time of consent.`;
  const affirmLines = doc.splitTextToSize(affirm, contentWidth - 28);
  doc.text(affirmLines, margin + 14, y + 38, { lineHeightFactor: 1.4 });
  y += boxHeight + 28;

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 160);
  doc.text(
    `This document is a record of electronic consent and does not require a wet signature. ${orgName}.`,
    margin,
    doc.internal.pageSize.getHeight() - margin,
    { maxWidth: contentWidth },
  );

  return doc;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

/** Returns the consent authorization as a PDF Blob (for upload/storage). */
export function creditConsentPdfToBlob(input: CreditConsentInput): Blob {
  return buildConsentDoc(input).output('blob');
}

/** Triggers a browser download of the consent PDF. */
export function downloadCreditConsentPdf(input: CreditConsentInput): void {
  const safeName = (input.borrowerName || 'borrower').replace(/[^a-zA-Z0-9]+/g, '_');
  buildConsentDoc(input).save(input.fileName || `credit_consent_${safeName}.pdf`);
}

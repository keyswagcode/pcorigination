/*
  Backfill credit-consent PDFs for borrowers who consented before the upload
  bug was fixed (uploaded_documents insert used a non-existent column, so the
  PDF never landed in Documents — silently, for every borrower).

  For each borrower with credit_consent = true and no existing credit_consent
  document: generate the same consent PDF the app produces (stamped with their
  actual credit_consent_at, falling back to created_at), upload it to the
  borrower-documents bucket under the canonical path, and record it in
  uploaded_documents.

  Run: npx tsx scripts/backfill-credit-consent-docs.ts
*/
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { creditConsentPdfToBlob } from '../src/lib/creditConsentGenerator';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_KEY);

async function main() {
  const { data: borrowers, error } = await supabase
    .from('borrowers')
    .select('id, user_id, borrower_name, email, ssn_last4, address_street, address_city, address_state, address_zip, credit_consent_at, created_at')
    .eq('credit_consent', true);
  if (error) throw error;

  const { data: existing } = await supabase
    .from('uploaded_documents')
    .select('borrower_id')
    .eq('document_type', 'credit_consent');
  const haveDoc = new Set((existing || []).map(d => d.borrower_id));

  let ok = 0, skipped = 0, failed = 0;
  for (const b of borrowers || []) {
    if (haveDoc.has(b.id)) { skipped++; continue; }
    try {
      const consentedAt = b.credit_consent_at || b.created_at;
      const blob = creditConsentPdfToBlob({
        borrowerName: b.borrower_name || 'Borrower',
        email: b.email,
        ssnLast4: b.ssn_last4,
        address: [b.address_street, b.address_city, b.address_state, b.address_zip].filter(Boolean).join(', ') || null,
        consentedAt,
      });
      const ts = String(consentedAt).replace(/[:.]/g, '-');
      const fileName = `credit_consent_${ts}.pdf`;
      const owner = b.user_id || b.id;
      const filePath = `borrowers/${owner}/credit_consent/${fileName}`;

      const bytes = Buffer.from(await blob.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from('borrower-documents')
        .upload(filePath, bytes, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from('uploaded_documents').insert({
        borrower_id: b.id,
        file_path: filePath,
        file_name: fileName,
        file_size: bytes.length,
        mime_type: 'application/pdf',
        document_type: 'credit_consent',
        processing_status: 'uploaded',
      });
      if (dbErr) throw dbErr;
      ok++;
      console.log(`OK   ${b.borrower_name} (${b.id}) — consent ${consentedAt}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${b.borrower_name} (${b.id}):`, (e as Error).message);
    }
  }
  console.log(`\nDone. created=${ok} already_had=${skipped} failed=${failed} of ${borrowers?.length ?? 0} consented borrowers`);
}

main().catch(e => { console.error(e); process.exit(1); });

import { Actor, log } from 'apify';
import { chromium } from 'playwright';

await Actor.init();

try {
  const input = (await Actor.getInput()) || {};
  const result = await runPullCredit(input);
  if (result.pdfBuffer) {
    await Actor.setValue('credit_report.pdf', result.pdfBuffer, { contentType: 'application/pdf' });
  }
  const { pdfBuffer: _omit, ...summary } = result;
  await Actor.setValue('OUTPUT', { ...summary, pdfKey: result.pdfBuffer ? 'credit_report.pdf' : null });
} catch (err) {
  await Actor.setValue('OUTPUT', { ok: false, error: err.message || String(err) });
  throw err;
} finally {
  await Actor.exit();
}

/**
 * Full ISC credit pull. Steps:
 *  1. Open ISC login page, fill broker's stored username + password, submit.
 *  2. Wait for the page to leave login.aspx. If MFA is challenged, the run
 *     is already exposing the live browser via Apify's `containerUrl`; the
 *     broker uses that URL to enter the SMS code. We just keep polling the
 *     URL until it leaves login.
 *  3. Navigate Credit Verification → Order Credit Report.
 *  4. Fill the borrower form (Loan Type=CONV, Marital Status=Not Disclosed,
 *     name, SSN, DOB, address, phone, email).
 *  5. Submit. If a payment screen appears, fill the broker-supplied card
 *     and confirm.
 *  6. Best-effort scrape scores from the result page.
 *  7. Download the PDF (or print the page as a fallback).
 */
async function runPullCredit(input) {
  const { iscUsername, iscPassword, borrower, card } = input;
  if (!iscUsername || !iscPassword) throw new Error('iscUsername and iscPassword are required');
  if (!borrower) throw new Error('borrower is required');
  for (const f of ['firstName', 'lastName', 'ssn', 'dob']) {
    if (!borrower[f]) throw new Error(`borrower.${f} is required`);
  }
  if (!card) throw new Error('card is required');
  for (const f of ['number', 'expMonth', 'expYear', 'cvc', 'zip']) {
    if (!card[f]) throw new Error(`card.${f} is required`);
  }

  const loginUrl = input.loginUrl || 'https://iscsite.meridianlink.com/custom/login.aspx';
  const mfaTimeoutMs = (input.mfaTimeoutSec || 300) * 1000;

  // Headed so Apify Live View can stream the browser to the broker if MFA is needed.
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const fail = async (stage, err) => {
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    if (screenshot) await Actor.setValue('error_screenshot.png', screenshot, { contentType: 'image/png' });
    throw new Error(`Stage "${stage}" failed: ${err?.message || err}`);
  };

  try {
    // 1. Login
    log.info(`Opening ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    try {
      await fillByCommonAttr(page, ['username', 'user', 'login', 'email'], iscUsername);
      await fillByCommonAttr(page, ['password', 'pass'], iscPassword);
      // Click any visible Login button (or fall back to Enter)
      const loginBtn = page.getByRole('button', { name: /^(login|sign in|log in|submit)$/i })
        .or(page.locator('input[type="submit"]'));
      if (await loginBtn.count() > 0) {
        await loginBtn.first().click({ timeout: 10_000 }).catch(() => {});
      } else {
        await page.keyboard.press('Enter');
      }
    } catch (err) {
      await fail('login_submit', err);
    }

    // 2. Wait for post-login. If MFA is challenged, broker clears it via Live View.
    log.info(`Waiting for post-login navigation (timeout ${mfaTimeoutMs / 1000}s — broker can use Live View if MFA is required)`);
    const start = Date.now();
    while (Date.now() - start < mfaTimeoutMs) {
      const url = page.url();
      if (url && !/login\.aspx/i.test(url)) {
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        if (!/login\.aspx/i.test(page.url())) break;
      }
      await page.waitForTimeout(2000);
    }
    if (/login\.aspx/i.test(page.url())) {
      throw new Error(`Login or MFA not completed within ${mfaTimeoutMs / 1000}s`);
    }
    log.info(`Past login: ${page.url()}`);

    // Snapshot the post-login page so we can iterate on selectors without a
    // round-trip to retrieve a screenshot. Always written, regardless of
    // whether the next stage succeeds.
    try {
      const { Actor } = await import('apify');
      const html = await page.content();
      const linkDump = await page.$$eval('a, button, [role="menuitem"], [role="link"]', els =>
        els.map(e => ({
          tag: e.tagName.toLowerCase(),
          text: (e.textContent || '').trim().slice(0, 200),
          href: e.getAttribute('href') || '',
          id: e.id || '',
          name: e.getAttribute('name') || '',
        })).filter(x => x.text).slice(0, 500)
      );
      await Actor.setValue('post_login_url.txt', page.url(), { contentType: 'text/plain' });
      await Actor.setValue('post_login_links.json', linkDump);
      await Actor.setValue('post_login.html', html, { contentType: 'text/html' });
      log.info(`Saved post-login snapshot: url, ${linkDump.length} links, ${html.length} bytes of HTML`);
    } catch (snapErr) {
      log.warning(`Failed to write post-login snapshot: ${snapErr?.message || snapErr}`);
    }

    // 3. Navigate to order form. Try a wide net of common Meridian Link
    // navigation labels — different iscsite deployments customize these.
    log.info('Navigating to order credit report');
    try {
      await clickByText(page, /credit verification|verifications?|services|credit reports?|order (services|credit|new)|new order|credit/i);
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
      await clickByText(page, /order credit report|new credit (report|order)|order credit|new order|order/i);
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    } catch (err) {
      await fail('navigate_to_order_form', err);
    }

    // 4. Fill borrower form
    log.info('Filling borrower form');
    try {
      await selectByLabel(page, /loan type/i, 'CONV');
      await selectByLabel(page, /marital status/i, 'Not Disclosed');
      await fillByLabel(page, /first name/i, borrower.firstName);
      await fillByLabel(page, /last name/i, borrower.lastName);
      await fillByLabel(page, /(^|\b)ssn|social security/i, normalizeSsn(borrower.ssn));
      await fillByLabel(page, /(date of birth|dob|birth date)/i, normalizeDob(borrower.dob));
      if (borrower.addressStreet) await fillByLabel(page, /(address|street)/i, borrower.addressStreet);
      if (borrower.addressCity) await fillByLabel(page, /city/i, borrower.addressCity);
      if (borrower.addressState) await fillByLabel(page, /state/i, borrower.addressState);
      if (borrower.addressZip) await fillByLabel(page, /(zip|postal)/i, borrower.addressZip);
      if (borrower.phone) await fillByLabel(page, /(applicant\s*phone|phone)/i, normalizePhone(borrower.phone));
      if (borrower.email) await fillByLabel(page, /(applicant\s*email|email)/i, borrower.email);
    } catch (err) {
      await fail('fill_borrower_form', err);
    }

    // 5. Submit, then fill payment screen if it appears
    log.info('Submitting order');
    try {
      await clickByText(page, /^(order report|order credit|order|submit|next|continue)$/i);
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    } catch (err) {
      await fail('submit_order', err);
    }

    log.info('Checking for payment screen');
    try {
      const cardField = page.getByLabel(/card\s*number|credit\s*card/i)
        .or(page.locator('input[name*="card" i], input[id*="card" i]'));
      if (await cardField.count() > 0) {
        log.info('Payment screen detected — filling card');
        await cardField.first().fill(String(card.number).replace(/\s+/g, ''));
        // Try a single combined exp field first (MM/YY); fall back to separate fields
        try {
          await fillByLabel(page, /(expir|exp\b|exp\s*date)/i, `${pad2(card.expMonth)}/${last2(card.expYear)}`);
        } catch {
          await fillByLabel(page, /^mm$|month/i, pad2(card.expMonth)).catch(() => {});
          await fillByLabel(page, /^yy(yy)?$|year/i, last2(card.expYear)).catch(() => {});
        }
        await fillByLabel(page, /(cvc|cvv|security\s*code)/i, String(card.cvc));
        await fillByLabel(page, /(billing\s*zip|zip|postal)/i, String(card.zip));
        if (card.name) await fillByLabel(page, /(cardholder|name on)/i, card.name).catch(() => {});
        await clickByText(page, /^(pay|charge|order|submit|confirm|complete|place\s*order)$/i);
        await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
      } else {
        log.info('No payment screen detected');
      }
    } catch (err) {
      await fail('payment', err);
    }

    // 6. Scrape scores best-effort
    const scores = await extractScores(page).catch((err) => {
      log.warning(`Could not extract scores: ${err?.message || err}`);
      return { equifax: null, experian: null, transunion: null };
    });
    log.info(`Scores: ${JSON.stringify(scores)}`);

    // 7. Download the PDF
    log.info('Downloading credit report PDF');
    const pdfBuffer = await downloadCreditReportPdf(page).catch(async (err) => {
      await fail('download_pdf', err);
      return null;
    });

    return {
      ok: true,
      scores,
      pdfBuffer,
      finalUrl: page.url(),
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ---------------- selector helpers ----------------

async function clickByText(page, pattern) {
  const candidates = [
    page.getByRole('link', { name: pattern }),
    page.getByRole('button', { name: pattern }),
    page.getByRole('menuitem', { name: pattern }),
    page.getByText(pattern, { exact: false }),
  ];
  for (const loc of candidates) {
    if (await loc.count() > 0) {
      await loc.first().click({ timeout: 15_000 });
      return;
    }
  }
  throw new Error(`No clickable element matched ${pattern}`);
}

async function fillByLabel(page, labelPattern, value) {
  if (value == null || value === '') return;
  const byLabel = page.getByLabel(labelPattern, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.first().fill(String(value), { timeout: 10_000 });
    return;
  }
  const stemPart = stem(labelPattern);
  if (stemPart) {
    const fallback = page.locator(`input[name*="${stemPart}" i], input[id*="${stemPart}" i], input[placeholder*="${stemPart}" i], textarea[name*="${stemPart}" i]`);
    if (await fallback.count() > 0) {
      await fallback.first().fill(String(value), { timeout: 10_000 });
      return;
    }
  }
  throw new Error(`No input matched label ${labelPattern}`);
}

async function selectByLabel(page, labelPattern, value) {
  const byLabel = page.getByLabel(labelPattern, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.first().selectOption({ label: value }).catch(async () => {
      await byLabel.first().selectOption({ value });
    });
    return;
  }
  const stemPart = stem(labelPattern);
  const select = page.locator(`select[name*="${stemPart}" i], select[id*="${stemPart}" i]`);
  if (await select.count() > 0) {
    await select.first().selectOption({ label: value }).catch(async () => {
      await select.first().selectOption({ value });
    });
    return;
  }
  throw new Error(`No <select> matched label ${labelPattern}`);
}

async function fillByCommonAttr(page, names, value) {
  for (const name of names) {
    const loc = page.locator(`input[name*="${name}" i], input[id*="${name}" i], input[type="${name}" i]`);
    if (await loc.count() > 0) {
      await loc.first().fill(value, { timeout: 10_000 });
      return;
    }
  }
  throw new Error(`No input matched any of: ${names.join(', ')}`);
}

function stem(pattern) {
  return String(pattern).replace(/[\\/^$.*+?()[\]{}|]/g, '').split('|')[0].trim();
}

// ---------------- value normalizers ----------------

function normalizeSsn(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 9) return s;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function normalizeDob(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return s;
}

function normalizePhone(s) {
  const d = String(s || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return s;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function pad2(n) { return String(n).padStart(2, '0').slice(-2); }
function last2(n) { return String(n).slice(-2); }

// ---------------- result extraction ----------------

async function extractScores(page) {
  const text = await page.locator('body').innerText();
  const find = (bureauPattern) => {
    const re = new RegExp(`${bureauPattern}[^0-9]{1,40}(\\d{3})`, 'i');
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 300 && n <= 850) return n;
    }
    return null;
  };
  return {
    equifax: find('equifax'),
    experian: find('experian'),
    transunion: find('trans\\s*union'),
  };
}

async function downloadCreditReportPdf(page) {
  const linkPatterns = [/download\s*(report|pdf)/i, /view\s*pdf/i, /print/i, /pdf/i];
  for (const pat of linkPatterns) {
    const loc = page.getByRole('link', { name: pat }).or(page.getByRole('button', { name: pat }));
    if (await loc.count() === 0) continue;
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        loc.first().click(),
      ]);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      return Buffer.concat(chunks);
    } catch {
      // try next pattern
    }
  }
  log.warning('No PDF download link found; capturing the page as PDF');
  return await page.pdf({ format: 'Letter', printBackground: true });
}

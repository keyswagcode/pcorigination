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
  const dashboardUrl = input.dashboardUrl || 'https://iscsite.meridianlink.com/';
  const mfaTimeoutMs = (input.mfaTimeoutSec || 300) * 1000;
  const sessionState = input.sessionState || null;

  // Optional outbound proxy. When set, all Chromium traffic routes through
  // it — used to give every credit pull the same egress IP so MeridianLink
  // can whitelist it and skip MFA.
  const proxy = input.proxy && input.proxy.server ? {
    server: input.proxy.server,
    username: input.proxy.username || undefined,
    password: input.proxy.password || undefined,
  } : undefined;
  if (proxy) log.info(`Routing through proxy ${proxy.server}`);

  const browser = await chromium.launch({
    headless: false,
    proxy,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    storageState: sessionState || undefined,
  });
  const page = await context.newPage();

  // On ANY stage failure capture a full diagnostic bundle keyed by stage, so a
  // single failed run is enough to fix the responsible selector without burning
  // another live pull (each retry is a real card charge + SMS round-trip).
  const fail = async (stage, err) => {
    log.error(`Stage "${stage}" failed: ${err?.message || err}`);
    const safe = stage.replace(/[^a-z0-9_-]/gi, '_');
    try {
      const url = page.url();
      await Actor.setValue(`fail_${safe}_url.txt`, url, { contentType: 'text/plain' });
    } catch { /* page may be gone */ }
    try {
      const shot = await page.screenshot({ fullPage: true });
      await Actor.setValue('error_screenshot.png', shot, { contentType: 'image/png' }); // back-compat
      await Actor.setValue(`fail_${safe}_screenshot.png`, shot, { contentType: 'image/png' });
    } catch { /* screenshot failed */ }
    try {
      const html = await page.content();
      await Actor.setValue(`fail_${safe}.html`, html, { contentType: 'text/html' });
    } catch { /* no html */ }
    try {
      const bodyText = await page.locator('body').innerText({ timeout: 3000 });
      await Actor.setValue(`fail_${safe}_body.txt`, bodyText.slice(0, 8000), { contentType: 'text/plain' });
    } catch { /* no body text */ }
    try {
      const els = await page.$$eval(
        'a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"]',
        nodes => nodes.map(e => ({
          tag: e.tagName.toLowerCase(),
          type: e.getAttribute('type') || '',
          text: (e.textContent || '').trim().slice(0, 120),
          name: e.getAttribute('name') || '',
          id: e.id || '',
          placeholder: e.getAttribute('placeholder') || '',
          ariaLabel: e.getAttribute('aria-label') || '',
          href: e.getAttribute('href') || '',
          visible: !(e.offsetParent === null),
        })).slice(0, 600)
      );
      await Actor.setValue(`fail_${safe}_elements.json`, els);
    } catch { /* eval failed */ }
    throw new Error(`Stage "${stage}" failed: ${err?.message || err}`);
  };

  const ApifyMod = await import('apify');
  const ActorRef = ApifyMod.Actor;

  try {
    // 1. Login. If we have a saved session, try restoring it first — that
    // skips both username/password AND MFA. Only fall back to fresh login
    // if ISC redirects us back to the login page (session expired).
    let loggedInViaSession = false;
    if (sessionState) {
      log.info(`Restoring saved session and trying to land directly on the dashboard…`);
      try {
        await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
        const url = page.url();
        if (!/login\.aspx|enterauthcode|entercode|mfa|twofactor|2fa|verify|otp|challenge/i.test(url)) {
          log.info(`Session restore succeeded — landed on ${url}, skipping login + MFA`);
          loggedInViaSession = true;
        } else {
          log.info(`Session restore landed on ${url} — session expired, falling back to fresh login`);
        }
      } catch (err) {
        log.warning(`Session restore failed: ${err?.message || err} — falling back to fresh login`);
      }
    }

    if (!loggedInViaSession) {
      log.info(`Opening ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      try {
        await fillByCommonAttr(page, ['username', 'user', 'login', 'email'], iscUsername);
        await fillByCommonAttr(page, ['password', 'pass'], iscPassword);
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
    }

    // 2. Wait for post-login. ISC's flow goes:
    //   /custom/login.aspx        → username + password
    //   /shared/Login/EnterAuthCode.aspx (and variants) → SMS MFA code
    //   /custom/...               → actual app
    // We don't use Apify Live View — instead, when we hit the auth-code page,
    // we publish mfa_status.json = "awaiting_code" to the run's KV store and
    // poll for mfa_code.txt (the orchestrator/edge function writes it there
    // after the broker types the code in our app's modal). Then we type the
    // code into ISC ourselves and continue.
    const STILL_AUTHENTICATING = /login\.aspx|enterauthcode|entercode|mfa|twofactor|2fa|verify|otp|challenge/i;
    const ON_AUTHCODE_PAGE = /enterauthcode|entercode|otp|verify|challenge|twofactor|2fa|mfa/i;

    log.info(loggedInViaSession ? 'Skipping post-login wait (session restored)' : `Waiting for post-login navigation (timeout ${mfaTimeoutMs / 1000}s)`);
    const start = Date.now();
    let mfaHandled = false;

    while (!loggedInViaSession && Date.now() - start < mfaTimeoutMs) {
      const url = page.url();

      // Done — past login + past any auth-code interstitial
      if (url && !STILL_AUTHENTICATING.test(url)) {
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        if (!STILL_AUTHENTICATING.test(page.url())) break;
      }

      // Stuck on the SMS auth-code page — handle it via in-app code entry
      if (!mfaHandled && ON_AUTHCODE_PAGE.test(url)) {
        log.info(`On MFA auth-code page (${url}) — publishing mfa_status=awaiting_code and polling for code`);

        // Comprehensive snapshot of the auth-code page so we can diagnose
        // delivery issues (no SMS arriving, alternate delivery methods, etc.).
        // The previous narrow link/button dump missed inputs and dropdowns.
        try {
          const html = await page.content();
          const allInteractive = await page.$$eval(
            'a, button, input, select, textarea, [role="button"], [role="menuitem"], [role="link"], [role="radio"], [role="checkbox"]',
            els => els.map(e => ({
              tag: e.tagName.toLowerCase(),
              type: e.getAttribute('type') || '',
              text: (e.textContent || '').trim().slice(0, 200),
              value: ('value' in e ? String(e.value || '') : '').slice(0, 100),
              name: e.getAttribute('name') || '',
              id: e.id || '',
              href: e.getAttribute('href') || '',
              ariaLabel: e.getAttribute('aria-label') || '',
              placeholder: e.getAttribute('placeholder') || '',
              role: e.getAttribute('role') || '',
              visible: !(e.offsetParent === null),
            })).slice(0, 500)
          );
          await ActorRef.setValue('authcode_url.txt', url, { contentType: 'text/plain' });
          await ActorRef.setValue('authcode_elements.json', allInteractive);
          await ActorRef.setValue('authcode_page.html', html, { contentType: 'text/html' });
          await page.screenshot({ fullPage: true }).then(s => ActorRef.setValue('authcode_screenshot.png', s, { contentType: 'image/png' })).catch(() => {});
          log.info(`Saved auth-code snapshot: ${allInteractive.length} interactive elements, ${html.length} bytes of HTML`);
        } catch (snapErr) {
          log.warning(`Failed to capture auth-code snapshot: ${snapErr?.message || snapErr}`);
        }

        // ISC's auth-code page does NOT auto-send the SMS on page load —
        // there's a "Send" button (input[name=ctrlEnterAuthCode$btnSend])
        // that has to be clicked first. This is the root cause of "no SMS
        // arrived" from prior runs.
        try {
          const sendBtn = page.locator('input[name="ctrlEnterAuthCode$btnSend"]');
          if (await sendBtn.count() > 0) {
            log.info('Clicking ISC "Send" button to trigger SMS');
            await sendBtn.first().click({ timeout: 8_000 });
            // ISC re-renders the page (it's a server-side postback). Wait
            // briefly so the keypad + chkInstall + continue button are ready.
            await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
            await page.waitForTimeout(1500);
          } else {
            log.warning('Send button not found — SMS may not be triggered');
          }
        } catch (sendErr) {
          log.warning(`Failed to click Send button: ${sendErr?.message || sendErr}`);
        }

        await ActorRef.setValue('mfa_status.json', { state: 'awaiting_code', url, timestamp: Date.now() });

        let code = null;
        const codeStart = Date.now();
        const CODE_WAIT_MS = mfaTimeoutMs - (Date.now() - start); // remaining budget
        while (Date.now() - codeStart < CODE_WAIT_MS) {
          const stored = await ActorRef.getValue('mfa_code.txt');
          if (stored) {
            code = String(stored).trim().replace(/\D/g, '');
            if (code.length >= 4) break;
          }
          await page.waitForTimeout(2000);
        }
        if (!code) {
          await ActorRef.setValue('mfa_status.json', { state: 'timeout', timestamp: Date.now() });
          throw new Error(`SMS code not provided within ${Math.floor(CODE_WAIT_MS / 1000)}s`);
        }

        log.info(`Got SMS code (${code.length} digits) — entering into ISC`);
        await typeMfaCode(page, code);
        // Verify what was actually entered by reading the displayAnswer span
        try {
          const entered = await page.locator('#displayAnswer').innerText({ timeout: 2000 }).catch(() => '');
          log.info(`displayAnswer after typing: "${entered}" (expected ${code.length} chars)`);
        } catch { /* noop */ }

        // Check the "Install/Trust this device" checkbox — this is the
        // key step. Once checked, ISC drops a long-lived device cookie
        // that bypasses MFA on subsequent logins from the same session
        // storage. Our edge function persists that storageState to
        // user_accounts.isc_session_state so the next pull just works.
        try {
          const trustBox = page.locator('input[name="ctrlEnterAuthCode$chkInstall"]');
          if (await trustBox.count() > 0) {
            const isChecked = await trustBox.first().isChecked().catch(() => false);
            if (!isChecked) {
              log.info('Checking "Trust this device" (chkInstall) so the device cookie persists');
              await trustBox.first().check({ timeout: 5_000 });
            }
          } else {
            log.warning('chkInstall checkbox not found — device trust will not persist');
          }
        } catch (trustErr) {
          log.warning(`Failed to check trust-device box: ${trustErr?.message || trustErr}`);
        }

        // Submit the auth code. ISC's Continue is an ASP.NET WebForms submit:
        //   <input ... name="ctrlEnterAuthCode$btnContinue"
        //          onclick="...WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(
        //                   "ctrlEnterAuthCode$btnContinue", "", true, "", "", false, false))">
        // A plain Playwright .click() TIMES OUT here — the scrambled keypad
        // overlays the button so it never passes the actionability check
        // (observed: "locator.click: Timeout 8000ms exceeded" even though the
        // element resolved). So we trigger the postback directly instead, with
        // layered fallbacks. This is the step that was silently failing and
        // leaving the run stuck on EnterAuthCode.aspx.
        const CONTINUE_NAME = 'ctrlEnterAuthCode$btnContinue';
        let continueTriggered = false;

        // 1. Drive the ASP.NET postback directly — bypasses any overlay.
        try {
          const ok = await page.evaluate((target) => {
            // eslint-disable-next-line no-undef
            if (typeof __doPostBack === 'function') { __doPostBack(target, ''); return true; }
            return false;
          }, CONTINUE_NAME);
          if (ok) { continueTriggered = true; log.info('Submitted auth code via __doPostBack'); }
          else log.warning('__doPostBack not defined on page — trying click fallbacks');
        } catch (e) {
          log.warning(`__doPostBack failed: ${e?.message || e}`);
        }

        // 2. Force-click the Continue input (ignores actionability/overlay).
        if (!continueTriggered) {
          try {
            const contBtn = page.locator(`input[name="${CONTINUE_NAME}"]`);
            if (await contBtn.count() > 0) {
              await contBtn.first().click({ timeout: 6_000, force: true });
              continueTriggered = true;
              log.info('Submitted auth code via force-click');
            }
          } catch (e) {
            log.warning(`force-click Continue failed: ${e?.message || e}`);
          }
        }

        // 3. dispatchEvent — synthetic click that ignores hit-testing entirely.
        if (!continueTriggered) {
          try {
            const contBtn = page.locator(`input[name="${CONTINUE_NAME}"]`);
            if (await contBtn.count() > 0) {
              await contBtn.first().dispatchEvent('click');
              continueTriggered = true;
              log.info('Submitted auth code via dispatchEvent');
            }
          } catch (e) {
            log.warning(`dispatchEvent Continue failed: ${e?.message || e}`);
          }
        }

        // 4. Generic submit-button fallback for other ML deployments.
        if (!continueTriggered) {
          try {
            const submitBtn = page.getByRole('button', { name: /^(submit|continue|verify|next|enter|ok|confirm|sign in|log in)$/i })
              .or(page.locator('input[type="submit"]'));
            if (await submitBtn.count() > 0) {
              await submitBtn.first().click({ timeout: 6_000, force: true });
              continueTriggered = true;
              log.info('Submitted auth code via generic submit fallback');
            } else {
              log.warning('No Continue/submit button found!');
            }
          } catch (e) {
            log.warning(`generic submit fallback failed: ${e?.message || e}`);
          }
        }

        if (!continueTriggered) log.error('Could not trigger Continue by any method');
        try {
          await page.waitForLoadState('networkidle', { timeout: 15_000 });
        } catch { /* still settling */ }

        // Always capture the post-Continue state so we can see what ISC
        // says (inline error like "Invalid code", redirect, etc.) without
        // round-tripping for another diagnostic build.
        log.info(`Post-Continue URL: ${page.url()}`);
        try {
          const shot = await page.screenshot({ fullPage: true });
          await ActorRef.setValue('post_continue_screenshot.png', shot, { contentType: 'image/png' });
          const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
          await ActorRef.setValue('post_continue_body.txt', bodyText.slice(0, 5000), { contentType: 'text/plain' });
          const html = await page.content();
          await ActorRef.setValue('post_continue.html', html, { contentType: 'text/html' });
          log.info(`Post-Continue snapshot saved: ${bodyText.length} chars of body text`);
        } catch (snapErr) {
          log.warning(`Post-Continue snapshot failed: ${snapErr?.message || snapErr}`);
        }

        await ActorRef.setValue('mfa_status.json', { state: 'submitted', timestamp: Date.now() });
        await ActorRef.setValue('mfa_code.txt', null);
        mfaHandled = true;
      }

      await page.waitForTimeout(2000);
    }
    if (STILL_AUTHENTICATING.test(page.url())) {
      throw new Error(`Login or MFA not completed within ${mfaTimeoutMs / 1000}s. Last URL: ${page.url()}`);
    }
    log.info(`Past login: ${page.url()}`);

    // Capture session state so the next pull can skip login + MFA entirely.
    // The orchestrator (edge function) reads session_state.json from the
    // run's KV store and persists it to user_accounts.isc_session_state.
    try {
      const captured = await context.storageState();
      await ActorRef.setValue('session_state.json', captured);
      log.info(`Captured session state: ${captured.cookies?.length || 0} cookies, ${captured.origins?.length || 0} origins`);
    } catch (capErr) {
      log.warning(`Failed to capture session state: ${capErr?.message || capErr}`);
    }

    // Snapshot the post-login page so we can iterate on selectors without a
    // round-trip to retrieve a screenshot. Always written, regardless of
    // whether the next stage succeeds.
    try {
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
      await ActorRef.setValue('post_login_url.txt', page.url(), { contentType: 'text/plain' });
      await ActorRef.setValue('post_login_links.json', linkDump);
      await ActorRef.setValue('post_login.html', html, { contentType: 'text/html' });
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

    // 4. Fill borrower form.
    // Primary selectors are the EXACT ISC iscsite field IDs (captured from a
    // live run). Each falls back to fuzzy label matching so other MeridianLink
    // deployments still work. NOTE: the marital-status option is uppercase
    // "NOT DISCLOSED" — the old "Not Disclosed" never matched and was the cause
    // of the 60s selectOption timeout that failed this stage.
    log.info('Filling borrower form');
    try {
      // Loan type PREQUAL = SOFT pull (does NOT ding the borrower's credit).
      // This MUST always be PREQUAL — CONV produces a hard inquiry. Selecting it
      // fires changeLoanType()+updateOrderOptions() to set up the soft product.
      if (!(await selectById(page, 'cboLoanType', [{ value: 'PREQUAL' }, { label: 'PREQUAL' }])))
        await selectByLabel(page, /loan type/i, 'PREQUAL').catch(() => {});
      await page.waitForTimeout(500); // let updateOrderOptions() settle
      if (!(await selectById(page, 'cboMaritalStatus', [{ value: 'NOT DISCLOSED' }, { label: 'NOT DISCLOSED' }])))
        await selectByLabel(page, /marital status/i, 'NOT DISCLOSED').catch(() => {});

      if (!(await fillById(page, 'Borrower_txtFirstName', borrower.firstName)))
        await fillByLabel(page, /first name/i, borrower.firstName);
      if (!(await fillById(page, 'Borrower_txtSurName', borrower.lastName)))
        await fillByLabel(page, /last name/i, borrower.lastName);
      if (!(await fillById(page, 'Borrower_txtSSN', normalizeSsn(borrower.ssn))))
        await fillByLabel(page, /(^|\b)ssn|social security/i, normalizeSsn(borrower.ssn));
      if (!(await fillById(page, 'Borrower_txtDOB', normalizeDob(borrower.dob))))
        await fillByLabel(page, /(date of birth|dob|birth date)/i, normalizeDob(borrower.dob));

      // Current address — ISC "Unparsed" autocomplete (txtFullAddress visible,
      // detail fields hidden). Fill via the dedicated helper; fall back to
      // generic label matching for non-ISC deployments.
      if (borrower.addressStreet || borrower.addressCity || borrower.addressState || borrower.addressZip) {
        try {
          await fillIscAddress(page, 'CurrentAddress_faUSA_strUnparsedAutocomplete_', {
            street: borrower.addressStreet,
            city: borrower.addressCity,
            state: borrower.addressState,
            zip: borrower.addressZip,
          });
        } catch (addrErr) {
          log.warning(`ISC address fill failed (${addrErr?.message || addrErr}) — trying label-based`);
          if (borrower.addressStreet) await fillByLabel(page, /(address|street)/i, borrower.addressStreet).catch(() => {});
          if (borrower.addressCity) await fillByLabel(page, /city/i, borrower.addressCity).catch(() => {});
          if (borrower.addressState) await selectByLabel(page, /state/i, borrower.addressState).catch(() => {});
          if (borrower.addressZip) await fillByLabel(page, /(zip|postal)/i, borrower.addressZip).catch(() => {});
        }
      }

      if (borrower.phone && !(await fillById(page, 'txtBPhone_Input', normalizePhone(borrower.phone))))
        await fillByLabel(page, /(applicant\s*phone|phone)/i, normalizePhone(borrower.phone)).catch(() => {});
      if (borrower.email && !(await fillById(page, 'txtBemail_Input', borrower.email)))
        await fillByLabel(page, /(applicant\s*email|email)/i, borrower.email).catch(() => {});
    } catch (err) {
      await fail('fill_borrower_form', err);
    }

    // 5. Submit the order. ISC's button is <input type="submit" id="btnOrder"
    // value="Order">. After this ISC bills the broker's card and renders the
    // report — so this is the first step that actually costs money.
    log.info('Submitting order');
    try {
      // Select all 3 bureaus + scores FIRST — without this ISC pulls nothing.
      await selectBureaus(page);
      const orderBtn = page.locator('[id="btnOrder"]');
      if (await orderBtn.count() > 0) {
        await orderBtn.first().click({ timeout: 15_000, force: true });
      } else {
        await clickByText(page, /^(order report|order credit|order|submit|next|continue)$/i);
      }
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    } catch (err) {
      await fail('submit_order', err);
    }

    // 5b. Duplicate-report handling. ISC blocks a re-order for a recently
    // pulled SSN/name and renders "Duplicated SSN/Name detected! Use existing
    // report" with view/open links (viewReport(<id>) / openReport(<id>)) plus
    // a table of existing files. Rather than pay again, reuse the existing
    // report: open it, scrape the scores, and download its PDF.
    try {
      const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
      const viewLinks = page.locator('[onclick*="viewReport("], [onclick*="openReport("]');
      const isDuplicate = /duplicat\w*\s+(ssn|name|report)|use existing report/i.test(bodyText)
        || (await viewLinks.count()) > 0;

      if (isDuplicate) {
        await ActorRef.setValue('duplicate_warning.html', await page.content(), { contentType: 'text/html' });
        await ActorRef.setValue('duplicate_warning_screenshot.png', await page.screenshot({ fullPage: true }), { contentType: 'image/png' });
        await ActorRef.setValue('duplicate_warning_body.txt', bodyText.slice(0, 8000), { contentType: 'text/plain' });

        // Is the existing report COMPLETE or just an empty shell from an
        // interrupted order? The existing-reports table has bureau columns
        // (XP/TU/EF). For a COMPLETED report those cells contain the bureau
        // abbreviation (a view link); for an incomplete shell they're blank.
        // So "has data" = at least one XP/TU/EF cell in the row is populated.
        // (The table never shows the numeric scores, which is why the old
        // 3-digit check always failed.) Only reuse a complete report.
        const reportId = await page.evaluate(() => {
          const el = document.querySelector('[onclick*="viewReport("]') || document.querySelector('[onclick*="openReport("]');
          const oc = (el && el.getAttribute('onclick')) || '';
          const m = oc.match(/(?:view|open)Report\((\d+)\)/);
          return m ? m[1] : null;
        });
        const existingHasData = await page.evaluate(() => {
          const el = document.querySelector('[onclick*="viewReport("]') || document.querySelector('[onclick*="openReport("]');
          const row = el && el.closest('tr');
          if (!row) return false;
          const cells = [...row.querySelectorAll('td')].map((td) => (td.innerText || '').trim());
          return cells.filter((c) => /^(XP|TU|EF)$/i.test(c)).length >= 1;
        });
        log.info(`Duplicate detected. Existing report id=${reportId}, hasData=${existingHasData}`);

        if (existingHasData) {
          log.info('Existing report is COMPLETE — reusing it (no new charge)');
          const [popup] = await Promise.all([
            page.waitForEvent('popup', { timeout: 8_000 }).catch(() => null),
            page.evaluate((id) => {
              if (!id) return;
              // eslint-disable-next-line no-undef
              if (typeof viewReport === 'function') viewReport(Number(id));
              // eslint-disable-next-line no-undef
              else if (typeof openReport === 'function') openReport(Number(id));
            }, reportId),
          ]);
          const reportPage = popup || page;
          await reportPage.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
          await reportPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
          await reportPage.waitForTimeout(2000);
          try {
            await ActorRef.setValue('existing_report_url.txt', reportPage.url(), { contentType: 'text/plain' });
            await ActorRef.setValue('existing_report.html', await reportPage.content(), { contentType: 'text/html' });
            await ActorRef.setValue('existing_report_screenshot.png', await reportPage.screenshot({ fullPage: true }), { contentType: 'image/png' });
          } catch { /* noop */ }
          const scores = await extractScores(reportPage).catch(() => ({ equifax: null, experian: null, transunion: null }));
          log.info(`Reused-report scores: ${JSON.stringify(scores)}`);
          const reuseOut = {};
          const pdfBuffer = await downloadCreditReportPdf(reportPage, reportId, reuseOut).catch(() => null);
          return {
            ok: true, reusedExistingReport: true, existingReportId: reportId,
            scores, monthly_debt: reuseOut.monthlyDebt ?? null,
            pdfBuffer, finalUrl: reportPage.url(), capturedAt: new Date().toISOString(),
          };
        }

        // Incomplete shell — reusing it would just return a blank report. Push
        // the order THROUGH the warning (re-submit) so we actually pull and pay.
        log.info('Existing report is an incomplete shell — forcing the order through to payment');
        // The warning page is the order form re-rendered, so re-assert SOFT
        // pull (loan type PREQUAL) and re-select bureaus before re-submitting —
        // both reset on re-render, and we must never fall back to a hard pull.
        await selectById(page, 'cboLoanType', [{ value: 'PREQUAL' }, { label: 'PREQUAL' }]).catch(() => {});
        await page.waitForTimeout(400);
        await selectBureaus(page);
        // btnOrder sits in a hidden section on the warning page, so a Playwright
        // click fails ("not visible") and calling __doPostBack from evaluate
        // tripped a strict-mode error. Fire the element's NATIVE click instead —
        // that runs its onclick (WebForm_DoPostBackWithOptions) in page context.
        await page.evaluate(() => {
          const b = document.getElementById('btnOrder');
          if (b) b.click();
        });
        await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        log.info(`After forcing order through duplicate warning, URL: ${page.url()}`);
        // Fall through to the payment-screen handling below.
      }
    } catch (dupErr) {
      log.warning(`Duplicate-handling error (continuing to payment): ${dupErr?.message || dupErr}`);
    }

    log.info('Checking for payment screen');
    try {
      // ISC payment screen — exact field IDs (captured live):
      //   #CardInfo_txtCardNumber, #CardInfo_cboExpMonth (01-12),
      //   #CardInfo_cboExpYear (4-digit), #txtCVV, #CardInfo_txtName_Input,
      //   #CardInfo_CardAddress_txtZip, submit #btnGatherSubmit ("Next").
      const cardNum = page.locator('[id="CardInfo_txtCardNumber"]');
      // Generic fallback must only match a VISIBLE text-style card input — the
      // old label-based matcher grabbed the hidden "Charge credit card"
      // checkbox (#chkCCCharge) and hung the fill.
      const genericCard = page.locator(
        'input[type="text"][name*="cardnum" i]:visible, input[type="tel"][name*="cardnum" i]:visible, input[type="text"][id*="cardnum" i]:visible'
      );

      if (await cardNum.count() > 0) {
        log.info('ISC payment screen detected — filling card');
        const yy = String(card.expYear).replace(/\D/g, '');
        const expYear4 = yy.length === 2 ? `20${yy}` : yy; // dropdown uses 4-digit years
        const expMonth2 = pad2(card.expMonth);

        await cardNum.first().fill(String(card.number).replace(/\s+/g, ''), { timeout: 10_000 });
        if (!(await selectById(page, 'CardInfo_cboExpMonth', [{ value: expMonth2 }, { label: expMonth2 }])))
          log.warning(`Could not select exp month ${expMonth2}`);
        if (!(await selectById(page, 'CardInfo_cboExpYear', [{ value: expYear4 }, { label: expYear4 }])))
          log.warning(`Could not select exp year ${expYear4}`);
        await fillById(page, 'txtCVV', String(card.cvc));
        if (card.name) await fillById(page, 'CardInfo_txtName_Input', card.name);
        if (card.zip) await fillById(page, 'CardInfo_CardAddress_txtZip', String(card.zip));
        // Billing street/city/state are not collected in-app; ISC typically
        // only needs zip for AVS. If a later run shows they're required, we'll
        // add them to the card modal.

        try {
          await ActorRef.setValue('payment_prefill_screenshot.png', await page.screenshot({ fullPage: true }), { contentType: 'image/png' });
        } catch { /* noop */ }

        // Submit. #btnGatherSubmit ("Next") advances payment — this authorizes
        // the charge. Capture whatever comes next regardless of outcome so the
        // final confirm/report step can be wired without another live charge.
        log.info('Submitting payment (Next)');
        const nextBtn = page.locator('[id="btnGatherSubmit"]');
        if (await nextBtn.count() > 0) await nextBtn.first().click({ timeout: 15_000, force: true });
        else await clickByText(page, /^(next|pay|charge|submit|confirm|complete|place\s*order)$/i);
        await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
        await page.waitForTimeout(2500);

        try {
          await ActorRef.setValue('post_payment_url.txt', page.url(), { contentType: 'text/plain' });
          await ActorRef.setValue('post_payment.html', await page.content(), { contentType: 'text/html' });
          await ActorRef.setValue('post_payment_screenshot.png', await page.screenshot({ fullPage: true }), { contentType: 'image/png' });
          const bt = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
          await ActorRef.setValue('post_payment_body.txt', bt.slice(0, 8000), { contentType: 'text/plain' });
          log.info(`Post-payment URL: ${page.url()}`);
        } catch (snapErr) {
          log.warning(`post-payment snapshot failed: ${snapErr?.message || snapErr}`);
        }

        // Confirm Payment page: ISC shows a review screen with an "I accept"
        // checkbox (#cbAccept) and a final Submit (#btnConfirmSubmit). THIS is
        // the step that actually authorizes the charge. Clicking "Next" above
        // does NOT charge — without this, the order stays incomplete.
        const confirmBtn = page.locator('[id="btnConfirmSubmit"]');
        if (await confirmBtn.count() > 0) {
          log.info('Confirm Payment page detected — accepting terms and submitting (authorizes charge)');
          const acceptBox = page.locator('[id="cbAccept"]');
          if (await acceptBox.count() > 0) {
            try {
              await acceptBox.first().check({ timeout: 5_000, force: true });
            } catch {
              await page.evaluate(() => {
                const c = document.getElementById('cbAccept');
                if (c) { c.checked = true; c.dispatchEvent(new Event('click', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); }
              });
            }
          }
          await confirmBtn.first().click({ timeout: 15_000, force: true });

          // ISC renders a processing wait-bar (MCLTransaction2WebPage auto-
          // submits after a countdown) then lands on the completed report.
          // Wait until we leave the transaction/confirm page for the report.
          log.info('Payment submitted — waiting for ISC to process and render the report…');
          await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
          await page.waitForFunction(() => {
            const u = location.href.toLowerCase();
            return !/mcltransaction2webpage/.test(u)
              && /print_htm|reports|credit_file|clientconsumer|report|view/.test(u);
          }, { timeout: 120_000 }).catch(() => {});
          await page.waitForTimeout(3000);

          try {
            await ActorRef.setValue('post_confirm_url.txt', page.url(), { contentType: 'text/plain' });
            await ActorRef.setValue('post_confirm.html', await page.content(), { contentType: 'text/html' });
            await ActorRef.setValue('post_confirm_screenshot.png', await page.screenshot({ fullPage: true }), { contentType: 'image/png' });
            const bt = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
            await ActorRef.setValue('post_confirm_body.txt', bt.slice(0, 8000), { contentType: 'text/plain' });
            log.info(`Post-confirm URL: ${page.url()}`);
          } catch (snapErr) {
            log.warning(`post-confirm snapshot failed: ${snapErr?.message || snapErr}`);
          }
        } else {
          log.info('No Confirm Payment page detected after Next (single-step payment or already on report)');
        }
      } else if (await genericCard.count() > 0) {
        log.info('Generic payment screen detected — filling card (label-based)');
        await genericCard.first().fill(String(card.number).replace(/\s+/g, ''));
        await fillByLabel(page, /(cvc|cvv|security\s*code)/i, String(card.cvc)).catch(() => {});
        await fillByLabel(page, /(billing\s*zip|zip|postal)/i, String(card.zip)).catch(() => {});
        if (card.name) await fillByLabel(page, /(cardholder|name on)/i, card.name).catch(() => {});
        await clickByText(page, /^(next|pay|charge|order|submit|confirm|complete|place\s*order)$/i);
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

    // 7. Download the PDF (and capture monthly debt from the report viewer)
    log.info('Downloading credit report PDF');
    const out = {};
    const pdfBuffer = await downloadCreditReportPdf(page, undefined, out).catch(async (err) => {
      await fail('download_pdf', err);
      return null;
    });

    return {
      ok: true,
      scores,
      monthly_debt: out.monthlyDebt ?? null,
      pdfBuffer,
      finalUrl: page.url(),
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Enter the SMS code into ISC's auth-code page.
//
// ISC uses a SCRAMBLED numeric keypad as an anti-bot measure. Each button:
//   - DISPLAYS a digit via its onmouseout handler: innerHTML='<b>N</b>'
//   - FIRES a DIFFERENT, per-session scrambled value via onclick="touch('X')"
//   - blanks its label on hover (onmouseover sets innerHTML='')
// Example seen in the wild: the button showing "1" has onclick="touch('4')".
//
// The SMS code the broker receives refers to the DISPLAYED digits. So to enter
// the code we must click the button that *shows* each digit — the server maps
// the scrambled touch() value back on its end. The earlier implementation
// selected by touch('<digit>'), which entered a scrambled/wrong code on every
// pull. That was the real reason MFA never passed.
//
// Other MeridianLink deployments may use a plain text input instead — handled
// as a fallback.
async function typeMfaCode(page, code) {
  const digits = String(code).replace(/\D/g, '');
  if (!digits) throw new Error('typeMfaCode called with no digits');

  // Primary: ISC scrambled keypad (button.code_button).
  //
  // The keypad re-scrambles on every page RENDER (init() runs on window.onload;
  // touch() is client-side only and does NOT re-scramble per press — verified
  // from ISC's own JS). So the layout is stable while we type, but we still
  // read it FRESH — and we re-read before EACH digit — so we always act on the
  // live layout no matter when ISC last shuffled it. We never cache a map
  // across renders.
  const keypad = page.locator('button.code_button');
  if (await keypad.count() > 0) {
    // Make sure the on-load shuffle has finished before we read positions.
    await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {});

    // Read the current displayed-digit -> button map straight from the live DOM.
    const readMap = async () => {
      const n = await keypad.count();
      const map = {};
      for (let i = 0; i < n; i++) {
        const btn = keypad.nth(i);
        // Canonical displayed digit lives in the onmouseout handler
        // (innerHTML='<b>N</b>'), which is hover-independent. Fall back to the
        // button's live text if needed.
        let shown = '';
        const oh = (await btn.getAttribute('onmouseout')) || '';
        const m = oh.match(/<b>\s*(\d)\s*<\/b>/i);
        if (m) shown = m[1];
        if (!shown) shown = ((await btn.textContent().catch(() => '')) || '').replace(/\D/g, '').slice(0, 1);
        if (shown) map[shown] = i;
      }
      return map;
    };

    const firstMap = await readMap();
    log.info(`Scrambled keypad displayed-digit map: ${JSON.stringify(firstMap)}`);
    const missing = [...new Set([...digits])].filter((d) => !(d in firstMap));
    if (missing.length === 0) {
      // Clear any prior entry first (ISC has a Clear button).
      const clearBtn = page.locator('input[onclick*="clearAnswer"]');
      if (await clearBtn.count() > 0) await clearBtn.first().click({ force: true }).catch(() => {});

      for (const d of digits) {
        // Re-read the live layout for each digit, so even if ISC re-rendered
        // (new scramble) between presses we still hit the correct square.
        const map = await readMap();
        const idx = map[d];
        if (idx == null) throw new Error(`Keypad no longer shows digit "${d}" at press time (re-scramble?)`);
        // force:true — fire the real onclick without tripping on the keypad's
        // hover/overlay handlers (same class of issue that broke Continue).
        await keypad.nth(idx).click({ timeout: 5_000, force: true });
        await page.waitForTimeout(150);
      }
      return;
    }
    log.warning(`Keypad has no button(s) displaying digit(s) [${missing.join(',')}] — falling back to other input methods`);
  }

  // Fallback 1: a plain visible text input (non-ISC MeridianLink deployments).
  const codeInput = page.locator(
    'input[type="text"]:visible, input[type="tel"]:visible, input[type="number"]:visible, input[type="password"]:visible, input:not([type]):visible'
  ).first();
  if (await codeInput.count() > 0) {
    await codeInput.fill(digits);
    return;
  }

  // Fallback 2: an UNscrambled keypad whose visible text equals the digit.
  for (const d of digits) {
    const btn = page.locator(`button:visible:has-text("${d}"), input[type="button"][value="${d}"]:visible`).first();
    if (await btn.count() === 0) throw new Error(`Could not find keypad button for digit "${d}"`);
    await btn.click({ timeout: 5_000, force: true });
    await page.waitForTimeout(150);
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

// Fill an input by its exact element id (attribute selector avoids CSS-escape
// issues with ASP.NET ids). Returns true if it filled, false if not found —
// so callers can fall back to label-based matching.
async function fillById(page, id, value) {
  if (value == null || value === '') return false;
  const loc = page.locator(`[id="${id}"]`);
  if (await loc.count() === 0) return false;
  await loc.first().fill(String(value), { timeout: 10_000 });
  return true;
}

// Select an option on a <select> by exact id, trying each candidate spec
// (e.g. [{value:'CONV'},{label:'CONV'}]) with a short timeout so a wrong
// value fails fast instead of hanging 30s. Returns true on success.
async function selectById(page, id, candidates) {
  const loc = page.locator(`[id="${id}"]`);
  if (await loc.count() === 0) return false;
  for (const c of candidates) {
    try { await loc.first().selectOption(c, { timeout: 5_000 }); return true; }
    catch { /* try next candidate */ }
  }
  return false;
}

// Fill ISC's "Unparsed" address autocomplete. The visible control is a single
// txtFullAddress field; the per-part fields (txtStreetAddress / txtCity_Input /
// ddlState / txtZip_Input) are HIDDEN detail fields that Google autocomplete
// normally populates. We do both: type the full address into the visible field
// (to trigger ISC's verify), and set the hidden detail fields' values directly
// via JS so the parsed parts are submitted even if autocomplete doesn't fire.
async function fillIscAddress(page, prefix, addr) {
  const { street = '', city = '', state = '', zip = '' } = addr;
  const full = [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const fullLoc = page.locator(`[id="${prefix}txtFullAddress"]`);
  if (await fullLoc.count() > 0) {
    try {
      await fullLoc.first().click({ timeout: 3_000 }).catch(() => {});
      await fullLoc.first().fill(full, { timeout: 8_000 });
      await page.waitForTimeout(1200); // let the autocomplete debounce + verify run
    } catch (e) {
      log.warning(`txtFullAddress fill failed (${e?.message || e}) — will set fields via JS`);
    }
  }

  // Set the hidden detail fields directly. ASP.NET submits each input's current
  // value, so JS-set values are posted even though the fields aren't visible.
  await page.evaluate(({ prefix, street, city, state, zip, full }) => {
    const set = (suffix, val) => {
      const el = document.getElementById(prefix + suffix);
      if (el != null && val != null && val !== '') {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    set('txtStreetAddress', street);
    set('txtCity_Input', city);
    set('txtZip_Input', zip);
    set('txtFullAddress', full);
    const st = document.getElementById(prefix + 'ddlState');
    if (st && state) { st.value = state; st.dispatchEvent(new Event('change', { bubbles: true })); }
    const flag = document.getElementById(prefix + 'show_details_flag');
    if (flag) flag.value = '1';
    const drop = document.getElementById(prefix + 'hdnDropInvalidAddress');
    if (drop) drop.value = 'false';
  }, { prefix, street, city, state, zip, full });
}

// Select all three credit bureaus (Experian / TransUnion / Equifax) and their
// scores on the ISC order form. THIS MUST RUN BEFORE CLICKING ORDER — the
// bureau checkboxes (UIOptions_exp_credit / tuc_credit / eqf_credit) are
// UNCHECKED by default, and ordering without them creates an empty file that
// pulls no bureau data (confirmed with ISC support). Checking each credit box
// fires orderOptionOnClick()+genOrderOptions(), which also enables that
// bureau's score checkbox; we then check the scores too.
async function selectBureaus(page) {
  let selected = 0;
  for (const opt of ['exp_credit', 'tuc_credit', 'eqf_credit']) {
    const box = page.locator(`[id="UIOptions_${opt}"]`);
    if (await box.count() === 0) { log.warning(`Bureau option UIOptions_${opt} not found`); continue; }
    try {
      if (!(await box.first().isChecked().catch(() => false))) {
        // click (not check) so ISC's onclick handler fires and updates flags
        await box.first().click({ timeout: 5_000, force: true });
      }
      selected++;
    } catch (e) {
      log.warning(`Could not select bureau ${opt}: ${e?.message || e}`);
    }
    await page.waitForTimeout(200);
  }
  // Scores become enabled once their bureau is checked — include them so the
  // report carries FICO scores, not just tradelines.
  for (const opt of ['exp_score', 'tuc_score', 'eqf_score']) {
    const box = page.locator(`[id="UIOptions_${opt}"]`);
    if (await box.count() === 0) continue;
    try {
      const disabled = await box.first().isDisabled().catch(() => true);
      if (!disabled && !(await box.first().isChecked().catch(() => false))) {
        await box.first().click({ timeout: 5_000, force: true });
        await page.waitForTimeout(150);
      }
    } catch { /* score is best-effort */ }
  }
  const oo = await page.locator('[id="UIOptions_orderoptions"]').inputValue().catch(() => '');
  log.info(`Selected ${selected}/3 bureaus (+scores); orderoptions=${oo}`);
  return selected;
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
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const inRange = (n) => Number.isFinite(n) && n >= 300 && n <= 850;

  const find = (bureauPattern) => {
    const bureauRe = new RegExp(bureauPattern, 'i');

    // Pass 1 (preferred): a line that mentions the bureau AND contains a
    // valid 3-digit score on the same line. This avoids the body-wide regex
    // jumping across unrelated numbers (addresses, model codes, dates).
    for (const line of lines) {
      if (!bureauRe.test(line)) continue;
      // Standalone 3-digit tokens only (not part of a longer number).
      const nums = (line.match(/(?<!\d)\d{3}(?!\d)/g) || []).map(Number).filter(inRange);
      if (nums.length) return nums[0];
    }

    // Pass 2 (fallback): original body-wide proximity match, tightened so
    // the captured score is a standalone token rather than digits cut out
    // of a longer number.
    const re = new RegExp(`${bureauPattern}[^0-9]{1,40}(?<!\\d)(\\d{3})(?!\\d)`, 'i');
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (inRange(n)) return n;
    }
    return null;
  };

  // Pass 0 (preferred for ISC ReportResult page): the compact summary line
  //   "XP: 694   TU: 709   EF: 672"   (XP=Experian, TU=TransUnion, EF=Equifax).
  // This is exactly how the completed-order results page shows scores, so try
  // it first before the bureau-name passes.
  const abbr = (code) => {
    const m = text.match(new RegExp(`\\b${code}\\b\\s*:?\\s*(\\d{3})`, 'i'));
    if (m) { const n = parseInt(m[1], 10); if (inRange(n)) return n; }
    return null;
  };
  const xp = abbr('XP');
  const tu = abbr('TU');
  const ef = abbr('EF');

  return {
    equifax: ef ?? find('equifax'),
    experian: xp ?? find('experian'),
    transunion: tu ?? find('trans\\s*union'),
  };
}

// Extract the borrower's TOTAL monthly debt payment from the report's TRADE
// SUMMARY (the DTI numerator). The summary table is laid out as:
//   - # BALANCE HIGH CREDIT PAYMENTS PAST DUE
//   MORTGAGE  c  bal  hc  pmt  pd
//   ...
//   TOTAL     c  bal  hc  pmt  pd     <-- 4th number = total monthly PAYMENTS
// Only present on the full report viewer (print_htm), not the order-info page.
async function extractMonthlyDebt(page) {
  try {
    const text = await page.locator('body').innerText({ timeout: 5_000 });
    const tsIdx = text.search(/TRADE\s*SUMMARY/i);
    const scope = tsIdx >= 0 ? text.slice(tsIdx, tsIdx + 3000) : text;
    // TOTAL row: count, balance, high-credit, PAYMENTS, past-due (5 numbers).
    const m = scope.match(/\bTOTAL\b\s+\$?([\d,]+)\s+\$?([\d,]+)\s+\$?([\d,]+)\s+\$?([\d,]+)\s+\$?([\d,]+)/i);
    if (m) {
      const payments = parseInt(m[4].replace(/,/g, ''), 10);
      if (Number.isFinite(payments)) {
        log.info(`Monthly debt (TRADE SUMMARY total payments): ${payments}`);
        return payments;
      }
    }
    log.warning('Could not parse monthly debt from TRADE SUMMARY');
  } catch (e) {
    log.warning(`extractMonthlyDebt failed: ${e?.message || e}`);
  }
  return null;
}

// Run `trigger` while listening CONTEXT-WIDE for a PDF. ISC delivers report
// PDFs by POSTing into a popup window; the PDF can arrive as the popup's
// document, an embedded iframe, or a download — so we attach response +
// download listeners across every page/popup BEFORE triggering, then return
// whichever delivers a real %PDF.
async function capturePdfWhile(page, trigger) {
  const ctx = page.context();
  let pdfBuf = null;
  const isPdf = (buf) => buf && buf.length > 800 && buf.slice(0, 5).toString('latin1') === '%PDF-';
  const onResponse = async (resp) => {
    if (pdfBuf) return;
    try {
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (ct.includes('pdf') || /\.pdf(\?|$)/i.test(resp.url())) {
        const buf = await resp.body();
        if (isPdf(buf)) { pdfBuf = buf; log.info(`Captured PDF (response): ${buf.length} bytes`); }
      }
    } catch { /* body not retrievable (download) — handled below */ }
  };
  const onDownload = async (dl) => {
    if (pdfBuf) return;
    try {
      const stream = await dl.createReadStream();
      const chunks = []; for await (const c of stream) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (isPdf(buf)) { pdfBuf = buf; log.info(`Captured PDF (download): ${buf.length} bytes`); }
    } catch { /* ignore */ }
  };
  const onPage = (p) => { p.on('download', onDownload); p.on('response', onResponse); };
  ctx.on('response', onResponse);
  ctx.on('download', onDownload);
  ctx.on('page', onPage);
  page.on('download', onDownload);
  try {
    await trigger();
    const start = Date.now();
    while (!pdfBuf && Date.now() - start < 45_000) await page.waitForTimeout(500);
  } finally {
    ctx.off('response', onResponse);
    ctx.off('download', onDownload);
    ctx.off('page', onPage);
    page.off('download', onDownload);
  }
  return pdfBuf;
}

// Download the FULL credit report PDF — the multi-page report that the report
// viewer's own "Save PDF" (showPDF) produces. The report viewer is print_htm,
// which exposes showPDF(). If we're not on it yet (e.g. the post-charge
// ReportResult page), open the full report first via viewReport('Preq'), then
// save. The PDF arrives via a popup/iframe/download, captured context-wide.
async function downloadCreditReportPdf(page, orderId, out = {}) {
  // Make sure we're on the report viewer (the page that has showPDF()).
  let viewer = page;
  let hasShow = await page.evaluate(() => typeof showPDF === 'function').catch(() => false);
  if (!hasShow) {
    const hasViewReport = await page.evaluate(() => typeof viewReport === 'function').catch(() => false);
    if (hasViewReport) {
      log.info('Opening full report viewer (viewReport) to reach Save-PDF…');
      const ctx = page.context();
      const popupP = ctx.waitForEvent('page', { timeout: 15_000 }).catch(() => null);
      await page.evaluate(() => { try { viewReport('Preq'); } catch (e) { /* ignore */ } });
      const popup = await popupP;
      viewer = popup || page;
      await viewer.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
      await viewer.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await viewer.waitForTimeout(1500);
      hasShow = await viewer.evaluate(() => typeof showPDF === 'function').catch(() => false);
    }
  }

  // While we're on the full report viewer, extract the total monthly debt
  // payment (DTI numerator) from the TRADE SUMMARY. Stashed on `out` so the
  // caller can include it in OUTPUT without changing this function's return.
  out.monthlyDebt = await extractMonthlyDebt(viewer).catch(() => null);

  // Save the full report: showPDF() (full multi-page report) preferred, with
  // viewPDFReport/printMe as fallbacks.
  const full = await capturePdfWhile(viewer, async () => {
    const fns = await viewer.evaluate(() => ({
      // eslint-disable-next-line no-undef
      showPDF: typeof showPDF === 'function',
      // eslint-disable-next-line no-undef
      viewPDF: typeof viewPDFReport === 'function',
      // eslint-disable-next-line no-undef
      printMe: typeof printMe === 'function',
    })).catch(() => null);
    if (!fns) return;
    await viewer.evaluate((f) => {
      // eslint-disable-next-line no-undef
      if (f.showPDF) showPDF();
      // eslint-disable-next-line no-undef
      else if (f.viewPDF) viewPDFReport('Preq');
      // eslint-disable-next-line no-undef
      else if (f.printMe) printMe(true);
    }, fns);
  }).catch(() => null);
  if (full) { log.info(`Full report PDF: ${full.length} bytes`); return full; }

  // 2. Generic download/print link (other deployments).
  const linkPatterns = [/save\s*pdf/i, /download\s*(report|pdf)/i, /view\s*pdf/i, /print/i, /pdf/i];
  for (const pat of linkPatterns) {
    const loc = viewer.getByRole('link', { name: pat }).or(viewer.getByRole('button', { name: pat }));
    if (await loc.count() === 0) continue;
    try {
      const [download] = await Promise.all([
        viewer.waitForEvent('download', { timeout: 30_000 }),
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

  // 3. Last resort: render the report page itself as a PDF.
  log.warning('No native PDF or download link found; capturing the page as PDF');
  return await viewer.pdf({ format: 'Letter', printBackground: true });
}

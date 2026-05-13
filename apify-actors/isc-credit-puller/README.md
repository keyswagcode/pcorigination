# isc-credit-puller (Apify Actor)

One-shot browser-automated credit pull against `iscsite.meridianlink.com`.

## Flow per run

1. Open the ISC login page, fill the broker's stored username + password, submit.
2. Wait for the page to leave `login.aspx`. If MFA is challenged, the run is
   already streaming a live browser via Apify's `containerUrl` — the broker
   opens that URL in their own tab, enters the SMS code, and we keep polling.
3. Navigate **Credit Verification → Order Credit Report**.
4. Fill the form: Loan Type=`CONV`, Marital Status=`Not Disclosed`, name, SSN,
   DOB, address, phone, email.
5. Submit. If a payment screen appears, fill the broker-supplied credit card
   and confirm.
6. Best-effort scrape the three bureau scores from the result page.
7. Download the credit report PDF.

## Inputs

- `iscUsername` (string)
- `iscPassword` (string, secret)
- `borrower` (object): `firstName, lastName, ssn, dob (YYYY-MM-DD), phone, email, addressStreet, addressCity, addressState, addressZip`
- `card` (object, secret): `number, expMonth, expYear, cvc, zip, name?`
- `loginUrl` (string, default `https://iscsite.meridianlink.com/custom/login.aspx`)
- `mfaTimeoutSec` (integer, default 300)

## Outputs (in default key-value store)

- `OUTPUT` — `{ ok, scores: {equifax, experian, transunion}, pdfKey, finalUrl, capturedAt }`
- `credit_report.pdf` — the downloaded report (when `pdfKey` is non-null)
- `error_screenshot.png` — full-page screenshot if a stage failed

## Deploy

```
cd apify-actors/isc-credit-puller
npx apify-cli login
npx apify-cli push
```

After the first push, set on the Supabase project:

```
APIFY_TOKEN=<your apify api token>
APIFY_ACTOR_ID=<actor id from apify, e.g. user~isc-credit-puller>
```

## Selector brittleness

Selectors are text-based (`getByLabel(/loan type/i)`) because we don't have
ISC's element IDs at write-time. On any failed stage the actor saves
`error_screenshot.png` to the run's key-value store — open it, find the
right label text, and adjust `src/main.js`.

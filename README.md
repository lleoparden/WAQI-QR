# WAQI QR Awareness Campaign

A free, always-online QR scan tracker and anti-scam awareness experience for **WAQI**, a student project fighting scams in Egypt.

The public page reads like a normal website. It shows a visitor what any site can learn from their browser, turns that profile into simulated scam messages, runs a short “spot the scam” game, and explains what actually protects them. The admin console creates QR codes, tracks human scans, compares A/B variants, and exports print-ready assets.

Everything runs on free tiers:

- **Supabase** free project — Postgres, RLS, RPCs, one admin user
- **GitHub Pages** — static frontend, no build step
- **GitHub Actions** — deploy and keep-alive
- **CDN** — three pinned MIT libraries, no build tooling

---

## What is in this repository

```
supabase/migrations/0001_init.sql   tables, RLS, RPCs, view, grants
web/
  config.js                         SUPABASE_URL, ANON_KEY, LANDING_BASE_URL
  js/api.js                         the only file that talks to Supabase
  landing/
    index.html                      public page
    styles.css                      landing-only styling
    content.js                      every word, one object per language
    landing.js                      page orchestration
    reveal.js                       local device/network reveal
    guessDevice.js                  pure, unit-tested device guess
    funnel.js                       whitelisted event pings
    share.js                        canvas share card
  admin/
    index.html, login.html          dashboard + login
    styles.css                      admin-only styling
    admin.js, login.js, png.js       dashboard logic and 300-DPI PNG helper
tests/                              node:test unit tests
.github/workflows/                  deploy.yml, keepalive.yml
API.md                              backend contract for any future frontend
TESTING.md                          automated + manual test checklist
```

The flow is: QR → `/?src=<slug>` → `web/index.html` redirects to `/landing/?src=<slug>` while preserving the query string.

---

## Before you start (assumptions)

- You have a free GitHub account and a free Supabase account.
- The GitHub repository will be **public** (free GitHub Pages is available for public repositories).
- You will use **one** admin account. Public Supabase sign-up is disabled.
- The app is a demonstration, not a malware scanner. It never claims a device was hacked or infected.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> and sign in.
2. Click **New project**.
3. Choose an organisation, a project name such as `waqi-qr`, a strong database password, and a region close to Egypt (for example `eu-central-1`).
4. Wait for the project to finish provisioning.

### Run the migration

1. In the Supabase dashboard, open **SQL Editor**.
2. Click **New query**.
3. Open [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) in this repository and copy the entire file.
4. Paste it into the SQL editor and click **Run**.
5. You should see **Success. No rows returned**.

The file is idempotent: running it again is safe. It creates the tables, indexes, RLS policies, public RPCs, admin RPCs, the stats view, and all grants.

### Create the single admin user

1. Go to **Authentication → Providers → Email**.
2. Make sure **Email** is enabled.
3. Turn **Enable sign ups** **off**. This is important: the public must not be able to create an account.
4. Go to **Authentication → Users** and click **Add user → Create new user**.
5. Enter the admin email and a strong password.
6. Enable **Auto Confirm User** (or confirm the email if you prefer).
7. Copy the email/password into your password manager. That is the dashboard login.

There is no separate users table. The admin is a Supabase Auth user. Every admin RPC checks `auth.uid() is not null`, and the `authenticated` role has table grants; `anon` has none.

### Get the browser-safe keys

1. Open **Project Settings → API**.
2. Copy:
   - **Project URL** (for example `https://abcdefgh.supabase.co`)
   - **anon / publishable key**
3. Never copy the `service_role` key into this repository, `web/config.js`, or any browser file. The anon key is intentionally public; RLS is what protects the data.

---

## 2. Configure the browser app

Open [`web/config.js`](web/config.js) and replace the three placeholders:

```js
export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
export const LANDING_BASE_URL = 'https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO/';
```

Rules:

- `LANDING_BASE_URL` must end with `/`.
- It must be the **site root**, not `/landing/`. The admin builds QR targets as `<LANDING_BASE_URL>/?src=<slug>`.
- If you add a custom domain, change `LANDING_BASE_URL` to that domain and update the `CNAME` secret (see step 7).
- The landing page still renders in a safe “preview” mode when Supabase is not configured; it simply does not record scans or events.

---

## 3. Run it locally

Use Node 20 or newer.

```bash
npm run serve
```

Open:

- Landing preview: <http://127.0.0.1:4173/landing/?src=demo>
- Admin login: <http://127.0.0.1:4173/admin/login.html>
- Root QR-style redirect: <http://127.0.0.1:4173/?src=demo>

The local server is only for development. GitHub Pages serves the same `/web` directory directly; there is no build step.

---

## 4. Push to GitHub

Create an empty repository, then:

```bash
git init
git add .
git commit -m "WAQI QR awareness campaign"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

If you are new to Git, GitHub’s “upload files” flow works too, but the Actions workflow only runs after the files are in a branch.

---

## 5. Enable GitHub Pages

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push to `main` or run the **Deploy campaign to GitHub Pages** workflow manually from the **Actions** tab.
5. Wait for the deployment job to finish. The workflow publishes only the `web/` folder.
6. Open the Pages URL shown in the deployment, for example `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

The site is static. `web/.nojekyll` prevents Jekyll processing.

### Set the repository secrets

The deploy workflow needs no Supabase secrets because the anon key is already in `web/config.js`. The keep-alive workflow needs two secrets:

1. Go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Add:
   - `SUPABASE_URL` — the same Project URL
   - `SUPABASE_ANON_KEY` — the same anon key
3. Optional custom domain: add a third secret `CNAME` with the domain, for example `qr.waqi.example`.

The **Keep Supabase awake** workflow runs every two days, calls the public `ping` RPC, and fails loudly if the secrets are missing or the response is not `true`. Supabase free projects pause after roughly seven days of inactivity; this keeps a wide margin.

---

## 6. Create the first QR code and verify a scan

1. Open `https://YOUR_USERNAME.github.io/YOUR_REPO/admin/login.html`.
2. Sign in with the Supabase admin user.
3. In **Create a QR code**, enter:
   - Label: `Campus gate test`
   - Placement: `Main gate`
   - Custom slug: `gate-test` (or leave blank for an 8-character random slug)
   - Variant: `control` (optional)
4. Click **Create QR**.
5. The preview panel opens with:
   - The QR URL `<LANDING_BASE_URL>/?src=gate-test`
   - **Download PNG** and **Download SVG**
   - **Download poster tile (300 DPI)** with an editable CTA, A5/A4 size, and optional logo
6. Download the PNG or poster, print it, and scan it with a phone.
7. The landing page opens. Scroll through the reveal and tap a few buttons.
8. Refresh the dashboard. **Human scans** and **Unique humans** should increment. Bot/link-preview visits are stored but excluded from headline numbers.

If the count does not move:

- Confirm the QR URL contains `?src=gate-test` and not `#`.
- Confirm the QR is active and inside its start/expiry window.
- Open the URL directly in a normal browser tab first.
- Check the browser Network tab for `record_scan` and its HTTP response.
- A link preview from WhatsApp/Telegram may be flagged as a bot and intentionally excluded from human totals.

---

## 7. Custom domain (optional, but valuable for an anti-scam campaign)

A trustworthy URL matters. To use a custom domain:

1. Add the domain to the repository as a secret named `CNAME` (for example `qr.waqi.example`).
2. In your DNS provider, create a `CNAME` record pointing the domain to `YOUR_USERNAME.github.io`.
3. Run the deploy workflow. It writes `web/CNAME` into the Pages artifact.
4. In **Settings → Pages**, enable **Enforce HTTPS** after GitHub provisions the certificate.
5. Change `LANDING_BASE_URL` in `web/config.js` to the custom domain, commit, and push.
6. Create or edit QR codes so their printed targets point at the new domain.

Do not use a domain you do not control. The repository’s `waqi.example` and `*.example` addresses are reserved placeholders, not real destinations.

---

## 8. How the privacy design works

The full contract is in [`API.md`](API.md). In short:

- `record_scan` stores only: slug resolution, visitor ID, user-agent, referrer, and a bot flag.
- `record_event` stores only a slug, visitor ID, and one of eight fixed event names. There is no payload column in the database.
- No IP address, fingerprint, device model, geolocation, or revealed value is sent to Supabase.
- The reveal is computed in the browser. Canvas/WebGL/audio/font signals stay in memory and on screen.
- The only coordinates the app ever asks for are an **optional** browser geolocation prompt after a button click. They are rendered on screen and never stored or sent.
- IP/city/carrier lookup is a direct browser request to `https://ipwho.is/`, with `https://www.cloudflare.com/cdn-cgi/trace` as a fallback. If both fail, the page still renders and shows “not available”.
- `reveal.js` and `guessDevice.js` cannot import `api.js`; a static unit test enforces this and checks for the Supabase URL.
- `anon` cannot `SELECT` any table. The public can execute only `record_scan`, `record_event`, and `ping`.
- Admin RPCs check `auth.uid() is not null`; public sign-up should be disabled.

The page states this in the transparency box and in the always-visible privacy bar.

---

## 9. Replacing the UI later

The backend is intentionally independent of this UI:

- Tables, RLS policies, and RPCs live entirely in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
- [`API.md`](API.md) documents every parameter, return shape, and auth rule.
- Any new frontend only needs the Supabase URL, the anon key, and the same RPC calls.
- Keep the public page and admin page separate. They share only `web/js/api.js` and `web/config.js`.

If you replace the frontend, do not change the privacy contract: no IP, fingerprint, geolocation, or revealed data may be added to the tables or RPC payloads.

---

## 10. Admin dashboard reference

- **Overview cards:** human scans, unique humans, active QR count, last 24 hours, human/bot split.
- **Goal tracker:** target saved in the browser’s local storage, progress from human scans.
- **Create QR:** label, placement, optional slug, optional A/B variant. Auto-generates an 8-character slug.
- **QR table:** sortable columns, preview, edit label/placement/variant/dates, active toggle.
- **Print assets:** PNG, SVG, and a poster tile at A5/A4 pixel dimensions with a real 300-DPI `pHYs` chunk, configurable CTA, optional logo, and high error correction.
- **Charts:** scans over time, Africa/Cairo weekday × hour heatmap, funnel, A/B variant rates.
- **CSV:** per-QR stats and raw non-PII scan rows (50,000-row cap).
- **Auto-refresh:** every 30 seconds while the tab is visible.

The admin console redirects to the login page when there is no session and marks itself `noindex, nofollow`.

---

## 11. Free-tier guardrails

- **Supabase pause:** the scheduled `keepalive.yml` calls `ping` every two days. Do not delete it. A real scan also counts as activity, but the cron protects quiet weeks.
- **GitHub Actions minutes:** public repositories have free standard runners. The workflows do no heavy work.
- **CDN:** pinned versions only:
  - `ua-parser-js@1.0.39` — MIT (do not use v2; it is AGPL)
  - `qrcode@1.5.1` — MIT
  - `chart.js@4.4.7` — MIT
- **No paid services, no external database, no server.**
- **No build step.** Vanilla ES modules and static CSS only.
- If Supabase changes the free-tier pause policy, update the cron interval in [`keepalive.yml`](.github/workflows/keepalive.yml).

---

## 12. Troubleshooting

**The landing page works but scans never appear.**
Check `web/config.js`, the browser console, and the Network tab. If Supabase is not configured, `recordScan` returns `false` silently by design. Check the RPC response in Supabase **Logs → API**.

**The dashboard says “Supabase is not configured.”**
You edited `web/config.js` but did not deploy, or the file still contains `YOUR_`. Commit and let the Pages workflow finish.

**Login says “Wrong email or password.”**
Use the Auth user you created in Supabase, not the database password. Confirm the user is auto-confirmed. Sign-ups are disabled by design; do not create users through the public UI.

**A QR scan counts as a bot.**
Some in-app browsers and link previews use bot-like user agents. The row is stored with `is_bot = true` and excluded from headline numbers. Test with a normal mobile browser.

**The QR preview or poster is blank / “QR library failed to load.”**
The pinned CDN script did not load. Check the browser Network tab and your network policy. The rest of the dashboard still works without the CDN.

**The IP/city row says “not exposed by your browser.”**
The third-party lookup was blocked, rate-limited, or offline. The page is designed to keep rendering. This does not affect scan tracking.

**Supabase is paused.**
Restore the project from the Supabase dashboard, then manually run **Keep Supabase awake** from GitHub Actions. Check the repository secrets.

**GitHub Pages shows a 404 at `/`.**
Confirm the Pages source is **GitHub Actions**, the deploy job succeeded, and `web/index.html` exists. The deploy artifact path is `web`.

---

## 13. Tests

Run the automated suite:

```bash
npm test
```

It covers device inference, the privacy guard (no `api.js` import in `reveal.js` / `guessDevice.js`, no Supabase URL, no storage), config boundaries, RLS/grants, event whitelist equality, copy structure, A/B quiz answers, PNG DPI chunk validity, and workflow contents.

For the full manual checklist — real phone scan, bot UA, anonymous table denial, auth redirect, Network-tab inspection, offline IP lookup, iOS Safari/Android Chrome degradation, and print assets — see [`TESTING.md`](TESTING.md).

---

## 14. Third-party licences

| Library | Version | Licence | Use |
| --- | --- | --- | --- |
| [ua-parser-js](https://github.com/faisalman/ua-parser-js) | 1.0.39 | MIT | Optional richer UA parsing on the reveal page |
| [qrcode](https://github.com/soldair/node-qrcode) | 1.5.1 | MIT | QR generation in the admin and share card |
| [Chart.js](https://www.chartjs.org/) | 4.4.7 | MIT | Admin charts |

No FingerprintJS code is bundled or loaded. The fingerprint is a small custom, local-only canvas/WebGL/audio/font hash.

---

## 15. Project intent

WAQI is a student project fighting scams in Egypt. This campaign is deliberately honest: it never claims a phone was hacked, never shows a fake virus alert, and never uses a fake countdown. The point is the next action a scammer wants — a password, an install, or a payment.

If you adapt this for another campaign, keep that rule. It is the whole point.

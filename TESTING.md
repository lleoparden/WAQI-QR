# Test Checklist

Use this after the Supabase project and GitHub Pages site are configured. The automated suite runs without credentials; the manual checks below need a real deployment and a phone.

---

## 1. Automated tests

```bash
npm test
```

Expected: **45 tests pass**, with no skipped tests.

The suite covers:

- **`tests/guessDevice.test.js`** — Samsung, Xiaomi/Redmi, iPhone, desktop Chrome, Firefox Android, Oppo, high-entropy client hints, malformed input, UA parsing.
- **`tests/privacy.test.js`** — `reveal.js` and `guessDevice.js` do not import `api.js`, do not store anything in localStorage/sessionStorage, do not contain the Supabase URL, and only fetch the two disclosed IP services. Also checks the config export boundary, RLS/grants, event whitelist equality with SQL, the four `record_scan` fields, the no-payload event RPC, admin `noindex`, and pinned library versions.
- **`tests/content.test.js`** — Arabic/English structures match, required reveal rows have labels and why-lines, all simulated scam URLs use reserved `.example` domains, every quiz round has a valid answer and a tell.
- **`tests/png.test.js`** — the 300-DPI `pHYs` chunk is inserted after IHDR with a valid CRC; non-PNG input is rejected.
- **`tests/hosting.test.js`** — deploy uploads only `web/`, keepalive calls `rpc/ping` with secrets, no build step, docs exist.

Also run a syntax check if you edit the JS:

```bash
Get-ChildItem -Recurse -Filter *.js web,tests | ForEach-Object { node --check $_.FullName }
```

(or the equivalent shell loop on macOS/Linux).

---

## 2. Real scan from a phone

1. Create a QR in the admin console with a memorable slug, for example `phone-test`.
2. Print or display the QR, then scan it with a phone camera.
3. Confirm the URL is `<LANDING_BASE_URL>/?src=phone-test` and the page opens.
4. In the admin **Overview**, refresh:
   - **Human scans** increments by 1.
   - **Unique humans** increments by 1.
   - The QR table row shows the scan and a recent **Last scan**.
5. Scan the same QR again immediately from the same browser: within 10 seconds it should be ignored. After the 10-second window, a new scan is counted (repeat visits are allowed; the abuse guard is only the short duplicate window).
6. Open the QR with the phone and leave it; verify the reveal, scam simulations, quiz, share card, and transparency box all render.

**Expected:** one human scan for one normal scan. Link previews (WhatsApp/Telegram/Slack) may add bot rows, not human rows.

---

## 3. Bot user agent is flagged `is_bot = true`

Create a live QR first, then call the public RPC:

```bash
curl --fail --silent --show-error \
  -X POST "$SUPABASE_URL/rest/v1/rpc/record_scan" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "p_slug": "phone-test",
    "p_visitor_id": "bot-test-00000001",
    "p_user_agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "p_referrer": null
  }'
```

In the Supabase SQL editor:

```sql
select visitor_id, is_bot, user_agent
from public.scans
where visitor_id = 'bot-test-00000001';
```

**Expected:** `is_bot = true`. The dashboard's **Human scans** does not change; the raw CSV includes the row.

Test the 10-second duplicate guard:

```sql
select count(*) from public.scans where visitor_id = 'bot-test-00000001';
```

Call the same `record_scan` twice in a row. Count should remain 1. Use a new visitor ID for each separate test.

---

## 4. `anon` cannot read `scans`, `events`, or `qr_codes` directly

### REST check

```bash
curl -i "$SUPABASE_URL/rest/v1/scans?select=*" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

Repeat for `/rest/v1/events`, `/rest/v1/qr_codes`, and `/rest/v1/v_qr_stats`.

**Expected:** HTTP 401 or 403 with a permission/RLS error, not a JSON array of rows. No rows may leak.

### SQL check

Run in the Supabase SQL editor:

```sql
set role anon;
select * from public.scans;
reset role;
```

**Expected:** `permission denied for table scans`. Repeat for `events` and `qr_codes`.

Also verify the function grants:

```sql
select
  p.proname,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'record_scan', 'record_event', 'ping',
    'get_overview', 'get_qr_stats', 'get_timeseries',
    'get_hourly_heatmap', 'get_funnel', 'get_variant_comparison',
    'create_qr', 'export_scans_csv'
  )
order by p.proname;
```

**Expected:** `anon_can_execute = true` only for `record_scan`, `record_event`, `ping`; false for every `get_*`, `create_qr`, and `export_scans_csv`.

---

## 5. Dashboard requires login

1. Open a private/incognito window.
2. Go to `https://YOUR_SITE/admin/` directly.
3. **Expected:** immediate redirect to `/admin/login.html`.
4. Open `https://YOUR_SITE/admin/index.html` directly and clear localStorage.
   **Expected:** same redirect.
5. Open `/admin/login.html` and enter a wrong password.
   **Expected:** “Wrong email or password.”, no redirect.
6. Sign in with the Supabase admin user.
   **Expected:** dashboard loads; the session email is shown in the header.
7. Click **Sign out**, then reload `/admin/`.
   **Expected:** back to login.
8. Confirm both admin pages contain `<meta name="robots" content="noindex, nofollow">`.

---

## 6. Network tab: only `record_scan` and whitelisted events reach our backend

On a real phone or desktop with DevTools:

1. Open the landing page with `?src=...`.
2. Open **Network**, filter by `rpc`.
3. Scroll through the reveal, tap the WAQI CTA, finish the quiz, click **Create & share card**.
4. Inspect every request to `https://<project>.supabase.co/rest/v1/rpc/...`.

**Expected request names only:**

- `record_scan`
- `record_event`

No `record_event` request may contain:

- IP address
- canvas/WebGL/audio/font fingerprint
- brand/model/screen/GPU
- city/country/ISP
- coordinates
- free text or a payload object

The `record_scan` body has exactly:

```json
{
  "p_slug": "...",
  "p_visitor_id": "...",
  "p_user_agent": "...",
  "p_referrer": "..."
}
```

The `record_event` body has exactly:

```json
{
  "p_slug": "...",
  "p_visitor_id": "...",
  "p_event": "reveal_started"
}
```

5. Inspect requests to `ipwho.is` / `cloudflare.com`. **Expected:** these are direct browser requests to third parties, never to your Supabase project. They are not stored.
6. Inspect the share card request. There must be none: canvas generation is local. The page may open the native share sheet or download a file; no upload.
7. Inspect localStorage. The only WAQI keys should be:
   - `waqi_visitor_id`
   - `waqi_lang`
   - and on admin only, `waqi_admin_session_v1` / `waqi_campaign_goal`

No revealed device, network, fingerprint, or coordinates may appear in localStorage.

---

## 7. Page renders fully if the IP API is blocked or offline

1. Open DevTools → Network → **Block request URL** for `https://ipwho.is/` and `https://www.cloudflare.com/cdn-cgi/trace`.
2. Reload the landing page.
3. **Expected:** all available reveal rows still appear. The Network row is omitted; the page continues to the scammer simulation, quiz, good-news, WAQI, share, and transparency sections. No “not exposed” placeholder title appears.
4. The scam cards use the generic carrier/city fallback and still carry **SIMULATION** badges.
5. Unblock and reload; the Network row populates again.
6. Also test with the device offline: the page shell, reveal rows, quiz, and share card must still work. The scan/event calls fail silently.

**No unhandled rejection or blank screen is acceptable.**

---

## 8. `guessDevice` unit cases

Run:

```bash
node --test tests/guessDevice.test.js
```

Covered sample user agents:

| Case | Expected |
| --- | --- |
| Samsung `SM-S918B`, 412×915 @3.5 | Samsung, Galaxy S23 Ultra, confidence ≥ 90 |
| Xiaomi `2201117TG` | Xiaomi, Redmi Note 11, confidence ≥ 90 |
| iPhone, 390×844 @3 | Apple, an “iPhone 12 / 13 / 14 class” range, never one exact model |
| Windows desktop Chrome | Desktop / Windows, not a phone |
| Firefox Android with no model | Low confidence, honest “unknown Android brand” fallback |
| Oppo `CPH2477` | Oppo, model code shown |
| Generic UA + client-hint `SM-A145` | Samsung, Galaxy A14 |

Also open the page on a phone and confirm the evidence line under the brand guess says **because:** model code/screen/GPU and ends with “This is a guess, not a certainty.” / Arabic equivalent.

At the end of the reveal, confirm **PROFILE READY** shows a non-zero signal count and only chips backed by real data (device, city, battery, browser, fonts, fingerprint). Missing data must not produce an empty chip.

---

## 9. Static privacy guard

```bash
node --test tests/privacy.test.js
```

**Expected:** pass. If someone adds `import ... from '../js/api.js'` or a `fetch` to Supabase inside `reveal.js` / `guessDevice.js`, this test fails.

Manual grep:

```bash
grep -nE "api\.js|record_scan|record_event|localStorage|SUPABASE_URL|rest/v1" web/landing/reveal.js web/landing/guessDevice.js
```

**Expected:** no matches (the word “api.js” may appear only in a comment, not as an import).

---

## 10. iOS Safari and Android Chrome degradation

### iOS Safari (real device or BrowserStack)

- Open the landing page.
- Confirm RTL Arabic and LTR English switch correctly.
- Confirm the battery line is omitted (Safari lacks `navigator.getBattery`), while the rest of the Hardware row remains.
- Confirm the user-agent row still identifies iOS and Safari.
- Tap the optional location button and deny permission.
  **Expected:** a graceful denial message, no coordinates, no request to Supabase.
- Scroll to the reveal end. **Expected:** `reveal_completed` event fires (Network tab) and the quiz is playable.
- Share: the native share sheet may not accept a file; the card must download instead.
- Rotate the phone; layout must not overflow horizontally.
- Turn on **Reduce Motion** in iOS accessibility settings; reload.
  **Expected:** no typewriter, no scanline, reveal appears without animation; the “Skip animation” control still works.

### Android Chrome

- Battery, connection, GPU, and high-entropy client hints should populate where available.
- Missing APIs (for example `deviceMemory`) omit their line instead of showing an empty “not exposed” entry.
- Test both dark and light system themes; the page remains dark by design but the `Color scheme` row reflects the OS setting.
- Test the share sheet with a file; otherwise the download fallback must work.
- Scan from the phone camera and confirm the count in the dashboard.

---

## 11. Admin: create, edit, toggle, dates, QR assets

1. Create a QR with a custom slug and variant.
2. **Expected:** preview panel opens; URL is `<LANDING_BASE_URL>/?src=<slug>`; QR is high-error-correction (level H).
3. **Download PNG** and scan it with a phone; it must open the landing page with the right slug.
4. **Download SVG**; open it in a browser or Illustrator/Inkscape; it must be crisp at large print sizes.
5. **Download poster tile (300 DPI)** for A5 and A4.
6. Verify dimensions and DPI metadata:

   ```bash
   python -c "from PIL import Image; im=Image.open('waqi-<slug>-poster-a5-300dpi.png'); print(im.size, im.info.get('dpi'))"
   ```

   **Expected:**
   - A5: `1748 × 2480`, dpi around `(300, 300)`
   - A4: `2480 × 3508`, dpi around `(300, 300)`
7. Type an Arabic CTA (`هتعمل scan؟`) and re-export; Arabic must shape correctly and remain inside the poster.
8. Upload a logo, re-export, and confirm it sits inside a white pad in the QR centre without breaking scannability (level H). Scan the poster to confirm.
9. Edit label/placement/variant. **Expected:** table updates.
10. Set `starts_at` in the future. **Expected:** the QR is no longer live; scanning it does not record a new scan.
11. Clear the date or set `expires_at` in the past. **Expected:** expired QR is ignored by `record_scan`.
12. Toggle **Active** off. **Expected:** survives reload and the QR is ignored.
13. Export **Per-QR CSV** and **Raw scans CSV**. **Expected:** valid UTF-8 CSV with a BOM; Arabic labels intact in Excel; no IP/fingerprint/coordinates columns.
14. Leave the dashboard open for 30+ seconds. **Expected:** **Synced** timestamp updates and numbers refresh without a full page reload.

---

## 12. Charts and A/B comparison

1. Create two QR codes with variants `control` and `fear`.
2. Scan both, complete the reveal on one, click the WAQI CTA on one.
3. Select **All QR codes** and a single QR in the chart filter.
4. **Expected:**
   - Scans-over-time line renders.
   - 7 × 24 heatmap renders, labelled **Africa/Cairo**; cells have hover titles.
   - Funnel shows scan → reveal stages with conversion percentages.
   - A/B chart shows reveal-completed and CTA-click rates per variant.
5. Confirm headline numbers exclude bot rows (from the bot test) while the CSV still contains them.

---

## 13. Share card and opt-in data

1. Open the share section with the checkbox **unchecked**.
2. **Expected:** the card contains the headline, the QR, and WAQI branding. It contains **no URL text** and none of the revealed device/city data.
3. Tick the checkbox.
4. **Expected:** the card redraws with only device/city lines. No network request is made. No coordinates or fingerprint are included.
5. Click **Create & share card** on a phone with Web Share support.
   **Expected:** native share sheet with the PNG where supported; otherwise a download. Only `share_clicked` is sent.
6. Download the card and scan its QR; it must open the campaign.
7. Untick and confirm the card redraws without the data lines.

---

## 14. Transparency and geolocation opt-in

1. Scroll to the transparency box.
2. **Expected:** the five-point list matches what the Network tab shows: slug, random visitor ID, UA, referrer, eight event names. No IP/fingerprint/device/location claims are contradicted by the implementation.
3. The always-visible privacy bar is present on every scroll position and in both languages.
4. Click **Show how precise my location could be**.
5. Deny the permission. **Expected:** a denial message, no coordinates, no Supabase request.
6. Allow it. **Expected:** latitude/longitude and accuracy appear on screen only; no Network request to Supabase; no localStorage entry. Reload and confirm the coordinates are gone.
7. If the browser blocks geolocation entirely, show the “not available” message.

---

## 15. Keep-alive and deployment

1. In GitHub **Actions → Keep Supabase awake → Run workflow**.
2. **Expected:** green run; curl response `true`; no `service_role` usage.
3. Remove/rename a secret temporarily and run again. **Expected:** a clear missing-secrets failure (then restore the secret).
4. In GitHub **Actions → Deploy campaign to GitHub Pages**, confirm the artifact path is `web` and the deployment URL opens.
5. Check `https://YOUR_SITE/` redirects to `/landing/` while preserving `?src=...`.
6. Confirm `/admin/` and `/admin/login.html` are not indexed (`noindex, nofollow`).

---

## 16. Edge cases worth a quick pass

- Invalid `?src=` value (uppercase, too short, `../../`, `<script>`): page opens as a preview, no scan is recorded, no script executes.
- No `?src=` at all: preview mode, no telemetry, no errors.
- localStorage disabled/private mode: visitor ID falls back to an in-memory ID; page works; backend may reject the ephemeral ID only if malformed.
- Supabase offline/blocked: page still renders; telemetry fails silently.
- CDN blocked (ua-parser-js, qrcode, Chart.js): landing still renders; admin charts/preview degrade with a visible message, not a blank page.
- Very long Arabic/English labels in the admin table: horizontal scroll, no layout break.
- 320 px wide screen: no horizontal overflow; privacy bar readable.
- Keyboard only: skip link, language toggle, quiz choices, share checkbox, admin forms are all reachable with visible focus.
- Screen reader: reveal rows are a list; labels and values are text; simulation badges say “SIMULATION”.

---

## 17. What “pass” looks like

- All automated tests green.
- One real scan increments human totals; a bot UA produces `is_bot = true` and does not change headline totals.
- Anonymous table access fails; admin access requires login.
- The Network tab shows only `record_scan` and whitelisted `record_event` calls to Supabase.
- Blocking the IP lookup does not blank the page.
- iOS Safari and Android Chrome both complete the flow with unavailable signals omitted, and the page shows no empty titles.
- QR PNG, SVG, and 300-DPI A5/A4 posters are scannable and print correctly.
- The share card never contains visitor data unless explicitly ticked, and never uploads the image.

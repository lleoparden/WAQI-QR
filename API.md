# WAQI Backend Contract

This is the complete contract for the Supabase backend. Any frontend can be rebuilt against it without touching the SQL or knowing about the current landing/admin UI.

Base URL:

```
https://<PROJECT_REF>.supabase.co
```

The browser-safe key is the **anon / publishable** key. It is public by design. The `service_role` key must never be shipped to a browser.

---

## 1. Authentication and headers

### Public calls

Every public request needs both headers:

```http
apikey: <ANON_KEY>
Authorization: Bearer <ANON_KEY>
Content-Type: application/json
```

### Admin calls

Sign in through Supabase Auth, then use the returned `access_token` as the bearer token:

```http
apikey: <ANON_KEY>
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

The current UI signs in with the Supabase Auth password grant:

```http
POST /auth/v1/token?grant_type=password
Content-Type: application/json

{ "email": "admin@example.com", "password": "..." }
```

It refreshes with:

```http
POST /auth/v1/token?grant_type=refresh_token

{ "refresh_token": "..." }
```

Sign out:

```http
POST /auth/v1/logout
Authorization: Bearer <ACCESS_TOKEN>
```

Public sign-up must be disabled in Supabase Auth. The campaign assumes exactly one admin user.

---

## 2. Database tables

All timestamps are `timestamptz`. All IDs are generated server-side.

### `public.qr_codes`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `slug` | `text` | not null, unique, `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$` |
| `label` | `text` | not null, max 120 enforced by RPC |
| `placement` | `text` | nullable |
| `variant` | `text` | nullable, max 40 enforced by RPC; A/B label |
| `target_url` | `text` | nullable, must start `http://` or `https://` if present |
| `active` | `boolean` | not null, default `true` |
| `starts_at` | `timestamptz` | nullable |
| `expires_at` | `timestamptz` | nullable, must be after `starts_at` if both exist |
| `created_at` | `timestamptz` | not null, default `now()` |

A slug is considered **live** when `active = true` and `starts_at <= now()` (or null) and `expires_at > now()` (or null).

### `public.scans`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `bigint identity` | primary key |
| `created_at` | `timestamptz` | not null, default `now()` |
| `qr_id` | `uuid` | not null, FK → `qr_codes(id)` on delete cascade |
| `visitor_id` | `text` | not null; random client ID, never a name/email/IP |
| `user_agent` | `text` | nullable, truncated to 512 chars by RPC |
| `referrer` | `text` | nullable, truncated to 1024 chars by RPC |
| `is_bot` | `boolean` | not null, default `false` |

**There is no IP, geolocation, fingerprint, or device-model column.**

### `public.events`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `bigint identity` | primary key |
| `created_at` | `timestamptz` | not null, default `now()` |
| `qr_id` | `uuid` | not null, FK → `qr_codes(id)` on delete cascade |
| `visitor_id` | `text` | not null |
| `event` | `text` | not null; restricted by CHECK |
| — | — | unique `(qr_id, visitor_id, event)` |

Allowed event names, exactly:

```
reveal_started
reveal_completed
tips_viewed
waqi_cta_clicked
share_clicked
quiz_completed
lang_toggled
skipped_animation
```

There is no payload, text, metadata, or coordinates column.

### View `public.v_qr_stats`

Aggregates per-QR counts. It has no grants to `anon` or `authenticated`; only the `get_qr_stats()` RPC reads it. Columns:

```
id, slug, label, placement, variant, target_url, active, starts_at,
expires_at, created_at, total_scans, human_scans, bot_scans,
unique_visitors, unique_human_visitors, last_scan_at, scans_24h
```

---

## 3. Row Level Security and grants

RLS is enabled on `qr_codes`, `scans`, and `events`.

| Role | `qr_codes` | `scans` | `events` |
| --- | --- | --- | --- |
| `anon` | no privileges | no privileges | no privileges |
| `authenticated` | select, insert, update, delete | select | select |

Policies require `auth.uid() is not null`. There is no policy for `anon`; combined with the table grants, anonymous direct reads/writes fail with a permission error.

Public access is only through `SECURITY DEFINER` RPCs:

- `record_scan(text, text, text, text)`
- `record_event(text, text, text)`
- `ping()`

All admin RPCs are `SECURITY DEFINER`, call `_require_admin()`, and are granted only to `authenticated` (and `service_role` for server-side maintenance). `anon` is explicitly revoked.

**Admin direct table access (optional):** the dashboard edits a QR with PostgREST `PATCH /rest/v1/qr_codes?id=eq.<uuid>` and the allowed columns. Any other admin frontend can do the same with the authenticated bearer token. Deleting a QR cascades its scans/events; prefer `active = false` for normal operation.

---

## 4. Public RPCs

### `record_scan`

```http
POST /rest/v1/rpc/record_scan
```

```json
{
  "p_slug": "gate-test",
  "p_visitor_id": "0b0f3e1c-2b5a-4d55-9b4e-1a2b3c4d5e6f",
  "p_user_agent": "Mozilla/5.0 ...",
  "p_referrer": "https://example.com/"
}
```

Returns: `204 No Content` / `null` (void).

Behavior:

1. Validates the slug shape and visitor ID (`^[A-Za-z0-9_-]{8,128}$`).
2. Resolves a live QR. Unknown, inactive, not-yet-started, or expired slugs are ignored silently.
3. Serializes concurrent scans for the same `(qr_id, visitor_id)` with an advisory lock.
4. Ignores a repeat scan from the same visitor to the same QR within **10 seconds**.
5. Flags the user agent as a bot with `_is_bot_ua()` when it matches patterns such as:
   `bot`, `crawler`, `spider`, `preview`, `facebookexternalhit`, `facebot`, `whatsapp`, `telegram`, `slackbot`, `discordbot`, `linkedinbot`, `twitterbot`, `googlebot`, `bingbot`, `curl`, `wget`, `python-requests`, `go-http-client`, `headlesschrome`, `phantomjs`, `lighthouse`, `pingdom`, `uptime`, `monitor`, `http-client`.
   Empty or missing user agents are treated as bots.
6. Inserts and returns nothing sensitive.

No exception is raised for a bad slug or inactive QR. Malformed calls are a no-op. A permission/DB error can still return a PostgREST error; the frontend must treat it as fire-and-forget.

### `record_event`

```http
POST /rest/v1/rpc/record_event
```

```json
{
  "p_slug": "gate-test",
  "p_visitor_id": "0b0f3e1c-2b5a-4d55-9b4e-1a2b3c4d5e6f",
  "p_event": "reveal_completed"
}
```

Returns: `204 No Content` / `null` (void).

Behavior:

1. Rejects any event not in the fixed eight-name whitelist (silently, `return`).
2. Validates the slug and visitor ID.
3. Resolves a live QR.
4. Requires at least one existing scan for that `(qr_id, visitor_id)`.
5. Inserts with `ON CONFLICT (qr_id, visitor_id, event) DO NOTHING`. The same event for the same visitor+QR is stored at most once, ever. This keeps funnel counts honest while still allowing the same visitor to generate different stages.

There is no payload parameter. Do not add one.

### `ping`

```http
POST /rest/v1/rpc/ping
```

```json
{}
```

Returns: `true` (JSON boolean). Used by the scheduled keep-alive workflow. It does not write data and is safe to call publicly.

---

## 5. Admin RPCs

All require an authenticated bearer token. If `auth.uid()` is null, they raise `28000 authentication required`.

### `get_overview`

```http
POST /rest/v1/rpc/get_overview
```

Returns a JSON object:

```json
{
  "total_scans": 120,
  "unique_visitors": 98,
  "human_scans": 112,
  "human_unique_visitors": 92,
  "bot_scans": 8,
  "active_qr_count": 3,
  "scans_24h": 40,
  "bot_scans_24h": 2
}
```

Headline numbers should use `human_*`. Bots are stored but excluded.

### `get_qr_stats`

```http
POST /rest/v1/rpc/get_qr_stats
```

Returns an array of rows:

```json
[
  {
    "id": "uuid",
    "slug": "gate-test",
    "label": "Campus gate",
    "placement": "Main gate",
    "variant": "control",
    "target_url": null,
    "active": true,
    "starts_at": null,
    "expires_at": null,
    "created_at": "2026-01-01T10:00:00+00:00",
    "total_scans": 42,
    "human_scans": 39,
    "bot_scans": 3,
    "unique_visitors": 37,
    "unique_human_visitors": 35,
    "last_scan_at": "2026-01-02T11:00:00+00:00",
    "scans_24h": 20
  }
]
```

Sort order: active first, then newest created.

### `get_recent_scans`

```http
POST /rest/v1/rpc/get_recent_scans

{ "p_limit": 20 }
```

- `p_limit`: clamped to `1..100`, default `20`.
- Requires an authenticated admin.
- Newest first. This is the dashboard's **Latest scans** feed; every row includes the QR slug and label.

```json
[
  {
    "id": 123,
    "created_at": "2026-01-01T10:00:00+00:00",
    "qr_id": "uuid",
    "slug": "gate-test",
    "label": "Campus gate",
    "visitor_id": "0b0f...",
    "is_bot": false
  }
]
```

If the `0003_recent_scans.sql` migration has not been applied, the dashboard falls back to `export_scans_csv` for this feed.

### `get_timeseries`

```http
POST /rest/v1/rpc/get_timeseries

{ "p_qr_id": null, "p_days": 30 }
```

- `p_qr_id`: UUID or `null` for all QRs.
- `p_days`: clamped to `1..365`, default `30`.

Returns one row per local day (Africa/Cairo), including days with zero scans:

```json
[
  { "day": "2026-01-01", "scans": 12, "bot_scans": 1, "unique_visitors": 11 }
]
```

`scans` and `unique_visitors` are human-only. `bot_scans` is separate.

### `get_hourly_heatmap`

```http
POST /rest/v1/rpc/get_hourly_heatmap

{ "p_qr_id": null }
```

Returns exactly 168 rows: weekday `0..6` (0 = Sunday, Cairo time) × hour `0..23`, including zeros.

```json
[
  { "weekday": 0, "hour": 0, "scans": 4 }
]
```

Human scans only.

### `get_funnel`

```http
POST /rest/v1/rpc/get_funnel

{ "p_qr_id": null }
```

Returns one row per stage, ordered by `stage_order`:

```json
[
  { "stage": "scan", "stage_order": 0, "count": 92, "conversion_pct": 100.0 },
  { "stage": "reveal_started", "stage_order": 1, "count": 80, "conversion_pct": 87.0 },
  { "stage": "reveal_completed", "stage_order": 2, "count": 61, "conversion_pct": 66.3 }
]
```

`scan` is the unique human-visitor denominator. Event stages count unique human visitors who have that event. `conversion_pct` is `count / scan_count × 100`. All eight whitelisted event stages are present.

### `get_variant_comparison`

```http
POST /rest/v1/rpc/get_variant_comparison
```

Groups by `coalesce(nullif(trim(variant), ''), '(untagged)')`.

```json
[
  {
    "variant": "control",
    "qr_count": 2,
    "scans": 120,
    "unique_visitors": 100,
    "reveal_completed": 70,
    "reveal_completed_rate": 70.0,
    "cta_clicks": 12,
    "cta_click_rate": 12.0
  }
]
```

Rates are percentages of unique human visitors. Bot scans/events are excluded.

### `create_qr`

```http
POST /rest/v1/rpc/create_qr
```

```json
{
  "p_label": "Campus gate",
  "p_placement": "Main gate",
  "p_target_url": null,
  "p_slug": null,
  "p_variant": "control"
}
```

- `p_label` required, max 120 chars.
- `p_placement` optional.
- `p_target_url` optional, must start with `http://` or `https://`.
- `p_slug` optional. If blank, the server generates an 8-character lowercase hex slug and retries collisions. If supplied, it must match `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`; a duplicate raises a unique-violation error.
- `p_variant` optional, max 40 chars.

Returns the inserted `qr_codes` row as a JSON object, including `id`, `slug`, and `created_at`.

The QR image itself is a frontend concern: `<LANDING_BASE_URL>/?src=<slug>`.

### `export_scans_csv`

```http
POST /rest/v1/rpc/export_scans_csv

{ "p_qr_id": null }
```

Returns up to **50,000** rows, newest first:

```json
[
  {
    "id": 123,
    "created_at": "2026-01-01T10:00:00+00:00",
    "qr_id": "uuid",
    "slug": "gate-test",
    "visitor_id": "0b0f...",
    "user_agent": "Mozilla/5.0 ...",
    "referrer": "https://example.com/",
    "is_bot": false
  }
]
```

`visitor_id` is a random pseudonymous ID, not a person. The dashboard turns these rows into CSV client-side. There is no server-side CSV file.

---

## 6. Error handling

PostgREST errors look like:

```json
{
  "code": "42501",
  "details": null,
  "hint": null,
  "message": "permission denied for table scans"
}
```

Expected conditions:

| Condition | Behaviour |
| --- | --- |
| Unknown/inactive/expired slug | `record_scan` / `record_event` do nothing, no error |
| Duplicate scan within 10s | ignored |
| Duplicate event | ignored (`ON CONFLICT DO NOTHING`) |
| Event outside whitelist | ignored |
| Event before any scan exists | ignored |
| Missing/invalid auth on admin RPC | `28000 authentication required` |
| `anon` direct table read | `42501 permission denied` |
| Duplicate custom slug | unique violation |
| Invalid custom slug | `22023` |

Public frontends must never let a telemetry failure break the page.

---

## 7. Example requests

### Public scan (curl)

```bash
curl --fail --silent --show-error \
  -X POST "$SUPABASE_URL/rest/v1/rpc/record_scan" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "p_slug": "gate-test",
    "p_visitor_id": "0b0f3e1c-2b5a-4d55-9b4e-1a2b3c4d5e6f",
    "p_user_agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
    "p_referrer": null
  }'
```

### Keep-alive (curl)

```bash
curl --fail --silent --show-error \
  -X POST "$SUPABASE_URL/rest/v1/rpc/ping" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
# => true
```

### Admin overview

```bash
curl --fail --silent --show-error \
  -X POST "$SUPABASE_URL/rest/v1/rpc/get_overview" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Admin edit of a QR

```bash
curl --fail --silent --show-error \
  -X PATCH "$SUPABASE_URL/rest/v1/qr_codes?id=eq.$QR_ID" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "label": "Campus gate — updated",
    "placement": "Main gate",
    "variant": "control",
    "active": true,
    "starts_at": null,
    "expires_at": null
  }'
```

---

## 8. Privacy invariant (do not break)

The backend may store **only**:

- QR slug resolution
- a random visitor ID
- the browser user-agent and referrer
- a bot flag
- fixed event names

It must never store or accept:

- IP address (the IP lookup happens directly between the browser and `ipwho.is` / Cloudflare, never through this backend)
- canvas/WebGL/audio/font fingerprints
- device model/brand guesses
- city/country/ISP from the IP lookup
- GPS coordinates (the optional geolocation prompt renders on screen only; the optional OpenStreetMap embed receives them directly from the browser to draw the map, never through this backend)
- any scan payload, form field, or free text

There is no `payload` column by design. Do not add one.

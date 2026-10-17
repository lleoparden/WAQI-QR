import { SUPABASE_URL, ANON_KEY } from '../config.js';

// The only module in the UI allowed to talk to Supabase. The landing page
// imports recordScan/recordEvent indirectly through funnel.js; no other UI
// module knows a Supabase URL or key exists.

const BASE = String(SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(ANON_KEY || '');
const SESSION_KEY = 'waqi_admin_session_v1';
const EVENTS = new Set([
  'reveal_started',
  'reveal_completed',
  'tips_viewed',
  'waqi_cta_clicked',
  'share_clicked',
  'quiz_completed',
  'lang_toggled',
  'skipped_animation',
]);

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function isConfigured() {
  return /^https?:\/\//i.test(BASE)
    && !/YOUR_|REPLACE_|example\.supabase\.co/i.test(BASE)
    && KEY.length > 20
    && !/YOUR_|REPLACE_/i.test(KEY);
}

function requireConfig() {
  if (!isConfigured()) {
    throw new ApiError('Supabase is not configured. Edit web/config.js first.', 0);
  }
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.access_token || !session?.refresh_token) return null;
    return session;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private mode can refuse storage; the session then lasts for this page only.
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clean up.
  }
}

function normaliseSession(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
    user: data.user || null,
  };
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeError(status, data) {
  if (data && typeof data === 'object') {
    return data.message || data.error_description || data.msg || data.error || `Request failed (${status})`;
  }
  if (typeof data === 'string' && data.trim()) return data.trim();
  return `Request failed (${status})`;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const data = await parseBody(response);
  if (!response.ok) {
    const error = new ApiError(describeError(response.status, data), response.status, data);
    if (response.status === 401) clearSession();
    throw error;
  }
  return data;
}

let refreshInFlight = null;

async function refreshSession(session) {
  requireConfig();
  if (!refreshInFlight) {
    refreshInFlight = fetchJson('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: {
        apikey: KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
      .then((data) => {
        const next = normaliseSession(data);
        writeSession(next);
        return next;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function getSession() {
  if (!isConfigured()) return null;
  const session = readSession();
  if (!session) return null;

  if (Number(session.expires_at || 0) - Date.now() > 60_000) {
    return session;
  }

  try {
    return await refreshSession(session);
  } catch {
    clearSession();
    return null;
  }
}

async function requireSession() {
  const session = await getSession();
  if (!session) throw new ApiError('AUTH_REQUIRED', 401);
  return session;
}

export async function signIn(email, password) {
  requireConfig();
  const data = await fetchJson('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const session = normaliseSession(data);
  writeSession(session);
  return session;
}

export async function signOut() {
  const session = readSession();
  if (session && isConfigured()) {
    try {
      await fetch(`${BASE}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch {
      // Local sign-out must still work when offline.
    }
  }
  clearSession();
}

async function authedFetch(path, options = {}) {
  requireConfig();
  const session = await requireSession();
  return fetchJson(path, {
    ...options,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function adminRpc(name, args = {}) {
  return authedFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

// ---------------------------------------------------------------------------
// Public, fire-and-forget telemetry. Every failure is swallowed by design:
// a blocked Supabase project must never break the awareness experience.
// ---------------------------------------------------------------------------

async function publicRpc(name, args) {
  if (!isConfigured()) return false;
  try {
    await fetchJson(`/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function recordScan({ slug, visitorId, userAgent, referrer }) {
  return publicRpc('record_scan', {
    p_slug: slug,
    p_visitor_id: visitorId,
    p_user_agent: userAgent || null,
    p_referrer: referrer || null,
  });
}

export function recordEvent({ slug, visitorId, event }) {
  if (!EVENTS.has(event)) return Promise.resolve(false);
  return publicRpc('record_event', {
    p_slug: slug,
    p_visitor_id: visitorId,
    p_event: event,
  });
}

export function ping() {
  return publicRpc('ping', {});
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function getOverview() {
  return adminRpc('get_overview');
}

export async function getQrStats() {
  return adminRpc('get_qr_stats');
}

export async function getTimeseries(qrId = null, days = 30) {
  return adminRpc('get_timeseries', { p_qr_id: qrId, p_days: days });
}

export async function getHourlyHeatmap(qrId = null) {
  return adminRpc('get_hourly_heatmap', { p_qr_id: qrId });
}

export async function getFunnel(qrId = null) {
  return adminRpc('get_funnel', { p_qr_id: qrId });
}

export async function getVariantComparison() {
  return adminRpc('get_variant_comparison');
}

export async function exportScans(qrId = null) {
  return adminRpc('export_scans_csv', { p_qr_id: qrId });
}

export async function getRecentScans(limit = 20) {
  return adminRpc('get_recent_scans', { p_limit: limit });
}

// ---------------------------------------------------------------------------
// Admin writes
// ---------------------------------------------------------------------------

export async function createQr({ label, placement, targetUrl, slug, variant }) {
  return adminRpc('create_qr', {
    p_label: label,
    p_placement: placement || null,
    p_target_url: targetUrl || null,
    p_slug: slug || null,
    p_variant: variant || null,
  });
}

export async function updateQr(id, patch) {
  const allowed = {};
  for (const key of ['label', 'placement', 'variant', 'active', 'starts_at', 'expires_at', 'target_url']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  }
  if (!Object.keys(allowed).length) throw new ApiError('No editable fields supplied.');

  const rows = await authedFetch(`/rest/v1/qr_codes?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(allowed),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

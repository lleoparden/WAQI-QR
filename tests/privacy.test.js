import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FUNNEL_EVENTS } from '../web/landing/funnel.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relativePath) => readFile(join(root, relativePath), 'utf8');

test('reveal.js and guessDevice.js never import the API or persist revealed data', async () => {
  const reveal = await read('web/landing/reveal.js');
  const guess = await read('web/landing/guessDevice.js');
  const config = await read('web/config.js');

  for (const source of [reveal, guess]) {
    assert.doesNotMatch(source, /from\s+['"][^'"]*api\.js['"]/);
    assert.doesNotMatch(source, /record_scan|record_event/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /rest\/v1|auth\/v1|SUPABASE_URL/);
  }

  const supabaseUrl = (config.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  assert.ok(supabaseUrl, 'config should declare SUPABASE_URL');
  assert.equal(reveal.includes(supabaseUrl), false);
  assert.equal(guess.includes(supabaseUrl), false);
});

test('reveal.js only fetches the two disclosed public IP services', async () => {
  const reveal = await read('web/landing/reveal.js');
  const urls = [...reveal.matchAll(/https:\/\/[^\s'",)]+/g)].map((match) => match[0]);
  assert.ok(urls.length >= 2);
  for (const url of urls) {
    assert.match(url, /^(https:\/\/ipwho\.is\/|https:\/\/www\.cloudflare\.com\/cdn-cgi\/trace)/);
  }
});

test('only api.js knows the Supabase REST and Auth endpoints', async () => {
  for (const file of [
    'web/landing/landing.js',
    'web/landing/reveal.js',
    'web/landing/share.js',
    'web/landing/funnel.js',
    'web/admin/admin.js',
    'web/admin/login.js',
  ]) {
    const source = await read(file);
    assert.doesNotMatch(source, /rest\/v1|auth\/v1|SUPABASE_URL|ANON_KEY/, `${file} bypasses api.js`);
  }
});

test('config.js exposes exactly the three browser-safe values', async () => {
  const config = await read('web/config.js');
  const exports = [...config.matchAll(/export const (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(exports, ['SUPABASE_URL', 'ANON_KEY', 'LANDING_BASE_URL']);
  assert.doesNotMatch(config, /export const (SERVICE|SECRET)/i);
});

test('the funnel whitelist matches the database CHECK constraint exactly', async () => {
  const sql = await read('supabase/migrations/0001_init.sql');
  const start = sql.indexOf('constraint events_event_check check');
  assert.ok(start > 0);
  const end = sql.indexOf(')),', start);
  const block = sql.slice(start, end);
  const databaseEvents = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

  assert.equal(databaseEvents.length, 8);
  assert.deepEqual(new Set(databaseEvents), new Set(FUNNEL_EVENTS));
  assert.deepEqual(new Set(FUNNEL_EVENTS).size, 8);
});

test('RLS is enabled and anon has no direct table access', async () => {
  const sql = await read('supabase/migrations/0001_init.sql');
  for (const table of ['qr_codes', 'scans', 'events']) {
    assert.match(sql, new RegExp(`alter table public\\.${table}\\s+enable row level security`));
  }
  assert.match(sql, /revoke all on table public\.qr_codes, public\.scans, public\.events from anon/);
  assert.match(sql, /grant select on table public\.scans\s+to authenticated/);
  assert.match(sql, /grant select on table public\.events\s+to authenticated/);
  assert.match(sql, /create policy "admin manages qr codes"/);
  assert.match(sql, /create policy "admin reads scans"/);
  assert.match(sql, /create policy "admin reads events"/);
});

test('the table definitions never store IP, geolocation, or fingerprints', async () => {
  const sql = await read('supabase/migrations/0001_init.sql');
  for (const table of ['qr_codes', 'scans', 'events']) {
    const start = sql.indexOf(`create table if not exists public.${table}`);
    const end = sql.indexOf(');', start);
    const block = sql.slice(start, end);
    assert.doesNotMatch(block, /\bip\b|latitude|longitude|geolocation|fingerprint|device_model/i, table);
  }
});

test('public RPCs are SECURITY DEFINER and every admin RPC requires auth.uid()', async () => {
  const sql = await read('supabase/migrations/0001_init.sql');
  const definitions = ['record_scan', 'record_event'].map((name) => {
    const start = sql.indexOf(`create or replace function public.${name}`);
    const end = sql.indexOf('$$;', sql.indexOf('as $$', start));
    return sql.slice(start, end);
  });
  for (const definition of definitions) {
    assert.match(definition, /security definer/);
    assert.match(definition, /set search_path = public, pg_temp/);
  }

  const adminRpcNames = [
    'get_overview',
    'get_qr_stats',
    'get_timeseries',
    'get_hourly_heatmap',
    'get_funnel',
    'get_variant_comparison',
    'create_qr',
    'export_scans_csv',
  ];
  for (const name of adminRpcNames) {
    const start = sql.indexOf(`create or replace function public.${name}`);
    assert.ok(start > 0, `${name} exists`);
    const next = sql.indexOf('create or replace function', start + 10);
    const block = sql.slice(start, next > 0 ? next : sql.length);
    assert.match(block, /perform public\._require_admin\(\)/, `${name} checks the admin session`);
  }
});

test('the create_qr slug generator does not depend on pgcrypto search_path', async () => {
  const init = await read('supabase/migrations/0001_init.sql');
  const fix = await read('supabase/migrations/0002_fix_create_qr_slug.sql');
  assert.doesNotMatch(init, /encode\(gen_random_bytes/);
  assert.doesNotMatch(init, /create extension if not exists pgcrypto/i);
  assert.doesNotMatch(fix, /encode\(gen_random_bytes/);
  assert.match(fix, /gen_random_uuid\(\)::text/);
  assert.match(fix, /create or replace function public\.create_qr/);
  assert.match(fix, /notify pgrst, 'reload schema'/);
});

test('the latest-scans feed is admin-only and identifies the scanned QR', async () => {
  const sql = await read('supabase/migrations/0003_recent_scans.sql');
  assert.match(sql, /create or replace function public\.get_recent_scans/);
  assert.match(sql, /perform public\._require_admin\(\)/);
  assert.match(sql, /q\.slug/);
  assert.match(sql, /q\.label/);
  assert.match(sql, /from public\.scans s/);
  assert.match(sql, /join public\.qr_codes q/);
  assert.match(sql, /grant execute on function public\.get_recent_scans\(integer\)\s+to authenticated, service_role/);
  assert.doesNotMatch(sql, /to anon/);
});

test('the optional map is an explicit OpenStreetMap embed loaded only from geolocation state', async () => {
  const landing = await read('web/landing/landing.js');
  const html = await read('web/landing/index.html');
  assert.match(landing, /openstreetmap\.org\/export\/embed\.html/);
  assert.match(html, /id="geo-map"/);
  assert.doesNotMatch(html, /id="geo-map"[^>]*src=/);
  assert.match(landing, /map\.src = mapUrl\(state\.geo\.lat, state\.geo\.lon, state\.geo\.accuracy\)/);
});

test('admin pages are marked noindex', async () => {
  for (const file of ['web/admin/index.html', 'web/admin/login.html']) {
    const html = await read(file);
    assert.match(html, /<meta name="robots" content="noindex/);
  }
});

test('third-party libraries are pinned to verified MIT versions', async () => {
  const landing = await read('web/landing/index.html');
  const admin = await read('web/admin/index.html');
  assert.match(landing, /ua-parser-js@1\.0\.39/);
  assert.doesNotMatch(landing, /ua-parser-js@2/);
  assert.match(landing, /qrcode@1\.5\.1/);
  assert.match(admin, /qrcode@1\.5\.1/);
  assert.match(admin, /chart\.js@4\.4\.7/);
  assert.doesNotMatch(landing + admin, /fingerprintjs|fingerprintjs2/i);
});

test('the API event whitelist is the same fixed eight names', async () => {
  const api = await read('web/js/api.js');
  const start = api.indexOf('const EVENTS = new Set([');
  const end = api.indexOf(']);', start);
  const block = api.slice(start, end);
  const apiEvents = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.equal(apiEvents.length, 8);
  assert.deepEqual(new Set(apiEvents), new Set(FUNNEL_EVENTS));
});

test('recordScan sends only the four documented fields', async () => {
  const api = await read('web/js/api.js');
  const start = api.indexOf('export function recordScan');
  const end = api.indexOf('export function recordEvent');
  const block = api.slice(start, end);
  const fields = [...block.matchAll(/p_[a-z_]+:/g)].map((match) => match[0]);
  assert.deepEqual(fields, ['p_slug:', 'p_visitor_id:', 'p_user_agent:', 'p_referrer:']);
});

test('recordEvent has no payload field and only accepts whitelisted names', async () => {
  const api = await read('web/js/api.js');
  const start = api.indexOf('export function recordEvent');
  const end = api.indexOf('export function ping');
  const block = api.slice(start, end);
  assert.match(block, /p_event: event/);
  assert.doesNotMatch(block, /payload|metadata|coordinates|fingerprint/i);
});

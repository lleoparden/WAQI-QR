import { LANDING_BASE_URL } from '../config.js';
import {
  createQr,
  exportScans,
  getFunnel,
  getHourlyHeatmap,
  getOverview,
  getQrStats,
  getRecentScans,
  getSession,
  getTimeseries,
  getVariantComparison,
  isConfigured,
  signOut,
  updateQr,
} from '../js/api.js';
import { pngBlobWithDpi } from './png.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  rows: [],
  recent: [],
  overview: null,
  charts: {},
  sort: { key: 'created_at', dir: 'desc' },
  chartQr: '',
  preview: null,
  logoDataUrl: null,
  goal: 500,
  loading: false,
  session: null,
};

const POSTER_SIZES = {
  a5: { width: 1748, height: 2480, label: 'A5' },
  a4: { width: 2480, height: 3508, label: 'A4' },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en-GB').format(number);
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function toLocalInput(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  } catch {
    return '';
  }
}

function landingUrl(slug) {
  const fallback = `${location.origin}${location.pathname.replace(/admin\/?$/, '')}`;
  const base = /^https?:\/\//i.test(LANDING_BASE_URL) && !/YOUR_|REPLACE_/i.test(LANDING_BASE_URL)
    ? LANDING_BASE_URL
    : fallback;
  try {
    const url = new URL(base, location.href);
    url.searchParams.set('src', slug);
    return url.href;
  } catch {
    return `${fallback}?src=${encodeURIComponent(slug)}`;
  }
}

function randomSlug() {
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  }
}

function showError(message = '') {
  const box = $('#admin-error');
  box.textContent = message;
  box.hidden = !message;
}

function setStatus(selector, message, kind = '') {
  const node = $(selector);
  node.textContent = message;
  node.classList.toggle('is-error', kind === 'error');
  node.classList.toggle('is-success', kind === 'success');
}

function handleApiError(error) {
  if (error?.status === 401) {
    location.replace('./login.html');
    return;
  }
  showError(error?.message || 'Something went wrong. Try again.');
}

function setupChartsDefaults() {
  if (!window.Chart) return;
  window.Chart.defaults.color = '#94a0ac';
  window.Chart.defaults.borderColor = 'rgba(244, 241, 232, 0.09)';
  window.Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif';
  window.Chart.defaults.font.size = 11;
  window.Chart.defaults.plugins.legend.labels.boxWidth = 10;
}

async function init() {
  if (!isConfigured()) {
    $('#config-warning').hidden = false;
    $('#admin-loading').textContent = 'Not configured';
    return;
  }

  try {
    const session = await getSession();
    if (!session) {
      location.replace('./login.html');
      return;
    }
    state.session = session;
    $('#session-email').textContent = session.user?.email || '';
  } catch {
    location.replace('./login.html');
    return;
  }

  setupChartsDefaults();
  setupHandlers();
  restoreGoal();

  await loadDashboard();

  setInterval(() => {
    if (document.hidden || state.loading) return;
    if ($('#edit-dialog')?.open) return;
    void loadDashboard({ quiet: true });
  }, 30_000);
}

function restoreGoal() {
  try {
    const stored = Number(localStorage.getItem('waqi_campaign_goal'));
    if (Number.isFinite(stored) && stored > 0) state.goal = stored;
  } catch {
    // Use the default.
  }
  $('#goal-input').value = String(state.goal);
}

function renderOverview() {
  const overview = state.overview || {};
  $('#stat-human-scans').textContent = formatNumber(overview.human_scans);
  $('#stat-total-scans').textContent = `${formatNumber(overview.total_scans)} total including bots`;
  $('#stat-unique').textContent = formatNumber(overview.human_unique_visitors);
  $('#stat-unique-all').textContent = `${formatNumber(overview.unique_visitors)} including bots`;
  $('#stat-active-qrs').textContent = formatNumber(overview.active_qr_count);
  $('#stat-24h').textContent = formatNumber(overview.scans_24h);
  $('#stat-bots-24h').textContent = `${formatNumber(overview.bot_scans_24h)} bot scans`;
  $('#stat-human-bot').textContent = `${formatNumber(overview.human_scans)} / ${formatNumber(overview.bot_scans)}`;
  renderGoal();
}

function renderGoal() {
  const scans = Number(state.overview?.human_scans || 0);
  const goal = Math.max(1, Number(state.goal) || 500);
  const percentage = Math.min(100, Math.round((scans / goal) * 100));
  $('#goal-bar').style.width = `${percentage}%`;
  $('#goal-progress').setAttribute('aria-valuenow', String(percentage));
  $('#goal-text').textContent = `${formatNumber(scans)} / ${formatNumber(goal)} human scans · ${percentage}%`;
}

function sortRows(rows) {
  const { key, dir } = state.sort;
  const direction = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a?.[key];
    const right = b?.[key];
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });
}

function renderTable() {
  const body = $('#qr-tbody');
  body.replaceChildren();
  const rows = sortRows(state.rows);
  $('#qr-empty').hidden = rows.length > 0;

  for (const row of rows) {
    const tr = document.createElement('tr');
    const slug = document.createElement('td');
    slug.className = 'mono';
    slug.textContent = row.slug;

    const label = document.createElement('td');
    label.textContent = row.label || '—';

    const placement = document.createElement('td');
    placement.className = 'muted';
    placement.textContent = row.placement || '—';

    const variant = document.createElement('td');
    variant.className = 'mono';
    variant.textContent = row.variant || '—';

    const scans = document.createElement('td');
    scans.className = 'num';
    scans.textContent = formatNumber(row.human_scans);

    const unique = document.createElement('td');
    unique.className = 'num';
    unique.textContent = formatNumber(row.unique_human_visitors);

    const last = document.createElement('td');
    last.className = 'muted';
    last.textContent = formatDate(row.last_scan_at);

    const active = document.createElement('td');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `toggle${row.active ? ' is-on' : ''}`;
    toggle.setAttribute('aria-pressed', String(Boolean(row.active)));
    toggle.setAttribute('aria-label', row.active ? 'Deactivate QR' : 'Activate QR');
    toggle.addEventListener('click', () => toggleQr(row));
    active.append(toggle);

    const actions = document.createElement('td');
    const group = document.createElement('div');
    group.className = 'table-actions';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'small-button';
    preview.textContent = 'Preview';
    preview.addEventListener('click', () => showPreview(row));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'small-button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openEdit(row));
    group.append(preview, edit);
    actions.append(group);

    tr.append(slug, label, placement, variant, scans, unique, last, active, actions);
    body.append(tr);
  }
}

function populateQrFilter() {
  const select = $('#chart-qr-filter');
  const current = state.chartQr;
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All QR codes';
  select.append(all);

  for (const row of state.rows) {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = `${row.slug} — ${row.label}`;
    select.append(option);
  }

  select.value = current && state.rows.some((row) => row.id === current) ? current : '';
  state.chartQr = select.value;
}

async function loadDashboard({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet) $('#admin-loading').textContent = 'Loading campaign data…';
  try {
    const [overview, rows] = await Promise.all([getOverview(), getQrStats()]);
    state.overview = overview || {};
    state.rows = Array.isArray(rows) ? rows : [];
    try {
      state.recent = await loadRecentScans();
    } catch (error) {
      if (error?.status === 401) throw error;
      state.recent = [];
    }
    renderOverview();
    renderTable();
    renderRecentScans();
    populateQrFilter();
    await loadCharts();
    $('#last-updated').textContent = `Synced ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    $('#admin-loading').textContent = '';
    showError('');
  } catch (error) {
    handleApiError(error);
  } finally {
    state.loading = false;
  }
}

async function loadRecentScans() {
  try {
    const rows = await getRecentScans(20);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (error?.status !== 404) throw error;
    // 0003 migration not applied yet: fall back to the existing export RPC.
    const rows = await exportScans(null);
    return (Array.isArray(rows) ? rows : []).slice(0, 20);
  }
}

function renderRecentScans() {
  const body = $('#recent-tbody');
  body.replaceChildren();
  const rows = Array.isArray(state.recent) ? state.recent : [];
  $('#recent-empty').hidden = rows.length > 0;

  for (const row of rows) {
    const tr = document.createElement('tr');

    const time = document.createElement('td');
    time.className = 'muted';
    time.textContent = formatDate(row.created_at);

    const qr = document.createElement('td');
    qr.className = 'mono';
    qr.textContent = row.slug || '—';

    const label = document.createElement('td');
    label.textContent = row.label || '—';

    const visitor = document.createElement('td');
    visitor.className = 'mono muted';
    visitor.textContent = row.visitor_id ? `${String(row.visitor_id).slice(0, 8)}…` : '—';
    if (row.visitor_id) visitor.title = String(row.visitor_id);

    const type = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `scan-badge${row.is_bot ? ' is-bot' : ''}`;
    badge.textContent = row.is_bot ? 'Bot' : 'Human';
    type.append(badge);

    tr.append(time, qr, label, visitor, type);
    body.append(tr);
  }
}

function chartBase() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    plugins: { legend: { display: true, position: 'bottom' } },
    scales: {
      x: { grid: { color: 'rgba(244,241,232,0.06)' }, ticks: { maxRotation: 0 } },
      y: { beginAtZero: true, grid: { color: 'rgba(244,241,232,0.06)' }, ticks: { precision: 0 } },
    },
  };
}

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

async function loadCharts() {
  const qrId = state.chartQr || null;
  try {
    const [series, heatmap, funnel, variants] = await Promise.all([
      getTimeseries(qrId, 30),
      getHourlyHeatmap(qrId),
      getFunnel(qrId),
      getVariantComparison(),
    ]);
    renderTimeseries(series || []);
    renderHeatmap(heatmap || []);
    renderFunnel(funnel || []);
    renderVariants(variants || []);
  } catch (error) {
    handleApiError(error);
  }
}

function renderTimeseries(rows) {
  if (!window.Chart) return;
  destroyChart('timeseries');
  state.charts.timeseries = new window.Chart($('#timeseries-chart'), {
    type: 'line',
    data: {
      labels: rows.map((row) => row.day),
      datasets: [
        {
          label: 'Human scans',
          data: rows.map((row) => Number(row.scans)),
          borderColor: '#ff5a1f',
          backgroundColor: 'rgba(255,90,31,0.12)',
          fill: true,
          tension: 0.32,
          pointRadius: 2,
          borderWidth: 2,
        },
        {
          label: 'Unique visitors',
          data: rows.map((row) => Number(row.unique_visitors)),
          borderColor: '#57d9a3',
          backgroundColor: 'rgba(87,217,163,0.08)',
          fill: false,
          tension: 0.32,
          pointRadius: 1.5,
          borderWidth: 1.5,
        },
      ],
    },
    options: chartBase(),
  });
}

function renderFunnel(rows) {
  if (!window.Chart) return;
  destroyChart('funnel');
  state.charts.funnel = new window.Chart($('#funnel-chart'), {
    type: 'bar',
    data: {
      labels: rows.map((row) => String(row.stage).replace(/_/g, ' ')),
      datasets: [{
        label: 'Unique humans',
        data: rows.map((row) => Number(row.count)),
        backgroundColor: rows.map((_, index) => `rgba(255,90,31,${Math.max(0.22, 0.9 - index * 0.07)})`),
        borderRadius: 4,
      }],
    },
    options: {
      ...chartBase(),
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (context) => {
              const row = rows[context.dataIndex];
              return `${row?.conversion_pct ?? 0}% of scans`;
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: 'rgba(244,241,232,0.06)' }, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  });
}

function renderVariants(rows) {
  if (!window.Chart) return;
  destroyChart('variants');
  state.charts.variants = new window.Chart($('#variants-chart'), {
    type: 'bar',
    data: {
      labels: rows.map((row) => row.variant || '(untagged)'),
      datasets: [
        {
          label: 'Reveal completed %',
          data: rows.map((row) => Number(row.reveal_completed_rate || 0)),
          backgroundColor: 'rgba(87,217,163,0.7)',
          borderRadius: 4,
        },
        {
          label: 'CTA click %',
          data: rows.map((row) => Number(row.cta_click_rate || 0)),
          backgroundColor: 'rgba(255,90,31,0.75)',
          borderRadius: 4,
        },
      ],
    },
    options: {
      ...chartBase(),
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, max: 100, grid: { color: 'rgba(244,241,232,0.06)' }, ticks: { callback: (value) => `${value}%` } },
      },
    },
  });
}

function renderHeatmap(rows) {
  const container = $('#heatmap');
  container.replaceChildren();
  const counts = new Map();
  let max = 0;
  for (const row of rows) {
    const key = `${Number(row.weekday)}:${Number(row.hour)}`;
    const count = Number(row.scans || 0);
    counts.set(key, count);
    if (count > max) max = count;
  }

  const spacer = document.createElement('span');
  container.append(spacer);
  for (let hour = 0; hour < 24; hour += 1) {
    const label = document.createElement('span');
    label.className = 'hm-hour';
    label.textContent = String(hour).padStart(2, '0');
    container.append(label);
  }

  DAYS.forEach((day, weekday) => {
    const label = document.createElement('span');
    label.className = 'hm-label';
    label.textContent = day;
    container.append(label);
    for (let hour = 0; hour < 24; hour += 1) {
      const count = counts.get(`${weekday}:${hour}`) || 0;
      const cell = document.createElement('span');
      cell.className = 'hm-cell';
      cell.dataset.count = String(count);
      const ratio = max ? count / max : 0;
      cell.style.background = count
        ? `rgba(255,90,31,${0.1 + ratio * 0.9})`
        : 'rgba(255,255,255,0.04)';
      cell.title = `${day} ${String(hour).padStart(2, '0')}:00 — ${count} human scans`;
      container.append(cell);
    }
  });
}

function setupHandlers() {
  $('#logout').addEventListener('click', async () => {
    await signOut();
    location.replace('./login.html');
  });

  $('#refresh').addEventListener('click', () => {
    showError('');
    void loadDashboard();
  });

  $('#goal-input').addEventListener('change', (event) => {
    const value = Math.max(1, Number(event.target.value) || 500);
    state.goal = value;
    event.target.value = String(value);
    try {
      localStorage.setItem('waqi_campaign_goal', String(value));
    } catch {
      // The tracker still works for this session.
    }
    renderGoal();
  });

  $$('.qr-table th button[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { key, dir: 'asc' };
      }
      renderTable();
    });
  });

  $('#create-form').addEventListener('submit', onCreate);
  $('#close-preview').addEventListener('click', () => {
    $('#qr-preview-panel').hidden = true;
  });
  $('#qr-png').addEventListener('click', downloadQrPng);
  $('#qr-svg').addEventListener('click', downloadQrSvg);
  $('#poster-download').addEventListener('click', downloadPoster);
  $('#poster-cta-en').addEventListener('click', () => {
    $('#poster-cta').value = 'Would you scan this?';
  });
  $('#poster-cta-ar').addEventListener('click', () => {
    $('#poster-cta').value = 'هتعمل scan؟';
  });
  $('#poster-logo').addEventListener('change', onLogoChange);
  $('#chart-qr-filter').addEventListener('change', async (event) => {
    state.chartQr = event.target.value;
    await loadCharts();
  });

  $('#csv-stats').addEventListener('click', downloadStatsCsv);
  $('#csv-scans').addEventListener('click', downloadScansCsv);

  $('#edit-form').addEventListener('submit', onEditSubmit);
  $('#edit-close').addEventListener('click', closeEdit);
  $('#edit-cancel').addEventListener('click', closeEdit);
}

async function onCreate(event) {
  event.preventDefault();
  const button = $('#create-form button[type="submit"]');
  button.disabled = true;
  setStatus('#create-status', 'Creating…');
  try {
    const row = await createQr({
      label: $('#create-label').value.trim(),
      placement: $('#create-placement').value.trim(),
      slug: $('#create-slug').value.trim() || randomSlug(),
      variant: $('#create-variant').value.trim(),
    });
    $('#create-form').reset();
    setStatus('#create-status', `Created /${row.slug}`, 'success');
    state.chartQr = row.id;
    showPreview(row);
    await loadDashboard();
  } catch (error) {
    if (error?.status === 401) return handleApiError(error);
    const message = /duplicate key|qr_codes_slug_key/i.test(String(error?.message || ''))
      ? 'That slug is already taken. Choose another.'
      : error?.message || 'Could not create the QR.';
    setStatus('#create-status', message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function toggleQr(row) {
  try {
    await updateQr(row.id, { active: !row.active });
    await loadDashboard({ quiet: true });
  } catch (error) {
    handleApiError(error);
  }
}

async function ensureQrLibrary() {
  if (window.QRCode?.toCanvas) return true;
  setStatus('#poster-status', 'QR library failed to load. Check the CDN or your connection.', 'error');
  return false;
}

async function makeQrCanvas(url, size) {
  if (!(await ensureQrLibrary())) throw new Error('QR library unavailable');
  const canvas = document.createElement('canvas');
  await window.QRCode.toCanvas(canvas, url, {
    errorCorrectionLevel: 'H',
    width: size,
    margin: 2,
    color: { dark: '#05070a', light: '#ffffff' },
  });
  return canvas;
}

async function showPreview(row) {
  state.preview = row;
  const panel = $('#qr-preview-panel');
  panel.hidden = false;
  const url = landingUrl(row.slug);
  $('#qr-url').textContent = url;
  setStatus('#poster-status', '');
  try {
    await window.QRCode.toCanvas($('#qr-preview'), url, {
      errorCorrectionLevel: 'H',
      width: 360,
      margin: 2,
      color: { dark: '#05070a', light: '#ffffff' },
    });
  } catch {
    setStatus('#poster-status', 'Could not draw the QR. Check that the qrcode CDN loaded.', 'error');
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadQrPng() {
  if (!state.preview) return;
  try {
    const canvas = await makeQrCanvas(landingUrl(state.preview.slug), 1600);
    const blob = await canvasBlob(canvas);
    if (!blob) throw new Error('No image');
    downloadBlob(blob, `waqi-${state.preview.slug}-qr.png`);
  } catch (error) {
    setStatus('#poster-status', error?.message || 'Could not export PNG.', 'error');
  }
}

async function downloadQrSvg() {
  if (!state.preview) return;
  try {
    if (!(await ensureQrLibrary())) return;
    const svg = await window.QRCode.toString(landingUrl(state.preview.slug), {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 1024,
      color: { dark: '#05070a', light: '#ffffff' },
    });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `waqi-${state.preview.slug}-qr.svg`);
  } catch (error) {
    setStatus('#poster-status', error?.message || 'Could not export SVG.', 'error');
  }
}

function onLogoChange(event) {
  const file = event.target.files?.[0];
  state.logoDataUrl = null;
  if (!file) return;
  if (file.size > 2_000_000) {
    setStatus('#poster-status', 'Logo must be under 2 MB.', 'error');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.logoDataUrl = String(reader.result || '');
    setStatus('#poster-status', 'Logo loaded. It will sit inside the QR at high error correction.', 'success');
  };
  reader.onerror = () => setStatus('#poster-status', 'Could not read that image.', 'error');
  reader.readAsDataURL(file);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawLines(ctx, text, x, y, maxWidth, lineHeight, maxLines = 6) {
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

async function drawPoster() {
  if (!state.preview) throw new Error('Create or preview a QR first.');
  const size = POSTER_SIZES[$('#poster-size').value] || POSTER_SIZES.a5;
  const cta = $('#poster-cta').value.trim() || 'Would you scan this?';
  const rtl = /[\u0600-\u06FF]/.test(cta);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');

  const W = canvas.width;
  const H = canvas.height;
  const margin = Math.round(W * 0.075);
  const cream = '#f4f1e8';
  const ink = '#11151a';
  const orange = '#ff5a1f';

  ctx.fillStyle = cream;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(17,21,26,0.15)';
  ctx.lineWidth = Math.max(2, Math.round(W * 0.0015));
  ctx.strokeRect(margin * 0.55, margin * 0.55, W - margin * 1.1, H - margin * 1.1);

  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  const x = rtl ? W - margin : margin;
  const maxWidth = W - margin * 2;
  const font = rtl
    ? '"Segoe UI", Tahoma, "Noto Naskh Arabic", Arial, sans-serif'
    : '"Segoe UI", Helvetica, Arial, sans-serif';

  ctx.fillStyle = orange;
  ctx.fillRect(rtl ? W - margin - W * 0.08 : margin, margin * 0.9, W * 0.08, W * 0.007);

  ctx.fillStyle = ink;
  ctx.font = `800 ${Math.round(W * 0.035)}px ui-monospace, Consolas, monospace`;
  ctx.fillText('WAQI', x, margin * 1.55);

  ctx.fillStyle = orange;
  ctx.font = `700 ${Math.round(W * 0.011)}px ui-monospace, Consolas, monospace`;
  ctx.fillText(rtl ? 'توعية رموز QR' : 'QR AWARENESS', x, margin * 1.55 + W * 0.022);

  const ctaSize = Math.round(W * 0.064);
  ctx.fillStyle = ink;
  ctx.font = `800 ${ctaSize}px ${font}`;
  let ctaBottom = drawLines(ctx, cta, x, H * 0.16, maxWidth, ctaSize * 1.12, 4);

  ctx.fillStyle = 'rgba(17,21,26,0.62)';
  ctx.font = `500 ${Math.round(W * 0.023)}px ${font}`;
  const subtitle = rtl
    ? 'رمز QR هو لينك. خد وقفة قبل ما تضغط.'
    : 'A QR code is a link. Pause before you tap.';
  ctaBottom = drawLines(ctx, subtitle, x, ctaBottom + W * 0.03, maxWidth, W * 0.032, 2);

  const qrSize = Math.round(Math.min(W * 0.62, H * 0.42));
  const qrX = Math.round((W - qrSize) / 2);
  const qrY = Math.round(Math.max(ctaBottom + W * 0.045, H * 0.39));
  const cardPad = Math.round(W * 0.035);

  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, qrX - cardPad, qrY - cardPad, qrSize + cardPad * 2, qrSize + cardPad * 2, W * 0.02);
  ctx.fill();
  ctx.strokeStyle = 'rgba(17,21,26,0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const qrCanvas = await makeQrCanvas(landingUrl(state.preview.slug), qrSize);
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  if (state.logoDataUrl) {
    try {
      const logo = await loadImage(state.logoDataUrl);
      const logoSize = Math.round(qrSize * 0.19);
      const logoX = qrX + (qrSize - logoSize) / 2;
      const logoY = qrY + (qrSize - logoSize) / 2;
      const pad = Math.round(logoSize * 0.14);
      ctx.fillStyle = '#ffffff';
      roundedRect(ctx, logoX - pad, logoY - pad, logoSize + pad * 2, logoSize + pad * 2, logoSize * 0.16);
      ctx.fill();
      const ratio = Math.min(logoSize / logo.width, logoSize / logo.height);
      const drawW = logo.width * ratio;
      const drawH = logo.height * ratio;
      ctx.drawImage(logo, logoX + (logoSize - drawW) / 2, logoY + (logoSize - drawH) / 2, drawW, drawH);
    } catch {
      // A bad logo must not stop the poster export.
    }
  }

  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.fillStyle = 'rgba(17,21,26,0.55)';
  ctx.font = `600 ${Math.round(W * 0.012)}px ${font}`;
  ctx.fillText(rtl ? 'WAQI · توعية ضد النصب · مصر' : 'WAQI · Anti-scam awareness · Egypt', x, H - margin * 0.8);

  return { canvas, size };
}

async function downloadPoster() {
  const button = $('#poster-download');
  button.disabled = true;
  setStatus('#poster-status', 'Drawing print-resolution poster…');
  try {
    const { canvas, size } = await drawPoster();
    const blob = await canvasBlob(canvas);
    if (!blob) throw new Error('Could not create the poster.');
    const printBlob = await pngBlobWithDpi(blob, 300);
    downloadBlob(printBlob, `waqi-${state.preview.slug}-poster-${size.label.toLowerCase()}-300dpi.png`);
    setStatus('#poster-status', `Downloaded ${size.label} at 300 DPI.`, 'success');
  } catch (error) {
    setStatus('#poster-status', error?.message || 'Could not create the poster.', 'error');
  } finally {
    button.disabled = false;
  }
}

function openEdit(row) {
  $('#edit-id').value = row.id;
  $('#edit-slug').value = row.slug;
  $('#edit-label').value = row.label || '';
  $('#edit-placement').value = row.placement || '';
  $('#edit-variant').value = row.variant || '';
  $('#edit-starts').value = toLocalInput(row.starts_at);
  $('#edit-expires').value = toLocalInput(row.expires_at);
  $('#edit-active').checked = Boolean(row.active);
  setStatus('#edit-status', '');
  const dialog = $('#edit-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeEdit() {
  const dialog = $('#edit-dialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function onEditSubmit(event) {
  event.preventDefault();
  const id = $('#edit-id').value;
  const button = $('#edit-form button[type="submit"]');
  button.disabled = true;
  setStatus('#edit-status', 'Saving…');
  try {
    await updateQr(id, {
      label: $('#edit-label').value.trim(),
      placement: $('#edit-placement').value.trim() || null,
      variant: $('#edit-variant').value.trim() || null,
      active: $('#edit-active').checked,
      starts_at: $('#edit-starts').value ? new Date($('#edit-starts').value).toISOString() : null,
      expires_at: $('#edit-expires').value ? new Date($('#edit-expires').value).toISOString() : null,
    });
    closeEdit();
    await loadDashboard();
  } catch (error) {
    if (error?.status === 401) return handleApiError(error);
    setStatus('#edit-status', error?.message || 'Could not save changes.', 'error');
  } finally {
    button.disabled = false;
  }
}

function toCsv(rows, columns) {
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map((column) => escape(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => escape(row[column.key])).join(','));
  return `\uFEFF${[header, ...body].join('\r\n')}`;
}

function downloadStatsCsv() {
  if (!state.rows.length) {
    setStatus('#create-status', 'No QR stats to export yet.');
    return;
  }
  const csv = toCsv(state.rows, [
    { key: 'slug', label: 'slug' },
    { key: 'label', label: 'label' },
    { key: 'placement', label: 'placement' },
    { key: 'variant', label: 'variant' },
    { key: 'active', label: 'active' },
    { key: 'total_scans', label: 'total_scans' },
    { key: 'human_scans', label: 'human_scans' },
    { key: 'bot_scans', label: 'bot_scans' },
    { key: 'unique_visitors', label: 'unique_visitors' },
    { key: 'unique_human_visitors', label: 'unique_human_visitors' },
    { key: 'scans_24h', label: 'scans_24h' },
    { key: 'last_scan_at', label: 'last_scan_at' },
    { key: 'created_at', label: 'created_at' },
  ]);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'waqi-per-qr-stats.csv');
}

async function downloadScansCsv() {
  const button = $('#csv-scans');
  button.disabled = true;
  try {
    const rows = await exportScans(state.chartQr || null);
    if (!rows?.length) {
      setStatus('#create-status', 'No scans to export for this filter.');
      return;
    }
    const csv = toCsv(rows, [
      { key: 'id', label: 'id' },
      { key: 'created_at', label: 'created_at' },
      { key: 'qr_id', label: 'qr_id' },
      { key: 'slug', label: 'slug' },
      { key: 'visitor_id', label: 'visitor_id' },
      { key: 'user_agent', label: 'user_agent' },
      { key: 'referrer', label: 'referrer' },
      { key: 'is_bot', label: 'is_bot' },
    ]);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'waqi-scans.csv');
  } catch (error) {
    handleApiError(error);
  } finally {
    button.disabled = false;
  }
}

if (document.readyState === 'complete') init();
else window.addEventListener('load', init, { once: true });

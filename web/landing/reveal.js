// Local-only reveal engine. This file must never import api.js, never call our
// backend, and never persist revealed data. It only talks to two public IP
// lookup services, which is disclosed on the page.
//
// Everything else is read from the browser and rendered on screen.

import { guessDevice, parseUserAgent } from './guessDevice.js';

export const REVEAL_ORDER = [
  'device',
  'brand',
  'screen',
  'locale',
  'hardware',
  'gpu',
  'fingerprint',
  'network',
];

const FONT_CANDIDATES = [
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
  'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console',
  'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe UI', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings',
  'Helvetica', 'Helvetica Neue', 'Menlo', 'Monaco', 'SF Pro Text', 'Roboto',
  'Noto Sans', 'Noto Naskh Arabic', 'Cairo', 'Almarai', 'Geeza Pro',
  'Kohinoor Arabic', 'Dubai', 'Sakkal Majalla', 'Traditional Arabic',
  'Simplified Arabic', 'Andalus', 'Diwani Bent', 'Arial Unicode MS',
];

const BASE_FONTS = ['monospace', 'sans-serif', 'serif'];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readHighEntropy() {
  try {
    if (!navigator.userAgentData?.getHighEntropyValues) return {};
    return await withTimeout(
      navigator.userAgentData.getHighEntropyValues([
        'model',
        'platformVersion',
        'architecture',
        'bitness',
        'fullVersionList',
      ]),
      1500
    );
  } catch {
    return {};
  }
}

function readGpu() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { renderer: '', vendor: '' };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug ? clean(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : clean(gl.getParameter(gl.RENDERER)),
      vendor: debug ? clean(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : clean(gl.getParameter(gl.VENDOR)),
    };
  } catch {
    return { renderer: '', vendor: '' };
  }
}

function readUaParser() {
  try {
    if (typeof window.UAParser !== 'function') return null;
    const result = new window.UAParser(navigator.userAgent).getResult();
    return {
      browserName: clean(result.browser?.name),
      browserVersion: clean(result.browser?.version),
      osName: clean(result.os?.name),
      osVersion: clean(result.os?.version),
      deviceType: clean(result.device?.type),
      deviceVendor: clean(result.device?.vendor),
      deviceModel: clean(result.device?.model),
    };
  } catch {
    return null;
  }
}

async function readBattery() {
  try {
    if (typeof navigator.getBattery !== 'function') return null;
    const battery = await withTimeout(navigator.getBattery(), 1500);
    return {
      level: Number.isFinite(Number(battery.level)) ? Number(battery.level) : null,
      charging: Boolean(battery.charging),
    };
  } catch {
    return null;
  }
}

function readConnection() {
  try {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return clean(connection?.effectiveType).toUpperCase();
  } catch {
    return '';
  }
}

function readMedia(query) {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function readLocale(lang) {
  try {
    const languages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language].filter(Boolean);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return {
      languages,
      timezone,
      localTime: formatLocalTime(new Date(), lang),
    };
  } catch {
    return { languages: [], timezone: '', localTime: '' };
  }
}

export function formatLocalTime(date, lang) {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return '';
  }
}

function canvasSignal() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const gradient = ctx.createLinearGradient(0, 0, 320, 90);
    gradient.addColorStop(0, '#f60');
    gradient.addColorStop(0.5, '#0af');
    gradient.addColorStop(1, '#111');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 320, 90);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '17px "Arial"';
    ctx.fillText('WAQI fingerprint 0123456789', 8, 28);
    ctx.font = 'italic 15px "Times New Roman"';
    ctx.fillText('كشف محلي · local only · 0.8s', 8, 54);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(260, 45, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(20,20,20,0.35)';
    ctx.beginPath();
    ctx.moveTo(40, 82);
    ctx.lineTo(120, 62);
    ctx.lineTo(190, 80);
    ctx.closePath();
    ctx.fill();
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

async function audioSignal() {
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return '';
    const context = new Ctx(1, 4410, 44100);
    const oscillator = context.createOscillator();
    const compressor = context.createDynamicsCompressor();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 10000;
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);
    const buffer = await withTimeout(context.startRendering(), 1500);
    const data = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += Math.abs(data[i]);
    return String(sum);
  } catch {
    return '';
  }
}

function detectFonts() {
  try {
    if (!document.body) return { count: 0, names: [] };
    const span = document.createElement('span');
    span.textContent = 'mmmmmmmmmmlli1|';
    span.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;font-size:72px;white-space:nowrap;';
    document.body.appendChild(span);

    const baseWidths = BASE_FONTS.map((base) => {
      span.style.fontFamily = base;
      return span.offsetWidth;
    });

    const names = [];
    for (const font of FONT_CANDIDATES) {
      const differs = BASE_FONTS.some((base, index) => {
        span.style.fontFamily = `"${font}", ${base}`;
        return span.offsetWidth !== baseWidths[index];
      });
      if (differs) names.push(font);
    }

    span.remove();
    return { count: names.length, names };
  } catch {
    return { count: 0, names: [] };
  }
}

async function buildFingerprint(gpu) {
  try {
    const canvas = canvasSignal();
    const audio = await audioSignal();
    const fonts = detectFonts();
    const material = [
      canvas,
      gpu.renderer,
      gpu.vendor,
      audio,
      fonts.names.join(','),
      `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      navigator.language || '',
    ].join('|');

    let id = '';
    if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(material)
      );
      id = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 12);
    }

    return { id, fonts: fonts.count };
  } catch {
    return { id: '', fonts: 0 };
  }
}

async function fetchWithTimeout(url, ms, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseCloudflareTrace(text) {
  const fields = {};
  for (const line of String(text).split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) fields[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return fields;
}

async function lookupNetwork() {
  try {
    const response = await fetchWithTimeout('https://ipwho.is/', 5000, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('ipwho');
    const data = await response.json();
    if (data?.success === false) throw new Error('ipwho');
    if (data?.ip) {
      return {
        ok: true,
        ip: clean(data.ip),
        city: clean(data.city),
        country: clean(data.country),
        isp: clean(data.connection?.isp || data.connection?.org),
        source: 'ipwho.is',
      };
    }
  } catch {
    // Fall through to Cloudflare's text endpoint.
  }

  try {
    const response = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', 5000);
    if (!response.ok) throw new Error('cloudflare');
    const fields = parseCloudflareTrace(await response.text());
    if (fields.ip || fields.loc) {
      return {
        ok: true,
        ip: clean(fields.ip),
        city: '',
        country: clean(fields.loc),
        isp: '',
        source: 'Cloudflare trace',
      };
    }
  } catch {
    // Graceful degradation: the page must render offline.
  }

  return { ok: false, ip: '', city: '', country: '', isp: '', source: '' };
}

export async function createRevealState(lang = 'en') {
  const userAgent = navigator.userAgent || '';
  const uaData = navigator.userAgentData
    ? {
        brands: navigator.userAgentData.brands || [],
        mobile: Boolean(navigator.userAgentData.mobile),
        platform: navigator.userAgentData.platform || '',
      }
    : null;

  const highEntropy = await readHighEntropy();
  const parsed = parseUserAgent(userAgent, uaData);
  const screen = {
    width: window.screen?.width || window.innerWidth || 0,
    height: window.screen?.height || window.innerHeight || 0,
    dpr: Number(window.devicePixelRatio) || 1,
    touchPoints: Number(navigator.maxTouchPoints) || 0,
  };
  const gpu = readGpu();
  const locale = readLocale(lang);
  const hardware = {
    cores: Number(navigator.hardwareConcurrency) || 0,
    memory: Number(navigator.deviceMemory) || 0,
    connection: readConnection(),
    battery: null,
    dark: readMedia('(prefers-color-scheme: dark)'),
    reducedMotion: readMedia('(prefers-reduced-motion: reduce)'),
  };

  const signals = {
    userAgent,
    uaData,
    highEntropy,
    uaParser: readUaParser(),
    parsed,
    screen,
    locale,
    hardware,
    gpu,
    brand: null,
    fingerprint: null,
    network: null,
  };

  signals.brand = guessDevice({
    userAgent,
    uaData,
    highEntropy,
    uaParser: signals.uaParser,
    screen,
    devicePixelRatio: screen.dpr,
    webglRenderer: gpu.renderer,
    touchPoints: screen.touchPoints,
  });

  const state = {
    signals,
    rows: {},
    lang,
    batteryPromise: readBattery(),
    fingerprintPromise: buildFingerprint(gpu),
    networkPromise: lookupNetwork(),
  };

  return state;
}

export async function resolveRevealRow(state, key) {
  if (state.rows[key]) return state.rows[key];

  let data;
  switch (key) {
    case 'device':
      data = {
        type: state.signals.parsed.type,
        osName: state.signals.parsed.osName,
        osVersion: state.signals.parsed.osVersion,
        browserName: state.signals.parsed.browserName,
        browserVersion: state.signals.parsed.browserVersion,
        uaParser: state.signals.uaParser,
      };
      break;
    case 'brand':
      data = state.signals.brand;
      break;
    case 'screen':
      data = state.signals.screen;
      break;
    case 'locale':
      data = state.signals.locale;
      break;
    case 'hardware': {
      const battery = await state.batteryPromise;
      state.signals.hardware.battery = battery;
      data = state.signals.hardware;
      break;
    }
    case 'gpu':
      data = state.signals.gpu;
      break;
    case 'fingerprint': {
      const fingerprint = await state.fingerprintPromise;
      state.signals.fingerprint = fingerprint;
      data = fingerprint;
      break;
    }
    case 'network': {
      const network = await state.networkPromise;
      state.signals.network = network;
      data = network;
      break;
    }
    default:
      data = null;
  }

  state.rows[key] = data;
  return data;
}

function numberLine(label, value, fallback) {
  return { label, value: value === 0 || value ? String(value) : fallback };
}

export function formatRow(key, data, copy, lang = 'en') {
  const reveal = copy.reveal;
  const fallback = reveal.notExposed || copy.common?.notAvailable || 'not exposed by your browser';
  const out = {
    key,
    label: reveal.labels[key] || key,
    why: reveal.why[key] || '',
    summary: fallback,
    lines: [],
    scary: false,
  };

  try {
    if (!data) return out;

    if (key === 'device') {
      const type = reveal.deviceType[data.type] || data.type || fallback;
      const parsedOs = [data.uaParser?.osName || data.osName, data.uaParser?.osVersion || data.osVersion]
        .filter(Boolean)
        .join(' ') || fallback;
      const parsedBrowser = [data.uaParser?.browserName || data.browserName, data.uaParser?.browserVersion || data.browserVersion]
        .filter(Boolean)
        .join(' ') || fallback;
      out.summary = [type, parsedOs, parsedBrowser].join(' · ');
      out.lines = [
        { label: reveal.kind, value: type },
        { label: reveal.os, value: parsedOs },
        { label: reveal.browser, value: parsedBrowser },
      ];
    } else if (key === 'brand') {
      const brand = clean(data.brand) || fallback;
      const model = clean(data.model) || fallback;
      out.summary = `${brand} · ${model}`;
      out.lines = [
        { label: reveal.confidence, value: `${data.confidence}%` },
        { label: reveal.because, value: data.evidence?.length ? data.evidence.join(' · ') : fallback },
        { label: '', value: reveal.guessNotice },
      ];
      out.scary = true;
    } else if (key === 'screen') {
      if (data.width && data.height) {
        out.summary = `${data.width} × ${data.height}`;
        out.lines = [
          { label: reveal.screenSize, value: `${data.width} × ${data.height}` },
          { label: reveal.pixelRatio, value: data.dpr ? `${data.dpr}x` : fallback },
          { label: reveal.touch, value: data.touchPoints ? String(data.touchPoints) : fallback },
        ];
      }
    } else if (key === 'locale') {
      const languages = data.languages?.length ? data.languages.join(', ') : fallback;
      out.summary = languages;
      out.lines = [
        { label: reveal.languages, value: languages },
        { label: reveal.timezone, value: data.timezone || fallback },
        { label: reveal.localTime, value: data.localTime || fallback },
      ];
    } else if (key === 'hardware') {
      const battery = data.battery;
      const batteryValue = battery && Number.isFinite(battery.level)
        ? `${Math.round(battery.level * 100)}% ${battery.charging ? reveal.batteryCharging : reveal.batteryNotCharging}`
        : fallback;
      const pieces = [];
      if (data.cores) pieces.push(`${data.cores} ${reveal.cores.toLowerCase()}`);
      if (data.memory) pieces.push(`${data.memory} GB`);
      if (data.connection) pieces.push(data.connection);
      out.summary = pieces.length ? pieces.join(' · ') : fallback;
      out.lines = [
        numberLine(reveal.cores, data.cores, fallback),
        { label: reveal.memory, value: data.memory ? `${data.memory} GB` : fallback },
        { label: reveal.connection, value: data.connection || fallback },
        { label: reveal.battery, value: batteryValue },
        { label: reveal.theme, value: data.dark ? reveal.dark : reveal.light },
        { label: reveal.motion, value: data.reducedMotion ? reveal.reduced : reveal.fullMotion },
      ];
    } else if (key === 'gpu') {
      const renderer = clean(data.renderer);
      out.summary = renderer || fallback;
      out.lines = renderer
        ? [{ label: 'GPU', value: renderer }]
        : [{ label: 'GPU', value: fallback }];
    } else if (key === 'fingerprint') {
      const id = clean(data.id);
      out.summary = id ? `SHA-256 · ${id}` : fallback;
      out.lines = [
        { label: reveal.fingerprintId, value: id || fallback },
        {
          label: reveal.fonts,
          value: data.fonts ? `${data.fonts} ${reveal.fontsDetected}` : fallback,
        },
        { label: '', value: reveal.privateNoStore },
      ];
      out.scary = true;
    } else if (key === 'network') {
      if (data.ok) {
        const place = [data.city, data.country].filter(Boolean).join(' · ');
        out.summary = place || data.ip || fallback;
        out.lines = [
          { label: reveal.ip, value: data.ip || fallback },
          { label: reveal.city, value: data.city || fallback },
          { label: reveal.country, value: data.country || fallback },
          { label: reveal.isp, value: data.isp || fallback },
          { label: reveal.source, value: data.source || fallback },
          { label: '', value: reveal.approximate },
        ];
        out.scary = true;
      }
    }
  } catch {
    // A broken sensor returns the fallback row, never a broken page.
  }

  return out;
}

export function formatRows(state, copy, lang = 'en') {
  return REVEAL_ORDER
    .filter((key) => Object.prototype.hasOwnProperty.call(state.rows, key))
    .map((key) => formatRow(key, state.rows[key], copy, lang));
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function detectCarrier(isp, copy) {
  const value = String(isp || '').toLowerCase();
  if (value.includes('vodafone')) return { name: 'Vodafone Cash', slug: 'vodafone-cash' };
  if (value.includes('orange')) return { name: 'Orange Cash', slug: 'orange-cash' };
  if (value.includes('etisalat') || value.includes('e&')) return { name: 'Etisalat Cash', slug: 'etisalat-cash' };
  if (/\bwe\b/.test(value) || value.includes('telecom egypt')) return { name: 'WE Pay', slug: 'we-pay' };
  return { name: copy.scammer.genericCarrier, slug: 'wallet' };
}

function fill(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

export function buildScams(state, copy, lang = 'en') {
  const signals = state.signals;
  const brandName = clean(signals.brand?.brand);
  const model = clean(signals.brand?.model);
  const isDesktop = brandName === 'Desktop';
  const hasBrand = brandName && brandName !== 'Unknown' && !isDesktop;
  const needsAn = /^(apple|oppo|infinix|honor)/i.test(brandName) || /^[aeiou]/i.test(brandName);
  const brand = hasBrand
    ? (lang === 'en' ? `${needsAn ? 'an' : 'a'} ${brandName}` : brandName)
    : copy.scammer.genericBrand;
  const device = isDesktop && model
    ? model
    : hasBrand && model
      ? `${brandName} ${model}`
      : copy.scammer.genericDevice;
  const city = clean(signals.network?.city) || copy.scammer.genericCity;
  const battery = Number.isFinite(signals.hardware?.battery?.level)
    ? `${Math.round(signals.hardware.battery.level * 100)}%`
    : copy.scammer.genericBattery;
  const carrier = detectCarrier(signals.network?.isp, copy);
  const time = formatLocalTime(new Date(), lang) || copy.common.unknown;
  const browserName = clean(signals.parsed?.browserName);
  const browserVersion = clean(signals.parsed?.browserVersion);
  const browser = browserName && browserName !== 'Unknown browser'
    ? `${browserName} ${browserVersion}`.trim()
    : copy.scammer.genericBrowser;
  const citySlug = slugify(city, 'city');

  const values = {
    brand,
    device,
    city,
    citySlug,
    battery,
    time,
    browser,
    carrier: carrier.name,
    carrierSlug: carrier.slug,
  };

  return {
    knows: fill(copy.scammer.knows, values),
    realScammer: fill(copy.scammer.realScammer, values),
    cards: copy.scammer.cards.map((card) => ({
      id: card.id,
      from: fill(card.from, values),
      title: fill(card.title, values),
      body: fill(card.body, values),
      cta: fill(card.cta, values),
      url: fill(card.url, values),
    })),
    city,
    brand,
    device,
    battery,
    time,
  };
}

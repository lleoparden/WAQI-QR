// Local-only reveal engine. This file must never import api.js, never call our
// backend, and never persist revealed data. It only talks to three public IP
// lookup services, which is disclosed on the page.
//
// Everything else is read from the browser and rendered on screen.

import { guessDevice, parseUserAgent } from './guessDevice.js';
import { identifyCarrier } from './carriers.js';

export const REVEAL_ORDER = [
  'device',
  'brand',
  'screen',
  'locale',
  'hardware',
  'gpu',
  'fingerprint',
  'network',
  'arrival',
  'attention',
];

const SESSION_STARTED_AT = globalThis.performance?.now?.() ?? Date.now();

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
    if (!gl) return { renderer: '', vendor: '', version: '', shading: '', maxTexture: 0 };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug ? clean(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : clean(gl.getParameter(gl.RENDERER)),
      vendor: debug ? clean(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : clean(gl.getParameter(gl.VENDOR)),
      version: clean(gl.getParameter(gl.VERSION)),
      shading: clean(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
      maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
    };
  } catch {
    return { renderer: '', vendor: '', version: '', shading: '', maxTexture: 0 };
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
      engineName: clean(result.engine?.name),
      engineVersion: clean(result.engine?.version),
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

async function readStorage() {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await withTimeout(navigator.storage.estimate(), 1200);
    return {
      quota: Number(estimate.quota) || 0,
      usage: Number(estimate.usage) || 0,
    };
  } catch {
    return null;
  }
}

function readArrival() {
  try {
    const referrer = clean(document.referrer);
    if (!referrer) return null;
    const url = new URL(referrer);
    if (url.hostname === location.hostname) return null;
    return { referrer, host: url.hostname };
  } catch {
    return null;
  }
}

function readConnection() {
  try {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return null;
    return {
      effectiveType: clean(connection.effectiveType).toUpperCase(),
      downlink: Number.isFinite(Number(connection.downlink)) ? Number(connection.downlink) : null,
      rtt: Number.isFinite(Number(connection.rtt)) ? Number(connection.rtt) : null,
      saveData: Boolean(connection.saveData),
    };
  } catch {
    return null;
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
    const options = Intl.DateTimeFormat().resolvedOptions();
    return {
      languages,
      timezone: options.timeZone || '',
      localTime: formatLocalTime(new Date(), lang),
      utcOffset: -new Date().getTimezoneOffset(),
      calendar: clean(options.calendar),
      numberingSystem: clean(options.numberingSystem),
    };
  } catch {
    return {
      languages: [],
      timezone: '',
      localTime: '',
      utcOffset: null,
      calendar: '',
      numberingSystem: '',
    };
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

async function shortHash(value, length) {
  try {
    if (!value || !globalThis.crypto?.subtle || !globalThis.TextEncoder) return '';
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value)
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, length);
  } catch {
    return '';
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
      gpu.version,
      audio,
      fonts.names.join(','),
      `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      navigator.language || '',
    ].join('|');

    const [id, canvasId, audioId] = await Promise.all([
      shortHash(material, 12),
      shortHash(canvas, 8),
      shortHash(audio, 8),
    ]);

    return { id, canvasId, audioId, fonts: fonts.count };
  } catch {
    return { id: '', canvasId: '', audioId: '', fonts: 0 };
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
      const asn = data.connection?.asn ? `AS${data.connection.asn}` : '';
      const ispName = clean(data.connection?.isp);
      const orgName = clean(data.connection?.org);
      const carrier = identifyCarrier({ isp: ispName, org: orgName, asn });
      return {
        ok: true,
        ip: clean(data.ip),
        city: clean(data.city),
        region: clean(data.region),
        country: clean(data.country),
        isp: orgName || ispName,
        org: orgName,
        asn,
        carrier,
        source: 'ipwho.is',
      };
    }
  } catch {
    // Fall through to the second JSON lookup below.
  }

  try {
    const response = await fetchWithTimeout('https://ipapi.co/json/', 5000, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('ipapi');
    const data = await response.json();
    if (data?.error) throw new Error('ipapi');
    if (data?.ip) {
      const asn = clean(data.asn);
      const org = clean(data.org);
      const carrier = identifyCarrier({ isp: org, org, asn });
      return {
        ok: true,
        ip: clean(data.ip),
        city: clean(data.city),
        region: clean(data.region),
        country: clean(data.country_name || data.country),
        isp: org,
        org,
        asn,
        carrier,
        source: 'ipapi.co',
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
        region: '',
        country: clean(fields.loc),
        isp: '',
        org: '',
        asn: '',
        carrier: null,
        source: 'Cloudflare trace',
      };
    }
  } catch {
    // Graceful degradation: the page must render offline.
  }

  return {
    ok: false,
    ip: '',
    city: '',
    region: '',
    country: '',
    isp: '',
    org: '',
    asn: '',
    carrier: null,
    source: '',
  };
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
    availWidth: window.screen?.availWidth || 0,
    availHeight: window.screen?.availHeight || 0,
    innerWidth: window.innerWidth || 0,
    innerHeight: window.innerHeight || 0,
    dpr: Number(window.devicePixelRatio) || 1,
    touchPoints: Number(navigator.maxTouchPoints) || 0,
    colorDepth: Number(window.screen?.colorDepth) || 0,
    pixelDepth: Number(window.screen?.pixelDepth) || 0,
    orientation: clean(window.screen?.orientation?.type),
    displayMode: ['standalone', 'minimal-ui', 'fullscreen', 'browser']
      .find((mode) => readMedia(`(display-mode: ${mode})`)) || '',
  };
  const gpu = readGpu();
  const locale = readLocale(lang);
  const hardware = {
    cores: Number(navigator.hardwareConcurrency) || 0,
    memory: Number(navigator.deviceMemory) || 0,
    connection: readConnection(),
    storage: null,
    battery: null,
    dark: readMedia('(prefers-color-scheme: dark)'),
    contrast: readMedia('(prefers-contrast: more)')
      ? 'more'
      : readMedia('(prefers-contrast: less)') ? 'less' : 'no-preference',
    forcedColors: readMedia('(forced-colors: active)'),
    pointer: readMedia('(pointer: coarse)') ? 'coarse' : readMedia('(pointer: fine)') ? 'fine' : 'none',
    hover: readMedia('(hover: hover)') ? 'hover' : 'none',
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
    arrival: readArrival(),
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
    storagePromise: readStorage(),
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
        architecture: clean(state.signals.highEntropy?.architecture),
        platformVersion: clean(state.signals.highEntropy?.platformVersion),
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
      const [battery, storage] = await Promise.all([
        state.batteryPromise,
        state.storagePromise,
      ]);
      state.signals.hardware.battery = battery;
      state.signals.hardware.storage = storage;
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
    case 'arrival':
      data = state.signals.arrival;
      break;
    case 'attention':
      data = {
        seconds: Math.max(1, Math.round(((globalThis.performance?.now?.() ?? Date.now()) - SESSION_STARTED_AT) / 1000)),
        scrollPercent: Math.min(100, Math.round(
          ((window.scrollY + window.innerHeight) / Math.max(1, document.documentElement.scrollHeight)) * 100
        )),
      };
      break;
    default:
      data = null;
  }

  state.rows[key] = data;
  return data;
}

function present(value) {
  if (value === 0) return true;
  if (value === null || value === undefined || value === false) return false;
  const text = String(value).trim();
  return Boolean(text) && !/^(unknown|unknown os|unknown browser|n\/a|null|undefined|could not be determined)$/i.test(text);
}

function formatStorage(storage) {
  if (!storage || !Number.isFinite(Number(storage.quota)) || storage.quota <= 0) return '';
  const gb = Number(storage.quota) / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = Number(storage.quota) / 1e6;
  return `${Math.round(mb)} MB`;
}

export function formatRow(key, data, copy, lang = 'en') {
  const reveal = copy.reveal;
  const out = {
    key,
    label: reveal.labels[key] || key,
    why: reveal.why[key] || '',
    summary: '',
    lines: [],
    hidden: true,
    signalCount: 0,
    scary: false,
  };

  try {
    if (!data) return out;

    const lines = [];
    const notes = [];
    const summary = [];
    const add = (label, value) => {
      if (!present(value)) return false;
      lines.push({ label, value: String(value) });
      return true;
    };
    const note = (value) => {
      if (present(value)) notes.push({ label: '', value: String(value) });
    };

    if (key === 'device') {
      const type = reveal.deviceType[data.type] || data.type || '';
      const os = [data.uaParser?.osName || data.osName, data.uaParser?.osVersion || data.osVersion]
        .filter(present)
        .join(' ');
      const browser = [data.uaParser?.browserName || data.browserName, data.uaParser?.browserVersion || data.browserVersion]
        .filter(present)
        .join(' ');
      add(reveal.kind, type);
      add(reveal.os, os);
      add(reveal.browser, browser);
      summary.push(type, os, browser);
    } else if (key === 'brand') {
      const brand = clean(data.brand);
      const model = clean(data.model);
      const usableBrand = brand && brand !== 'Unknown' ? brand : '';
      const usableModel = model && !/^could not|^unknown/i.test(model) ? model : '';
      if (!present(usableBrand) && !present(usableModel)) return out;
      add(reveal.model, [usableBrand, usableModel].filter(present).join(' · '));
      if (Number.isFinite(Number(data.confidence)) && data.confidence > 0) {
        add(reveal.confidence, `${data.confidence}%`);
      }
      add(reveal.because, data.evidence?.length ? data.evidence.join(' · ') : '');
      note(reveal.guessNotice);
      summary.push(usableBrand, usableModel);
      out.scary = true;
    } else if (key === 'screen') {
      const resolution = data.width && data.height ? `${data.width} × ${data.height}` : '';
      add(reveal.screenSize, resolution);
      add(reveal.pixelRatio, data.dpr ? `${data.dpr}x` : '');
      add(reveal.touch, Number.isFinite(data.touchPoints) ? String(data.touchPoints) : '');
      summary.push(resolution);
    } else if (key === 'locale') {
      const languages = data.languages?.length ? data.languages.join(', ') : '';
      add(reveal.languages, languages);
      add(reveal.timezone, data.timezone);
      add(reveal.localTime, data.localTime);
      summary.push(languages);
    } else if (key === 'hardware') {
      const connection = typeof data.connection === 'string'
        ? { effectiveType: data.connection }
        : data.connection || {};
      const battery = data.battery;
      const batteryValue = battery && Number.isFinite(Number(battery.level))
        ? `${Math.round(Number(battery.level) * 100)}% ${battery.charging ? reveal.batteryCharging : reveal.batteryNotCharging}`
        : '';
      const memory = Number(data.memory) || 0;
      add(reveal.memory, memory ? `${memory} GB` : '');
      add(reveal.connection, connection.effectiveType);
      add(reveal.downlink, Number.isFinite(Number(connection.downlink)) ? `${connection.downlink} Mbps` : '');
      add(reveal.storage, formatStorage(data.storage));
      add(reveal.battery, batteryValue);
      add(reveal.theme, data.dark ? reveal.dark : reveal.light);
      summary.push(memory ? `${memory} GB` : '', formatStorage(data.storage), batteryValue, connection.effectiveType);
    } else if (key === 'gpu') {
      add(reveal.labels.gpu, data.renderer);
      summary.push(data.renderer);
    } else if (key === 'fingerprint') {
      add(reveal.fingerprintId, data.id ? `SHA-256 · ${data.id}` : '');
      add(reveal.fonts, data.fonts ? `${data.fonts} ${reveal.fontsDetected}` : '');
      note(reveal.privateNoStore);
      summary.push(data.id ? `SHA-256 · ${data.id}` : '');
      out.scary = true;
    } else if (key === 'network') {
      if (data.ok) {
        const carrier = data.carrier;
        if (carrier?.name) {
          const carrierName = lang === 'ar' ? (carrier.nameAr || carrier.name) : carrier.name;
          const type = reveal.carrierTypes?.[carrier.type] || '';
          add(reveal.carrier, [carrierName, type].filter(present).join(' · '));
        } else {
          add(reveal.isp, data.isp);
        }
        add(reveal.ip, data.ip);
        add(reveal.city, data.city);
        add(reveal.country, data.country);
        note(reveal.approximate);
        summary.push(carrier?.name, [data.city, data.country].filter(present).join(' · '), data.ip);
        out.scary = true;
      }
    } else if (key === 'arrival') {
      add(reveal.referrer, data.referrer);
      summary.push(data.host, data.referrer);
      out.scary = true;
    } else if (key === 'attention') {
      if (Number.isFinite(Number(data.seconds))) {
        add(reveal.timeOnPage, `${data.seconds} ${reveal.seconds}`);
      }
      if (Number.isFinite(Number(data.scrollPercent))) {
        add(reveal.scrollDepth, `${data.scrollPercent}%`);
      }
      summary.push(`${data.seconds} ${reveal.seconds}`, `${data.scrollPercent}%`);
      out.scary = true;
    }

    out.lines = [...lines, ...notes];
    out.signalCount = lines.length;
    out.hidden = lines.length === 0;
    out.summary = summary.filter(present).join(' · ') || lines[0]?.value || '';
  } catch {
    // A broken sensor is skipped entirely, never rendered as a broken page.
    out.lines = [];
    out.signalCount = 0;
    out.hidden = true;
    out.summary = '';
  }

  return out;
}

export function formatRows(state, copy, lang = 'en') {
  return REVEAL_ORDER
    .filter((key) => Object.prototype.hasOwnProperty.call(state.rows, key))
    .map((key) => formatRow(key, state.rows[key], copy, lang))
    .filter((row) => !row.hidden);
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function resolveWalletCarrier(network, copy, lang) {
  const detected = network?.carrier;
  if (detected?.wallet) {
    return {
      name: lang === 'ar' ? (detected.walletAr || detected.wallet) : detected.wallet,
      slug: detected.walletSlug,
      known: true,
      networkName: lang === 'ar' ? (detected.nameAr || detected.name) : detected.name,
    };
  }
  return {
    name: copy.scammer.genericCarrier,
    slug: 'wallet',
    known: false,
    networkName: '',
  };
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
    ? (lang === 'en'
      ? (brandName === 'Apple' ? 'an Apple device' : `${needsAn ? 'an' : 'a'} ${brandName}`)
      : brandName)
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
  const carrier = resolveWalletCarrier(signals.network, copy, lang);
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
    carrierNetwork: carrier.networkName,
  };

  const knows = fill(copy.scammer.knows, values);
  const knowsCarrier = carrier.known ? fill(copy.scammer.knowsCarrier, values) : '';

  return {
    knows: [knows, knowsCarrier].filter(Boolean).join(' '),
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

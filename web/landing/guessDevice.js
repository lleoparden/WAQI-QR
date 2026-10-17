// Pure, dependency-free device inference. No browser globals, no network.
// A single exact iPhone model is never claimed: the screen only narrows it to
// a class. Android model codes are matched against a small Egyptian-market
// lookup and always shown as evidence.

const ANDROID_SAMSUNG = {
  'SM-S928': 'Galaxy S24 Ultra',
  'SM-S926': 'Galaxy S24+',
  'SM-S921': 'Galaxy S24',
  'SM-S918': 'Galaxy S23 Ultra',
  'SM-S916': 'Galaxy S23+',
  'SM-S911': 'Galaxy S23',
  'SM-S908': 'Galaxy S22 Ultra',
  'SM-S906': 'Galaxy S22+',
  'SM-S901': 'Galaxy S22',
  'SM-G998': 'Galaxy S21 Ultra',
  'SM-G996': 'Galaxy S21+',
  'SM-G991': 'Galaxy S21',
  'SM-G990': 'Galaxy S21 FE',
  'SM-G780': 'Galaxy S20 FE',
  'SM-A566': 'Galaxy A56',
  'SM-A546': 'Galaxy A54',
  'SM-A536': 'Galaxy A53',
  'SM-A525': 'Galaxy A52',
  'SM-A356': 'Galaxy A35',
  'SM-A256': 'Galaxy A25',
  'SM-A155': 'Galaxy A15',
  'SM-A145': 'Galaxy A14',
  'SM-A065': 'Galaxy A06',
  'SM-A055': 'Galaxy A05',
  'SM-M156': 'Galaxy M15',
  'SM-M135': 'Galaxy M13',
  'SM-M346': 'Galaxy M34',
  'SM-F946': 'Galaxy Z Fold5',
  'SM-F731': 'Galaxy Z Flip5',
};

const HUAWEI = {
  'ELS-NX9': 'P40 Pro',
  'ELS-N29': 'P40 Pro',
  'ANA-NX9': 'P40',
  'VOG-L29': 'P30 Pro',
  'ELE-L29': 'P30',
  'NOH-NX9': 'Mate 40 Pro',
  'LIO-L29': 'Mate 30 Pro',
  'JNY-LX1': 'Nova 7i',
  'STK-LX1': 'Nova 5T',
};

const XIAOMI = {
  '2201117TG': 'Redmi Note 11',
  '2201117TY': 'Redmi Note 11',
  '2201117SY': 'Redmi Note 11',
  '21061119DG': 'Redmi 10',
  '21091116AG': 'Redmi Note 10 Pro',
  'M2101K7AG': 'Redmi Note 10',
  '22071212AG': 'Redmi 12C',
  '23106RN0DA': 'Redmi 13C',
  '2312DRA50G': 'Redmi Note 13',
  '23021RAA2Y': 'Redmi 12',
  '2207117BPG': 'POCO M5',
};

const IPHONE_CLASSES = {
  '320x568@2': 'iPhone SE (1st gen) / 5s class',
  '375x667@2': 'iPhone SE (2nd/3rd gen) / 8 class',
  '375x812@3': 'iPhone X / 11 Pro / 12 mini / 13 mini class',
  '390x844@3': 'iPhone 12 / 13 / 14 class',
  '393x852@3': 'iPhone 14 Pro / 15 / 15 Pro / 16 class',
  '402x874@3': 'iPhone 16 Pro class',
  '414x896@2': 'iPhone XR / 11 class',
  '414x896@3': 'iPhone XS Max / 11 Pro Max class',
  '428x926@3': 'iPhone 12 / 13 Pro Max / 14 Plus class',
  '430x932@3': 'iPhone 14 Pro Max / 15 Plus / 15 Pro Max class',
  '440x956@3': 'iPhone 16 Pro Max class',
};

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function version(value) {
  return clean(value).replace(/_/g, '.');
}

function chromeBrandVersion(brands, fallback) {
  if (!Array.isArray(brands)) return fallback;
  const useful = brands
    .filter((brand) => brand && !/not.?a.?brand|chromium/i.test(clean(brand.brand)))
    .sort((a, b) => clean(b.brand).length - clean(a.brand).length);
  return useful.length ? clean(useful[0].version) || fallback : fallback;
}

export function parseUserAgent(rawUserAgent = '', uaData = null) {
  const ua = clean(rawUserAgent);
  const lower = ua.toLowerCase();
  const platform = clean(uaData?.platform).toLowerCase();

  let type = 'desktop';
  if (/iphone|ipod/.test(lower)) type = 'mobile';
  else if (/ipad/.test(lower)) type = 'tablet';
  else if (/android/.test(lower)) type = /mobile/.test(lower) ? 'mobile' : 'tablet';
  else if (/windows phone/.test(lower)) type = 'mobile';

  let osName = 'Unknown OS';
  let osVersion = '';
  if (/android/.test(lower)) {
    osName = 'Android';
    osVersion = version((ua.match(/Android\s+([\d.]+)/i) || [])[1]);
  } else if (/iphone|ipad|ipod/.test(lower)) {
    osName = 'iOS';
    osVersion = version((ua.match(/(?:CPU (?:iPhone )?OS|OS)\s+([\d_]+)/i) || [])[1]);
  } else if (/windows nt 10\.0/.test(lower)) {
    osName = 'Windows';
    osVersion = '10/11';
  } else if (/windows nt 6\.3/.test(lower)) {
    osName = 'Windows';
    osVersion = '8.1';
  } else if (/windows/.test(lower)) {
    osName = 'Windows';
  } else if (/cros/.test(lower)) {
    osName = 'ChromeOS';
  } else if (/mac os x|macintosh/.test(lower)) {
    osName = 'macOS';
    osVersion = version((ua.match(/Mac OS X\s+([\d_.]+)/i) || [])[1]);
  } else if (/linux/.test(lower)) {
    osName = 'Linux';
  } else if (platform) {
    osName = platform;
  }

  let browserName = 'Unknown browser';
  let browserVersion = '';
  const browserPatterns = [
    [/Edg(?:A|iOS)?\/([\d.]+)/i, 'Edge'],
    [/SamsungBrowser\/([\d.]+)/i, 'Samsung Internet'],
    [/OPR\/([\d.]+)/i, 'Opera'],
    [/Firefox\/([\d.]+)/i, 'Firefox'],
    [/CriOS\/([\d.]+)/i, 'Chrome'],
    [/Chrome\/([\d.]+)/i, 'Chrome'],
    [/Version\/([\d.]+).*Safari/i, 'Safari'],
    [/Safari\/([\d.]+)/i, 'Safari'],
  ];

  for (const [pattern, name] of browserPatterns) {
    const match = ua.match(pattern);
    if (match) {
      browserName = name;
      browserVersion = version(match[1]);
      break;
    }
  }

  if (browserName === 'Unknown browser' && Array.isArray(uaData?.brands)) {
    const brand = uaData.brands.find((item) => item && !/not.?a.?brand/i.test(item.brand || ''));
    if (brand) {
      browserName = clean(brand.brand) || browserName;
      browserVersion = chromeBrandVersion(uaData.brands, '');
    }
  }

  return { type, osName, osVersion, browserName, browserVersion, platform };
}

function normaliseModelCode(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\s+BUILD\/.*$/i, '')
    .replace(/[;,)].*$/, '')
    .trim();
}

function matchCode(code, table) {
  if (!code) return '';
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (code === key || code.startsWith(key)) return table[key];
  }
  return '';
}

function androidBrand(modelCode, modelHint, ua) {
  const code = normaliseModelCode(modelCode);
  const hint = clean(modelHint);
  const all = `${code} ${hint} ${ua}`.toLowerCase();

  if (/sm-[a-z]\d|samsung/.test(all)) return 'Samsung';
  if (/redmi|poco|xiaomi|\bmi\b|m\d{4}[a-z0-9]+|2\d{3}[a-z0-9]{5,}/.test(all) && !/pixel/.test(all)) {
    return 'Xiaomi';
  }
  if (/oppo|cph\d{4}/.test(all)) return 'Oppo';
  if (/realme|rmx\d{4}/.test(all)) return 'Realme';
  if (/infinix|x\d{3,4}[a-z]?/.test(all) && /infinix/.test(all)) return 'Infinix';
  if (/tecno/.test(all)) return 'Tecno';
  if (/huawei|els-|vog-|ana-|noh-|lio-|ele-|jny-|stk-/.test(all)) return 'Huawei';
  if (/honor|any-|bvl-|crt-/.test(all)) return 'Honor';
  if (/vivo|v\d{4}[a-z]?/.test(all)) return 'Vivo';
  if (/oneplus|le\d{4}|ne\d{4}/.test(all)) return 'OnePlus';
  if (/pixel/.test(all)) return 'Google';
  if (/motorola|moto\s/.test(all)) return 'Motorola';
  if (/nokia/.test(all)) return 'Nokia';
  return 'Unknown Android brand';
}

function androidModel(code, hint, brand) {
  const cleanHint = clean(hint);
  if (brand === 'Samsung') {
    const mapped = matchCode(code, ANDROID_SAMSUNG);
    if (mapped) return `Galaxy ${mapped.replace(/^Galaxy\s+/i, '')}`;
  }
  if (brand === 'Huawei') {
    const mapped = matchCode(code, HUAWEI);
    if (mapped) return mapped;
  }
  if (brand === 'Xiaomi') {
    const mapped = matchCode(code, XIAOMI);
    if (mapped) return mapped;
  }
  if (cleanHint && cleanHint.length <= 40) return cleanHint;
  if (code) return `${brand} device (${code})`;
  return `${brand} device (model not exposed)`;
}

function screenKey(width, height, dpr) {
  const w = Math.round(number(width));
  const h = Math.round(number(height));
  if (!w || !h) return '';
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const ratio = Math.round(number(dpr, 1) * 10) / 10;
  return `${short}x${long}@${ratio}`;
}

function evidenceScreen(width, height, dpr) {
  const w = Math.round(number(width));
  const h = Math.round(number(height));
  if (!w || !h) return '';
  const ratio = number(dpr, 0);
  return `screen ${w}x${h}${ratio ? ` @${ratio}x` : ''}`;
}

function shortGpu(renderer) {
  const value = clean(renderer);
  if (!value) return '';
  return `GPU ${value.length > 70 ? `${value.slice(0, 67)}...` : value}`;
}

function result(brand, model, confidence, evidence) {
  return {
    brand,
    model,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    evidence: evidence.filter(Boolean),
  };
}

export function guessDevice(input = {}) {
  try {
    const userAgent = clean(input.userAgent);
    const uaData = input.uaData || null;
    const highEntropy = input.highEntropy || {};
    const parsed = parseUserAgent(userAgent, uaData);
    const width = number(input.screen?.width || input.screenWidth);
    const height = number(input.screen?.height || input.screenHeight);
    const dpr = number(input.devicePixelRatio || input.screen?.dpr, 1);
    const renderer = clean(input.webglRenderer);
    const touchPoints = number(input.touchPoints);
    const highEntropyModel = clean(highEntropy.model);
    const parserModel = clean(input.uaParser?.deviceModel);
    const parserVendor = clean(input.uaParser?.deviceVendor);
    const uaModel = normaliseModelCode(
      (userAgent.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\))/i) || [])[1] || ''
    );
    const modelHint = highEntropyModel || parserModel;
    const modelCode = normaliseModelCode(modelHint || uaModel);
    const screenEvidence = evidenceScreen(width, height, dpr);
    const gpuEvidence = shortGpu(renderer);
    const touchEvidence = touchPoints > 0 ? `${touchPoints} touch points` : '';

    if (parsed.type === 'mobile' && parsed.osName === 'iOS') {
      const key = screenKey(width, height, dpr);
      const model = IPHONE_CLASSES[key] || 'iPhone (model range not exposed)';
      return result('Apple', model, key ? 90 : 82, [
        'UA reports iPhone',
        screenEvidence,
        'iOS' + (parsed.osVersion ? ` ${parsed.osVersion}` : ''),
        gpuEvidence,
      ]);
    }

    if (parsed.type === 'tablet' && parsed.osName === 'iOS') {
      return result('Apple', 'iPad (model range not exposed)', screenEvidence ? 82 : 72, [
        'UA reports iPad',
        screenEvidence,
        'iOS' + (parsed.osVersion ? ` ${parsed.osVersion}` : ''),
      ]);
    }

    if (parsed.osName === 'Android') {
      const brand = androidBrand(modelCode, modelHint, `${parserVendor} ${userAgent}`);
      const model = androidModel(modelCode, modelHint, brand);
      const exact = matchCode(modelCode, ANDROID_SAMSUNG)
        || matchCode(modelCode, HUAWEI)
        || matchCode(modelCode, XIAOMI);
      let confidence = 45;
      if (brand === 'Unknown Android brand') confidence = 35;
      else if (exact) confidence = 92;
      else if (modelCode) confidence = 82;
      else if (brand !== 'Unknown Android brand') confidence = 68;

      return result(brand, model, confidence, [
        modelCode ? `model code ${modelCode}` : '',
        highEntropyModel ? `client-hint model ${highEntropyModel}` : '',
        parserModel && !highEntropyModel ? `ua-parser model ${parserModel}` : '',
        parserVendor ? `ua-parser vendor ${parserVendor}` : '',
        screenEvidence,
        gpuEvidence,
        touchEvidence,
        parsed.browserName !== 'Unknown browser' ? `browser UA ${parsed.browserName}` : '',
      ]);
    }

    if (parsed.osName === 'ChromeOS') {
      return result('Google', 'Chromebook / ChromeOS device', 72, [
        'UA reports ChromeOS',
        screenEvidence,
        gpuEvidence,
      ]);
    }

    if (parsed.osName === 'macOS') {
      return result('Apple', 'Mac desktop or laptop', 62, [
        'UA reports macOS',
        screenEvidence,
        gpuEvidence,
        parsed.browserName !== 'Unknown browser' ? `browser UA ${parsed.browserName}` : '',
      ]);
    }

    if (parsed.osName === 'Windows') {
      return result('Desktop', 'Windows PC or laptop', 58, [
        `UA reports Windows ${parsed.osVersion || ''}`.trim(),
        screenEvidence,
        gpuEvidence,
      ]);
    }

    if (parsed.osName === 'Linux') {
      return result('Desktop', 'Linux desktop or laptop', 52, [
        'UA reports Linux',
        screenEvidence,
        gpuEvidence,
      ]);
    }

    if (modelCode) {
      return result('Unknown', `${androidModel(modelCode, highEntropyModel, 'Unknown Android brand')}`, 30, [
        `model code ${modelCode}`,
        screenEvidence,
      ]);
    }

    return result(
      'Unknown',
      'Could not infer a device',
      0,
      [screenEvidence, gpuEvidence].filter(Boolean)
    );
  } catch {
    return result('Unknown', 'Could not infer a device', 0, ['device inference failed safely']);
  }
}

export const _internal = {
  IPHONE_CLASSES,
  ANDROID_SAMSUNG,
  XIAOMI,
  HUAWEI,
  screenKey,
};

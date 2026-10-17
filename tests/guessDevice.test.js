import test from 'node:test';
import assert from 'node:assert/strict';
import { guessDevice, parseUserAgent } from '../web/landing/guessDevice.js';

const SAMSUNG_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const XIAOMI_UA = 'Mozilla/5.0 (Linux; Android 12; 2201117TG Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FIREFOX_ANDROID_UA = 'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/109.0 Firefox/115.0';
const OPPO_UA = 'Mozilla/5.0 (Linux; Android 13; CPH2477 Build/TP1A.220905.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36';

test('Samsung model code maps to an exact Galaxy model with evidence', () => {
  const result = guessDevice({
    userAgent: SAMSUNG_UA,
    screen: { width: 412, height: 915 },
    devicePixelRatio: 3.5,
    touchPoints: 5,
    webglRenderer: 'Adreno (TM) 740',
  });

  assert.equal(result.brand, 'Samsung');
  assert.match(result.model, /Galaxy S23 Ultra/);
  assert.ok(result.confidence >= 90, `expected high confidence, got ${result.confidence}`);
  assert.ok(result.evidence.some((item) => item.includes('SM-S918B')));
  assert.ok(result.evidence.some((item) => item.includes('412x915')));
});

test('Xiaomi/Redmi model code maps to the Egyptian-market lookup', () => {
  const result = guessDevice({
    userAgent: XIAOMI_UA,
    screen: { width: 393, height: 873 },
    devicePixelRatio: 2.75,
    touchPoints: 5,
    webglRenderer: 'Mali-G52',
  });

  assert.equal(result.brand, 'Xiaomi');
  assert.match(result.model, /Redmi Note 11/);
  assert.ok(result.confidence >= 90);
});

test('iPhone is a certain brand but only a model range', () => {
  const result = guessDevice({
    userAgent: IPHONE_UA,
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
    touchPoints: 5,
    webglRenderer: 'Apple GPU',
  });

  assert.equal(result.brand, 'Apple');
  assert.match(result.model, /^iPhone/);
  assert.match(result.model, /class/);
  assert.doesNotMatch(result.model, /^iPhone (13|14)$/);
  assert.ok(result.confidence >= 85);
});

test('the 402x874 iPhone viewport includes the 17 series, not just the 16 Pro', () => {
  const result = guessDevice({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    screen: { width: 402, height: 874 },
    devicePixelRatio: 3,
    touchPoints: 5,
    webglRenderer: 'Apple GPU',
  });

  assert.equal(result.brand, 'Apple');
  assert.match(result.model, /iPhone 17/);
  assert.match(result.model, /class/);
  assert.doesNotMatch(result.model, /^iPhone 16 Pro$/);
});

test('desktop Chrome is identified as a desktop, not a phone', () => {
  const result = guessDevice({
    userAgent: DESKTOP_CHROME_UA,
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 1,
    touchPoints: 0,
    webglRenderer: 'ANGLE (NVIDIA GeForce RTX 3060)',
  });

  assert.equal(result.brand, 'Desktop');
  assert.match(result.model, /Windows/);
  assert.ok(result.confidence > 0 && result.confidence < 80);
});

test('Firefox Android with no model code degrades honestly', () => {
  const result = guessDevice({
    userAgent: FIREFOX_ANDROID_UA,
    screen: { width: 360, height: 800 },
    devicePixelRatio: 3,
    touchPoints: 5,
  });

  assert.notEqual(result.brand, 'Apple');
  assert.ok(result.confidence < 50);
  assert.match(result.model, /Android|Unknown/);
});

test('Oppo model code is recognised but the model stays broad when unmapped', () => {
  const result = guessDevice({
    userAgent: OPPO_UA,
    screen: { width: 360, height: 800 },
    devicePixelRatio: 3,
    touchPoints: 5,
  });

  assert.equal(result.brand, 'Oppo');
  assert.match(result.model, /Oppo Android phone/);
  assert.match(result.model, /range/);
  assert.ok(result.evidence.some((item) => item.includes('CPH2477')));
});

test('an unmapped Samsung code becomes a range, not a fake exact model', () => {
  const result = guessDevice({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-Z999X Build/UP1A) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
    screen: { width: 360, height: 800 },
    devicePixelRatio: 3,
    touchPoints: 5,
  });

  assert.equal(result.brand, 'Samsung');
  assert.match(result.model, /Samsung Galaxy phone/);
  assert.match(result.model, /range/);
  assert.ok(result.confidence < 80);
  assert.ok(result.evidence.some((item) => item.includes('SM-Z999X')));
});

test('high-entropy client hint model is used when the UA is generic', () => {
  const result = guessDevice({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36',
    highEntropy: { model: 'SM-A145', platformVersion: '14.0.0', architecture: 'arm' },
    screen: { width: 360, height: 800 },
    devicePixelRatio: 3,
    touchPoints: 5,
    webglRenderer: 'Mali-G52',
  });

  assert.equal(result.brand, 'Samsung');
  assert.match(result.model, /Galaxy A14/);
  assert.ok(result.confidence >= 90);
  assert.ok(result.evidence.some((item) => item.includes('client-hint')));
});

test('ua-parser-js model and vendor enrich the pure guess', () => {
  const result = guessDevice({
    userAgent: 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    uaParser: { deviceModel: 'SM-S918B', deviceVendor: 'Samsung' },
    screen: { width: 412, height: 915 },
    devicePixelRatio: 3.5,
    touchPoints: 5,
    webglRenderer: 'Adreno (TM) 740',
  });

  assert.equal(result.brand, 'Samsung');
  assert.match(result.model, /Galaxy S23 Ultra/);
  assert.ok(result.evidence.some((item) => item.includes('ua-parser vendor')));
});

test('missing or malformed input never throws', () => {
  const empty = guessDevice();
  assert.equal(empty.brand, 'Unknown');
  assert.equal(empty.confidence, 0);
  assert.ok(Array.isArray(empty.evidence));

  const weird = guessDevice({
    userAgent: 42,
    screen: null,
    highEntropy: 'not an object',
    devicePixelRatio: 'nope',
    touchPoints: null,
  });
  assert.equal(typeof weird.model, 'string');
  assert.equal(typeof weird.confidence, 'number');
});

test('parseUserAgent extracts OS and browser versions', () => {
  const parsed = parseUserAgent(SAMSUNG_UA);
  assert.equal(parsed.type, 'mobile');
  assert.equal(parsed.osName, 'Android');
  assert.equal(parsed.osVersion, '13');
  assert.equal(parsed.browserName, 'Chrome');
  assert.equal(parsed.browserVersion, '120.0.0.0');
});

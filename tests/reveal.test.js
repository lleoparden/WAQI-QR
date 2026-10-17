import test from 'node:test';
import assert from 'node:assert/strict';
import { content } from '../web/landing/content.js';
import { buildScams, formatRow } from '../web/landing/reveal.js';

test('formatRow renders values and a why-line', () => {
  const row = formatRow('brand', {
    brand: 'Samsung',
    model: 'Galaxy S23 Ultra',
    confidence: 92,
    evidence: ['model code SM-S918B', 'screen 412x915 @3.5x'],
  }, content.en, 'en');

  assert.equal(row.label, 'Brand / model guess');
  assert.match(row.summary, /Samsung/);
  assert.match(row.summary, /Galaxy S23 Ultra/);
  assert.ok(row.lines.some((line) => line.value === '92%'));
  assert.ok(row.why.length > 0);
  assert.equal(row.scary, true);
});

test('formatRow hides a row when the browser exposes nothing', () => {
  const row = formatRow('network', null, content.en, 'en');
  assert.equal(row.hidden, true);
  assert.equal(row.signalCount, 0);
  assert.equal(row.summary, '');
});

test('missing sub-values are omitted instead of rendered as placeholders', () => {
  const row = formatRow('hardware', {
    cores: 8,
    memory: 8,
    connection: null,
    storage: null,
    battery: null,
    dark: true,
    contrast: 'no-preference',
    forcedColors: false,
    pointer: 'fine',
    hover: 'hover',
    reducedMotion: false,
  }, content.en, 'en');

  assert.equal(row.hidden, false);
  assert.ok(row.lines.some((line) => line.label === 'Device memory'));
  assert.equal(row.lines.some((line) => line.label === 'Battery'), false);
  assert.equal(row.lines.some((line) => line.value === 'not exposed by your browser'), false);
});

test('attention row shows time on page and scroll depth', () => {
  const row = formatRow('attention', { seconds: 12, scrollPercent: 34 }, content.en, 'en');
  assert.equal(row.hidden, false);
  assert.ok(row.lines.some((line) => line.label === 'Time on page' && line.value === '12 seconds'));
  assert.ok(row.lines.some((line) => line.label === 'Page scrolled' && line.value === '34%'));
  assert.equal(row.scary, true);
});

test('scam cards fill the visitor data and use reserved domains', () => {
  const state = {
    signals: {
      brand: { brand: 'Samsung', model: 'Galaxy S23 Ultra' },
      network: { city: 'Cairo', country: 'Egypt', isp: 'Vodafone Egypt' },
      hardware: { battery: { level: 0.34 } },
      parsed: { browserName: 'Chrome', browserVersion: '120' },
    },
  };
  const scams = buildScams(state, content.en, 'en');

  assert.match(scams.knows, /Samsung/);
  assert.match(scams.knows, /Cairo/);
  assert.match(scams.knows, /34%/);
  assert.match(scams.realScammer, /Cairo/);
  assert.equal(scams.cards.length, 3);
  assert.equal(scams.cards[0].from, 'Vodafone Cash');
  assert.match(scams.cards[0].url, /vodafone-cash-secure\.example/);
  for (const card of scams.cards) {
    assert.doesNotMatch(card.body, /\{[a-zA-Z]+\}/);
    assert.match(card.url, /\.example/);
  }
});

test('desktop visitors are not described as holding a Desktop', () => {
  const state = {
    signals: {
      brand: { brand: 'Desktop', model: 'Windows PC or laptop' },
      network: { city: '', country: '', isp: '' },
      hardware: { battery: null },
      parsed: { browserName: 'Chrome', browserVersion: '120' },
    },
  };
  const scams = buildScams(state, content.en, 'en');
  assert.doesNotMatch(scams.knows, /holding a Desktop/);
  assert.match(scams.knows, /holding a device/);
  assert.match(scams.realScammer, /Windows PC or laptop/);
});

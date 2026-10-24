import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_IDS, PALETTES, paletteCss, toHex, toRgba } from '../web/admin/palettes.js';

test('the four seminar palettes are present with their names', () => {
  assert.deepEqual(PALETTE_IDS, ['A', 'B', 'C', 'D']);
  assert.equal(PALETTES.A.name, 'Paynes & Pearl');
  assert.equal(PALETTES.B.name, 'Sand & Indigo');
  assert.equal(PALETTES.C.name, 'Navy & Orange');
  assert.equal(PALETTES.D.name, 'Plum & Tangerine');
});

test('palette CSS maps light/dark/accent values into the dashboard tokens', () => {
  const css = paletteCss(PALETTES.A);
  assert.equal(css['--bg'], '#EAE0C8');
  assert.equal(css['--panel'], '#FBF8F0');
  assert.equal(css['--ink'], '#1E2A33');
  assert.equal(css['--orange'], '#C98A2B');
  assert.equal(css['--green'], '#6B7F8C');
  assert.equal(css['--red'], '#A8452F');
  assert.match(css['--line'], /^rgba\(30,42,51,0\.14\)$/);
});

test('all palettes produce complete token sets', () => {
  for (const id of PALETTE_IDS) {
    const css = paletteCss(PALETTES[id]);
    for (const token of ['--bg', '--panel', '--ink', '--muted', '--orange', '--line', '--green', '--red']) {
      assert.ok(css[token], `${id} is missing ${token}`);
    }
  }
});

test('hex helpers reject malformed values and build valid rgba', () => {
  assert.equal(toHex('1e2a33'), '#1E2A33');
  assert.equal(toHex('#xyz'), '');
  assert.equal(toRgba('C98A2B', 0.5), 'rgba(201,138,43,0.5)');
});

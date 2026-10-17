import test from 'node:test';
import assert from 'node:assert/strict';
import { content, LANGUAGE_ORDER } from '../web/landing/content.js';

function shape(value) {
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, items: value.map(shape) };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
  }
  return typeof value;
}

test('Arabic and English copy have identical structure', () => {
  assert.deepEqual(LANGUAGE_ORDER, ['ar', 'en']);
  assert.deepEqual(shape(content.ar), shape(content.en));
});

test('languages set direction and document language', () => {
  assert.equal(content.ar.dir, 'rtl');
  assert.equal(content.ar.htmlLang, 'ar');
  assert.equal(content.en.dir, 'ltr');
  assert.equal(content.en.htmlLang, 'en');
});

test('the reveal has the required row labels and why-lines', () => {
  const keys = ['device', 'brand', 'screen', 'locale', 'hardware', 'gpu', 'fingerprint', 'network', 'arrival', 'attention'];
  for (const language of LANGUAGE_ORDER) {
    const reveal = content[language].reveal;
    for (const key of keys) {
      assert.ok(reveal.labels[key], `${language} label ${key}`);
      assert.ok(reveal.why[key], `${language} why ${key}`);
    }
    assert.ok(reveal.notExposed);
    assert.ok(reveal.optIn.button);
  }
});

test('scam simulations use only reserved .example placeholder domains', () => {
  for (const language of LANGUAGE_ORDER) {
    const scammer = content[language].scammer;
    assert.equal(scammer.cards.length, 3);
    for (const card of scammer.cards) {
      assert.match(card.url, /\.example(\/|$)/, `${language}/${card.id}`);
      assert.doesNotMatch(card.url, /bit\.ly|tinyurl|t\.co/i);
    }
    assert.match(scammer.knows, /\{brand\}/);
    assert.match(scammer.knows, /\{city\}/);
    assert.match(scammer.knows, /\{battery\}/);
    assert.match(scammer.realScammer, /\{device\}/);
    assert.match(scammer.realScammer, /\{time\}/);
    assert.ok(scammer.badge.toLowerCase().includes('simulation') || scammer.badge.includes('محاكاة'));
  }
});

test('every URL in the copy uses a reserved .example domain', () => {
  for (const language of LANGUAGE_ORDER) {
    const urls = JSON.stringify(content[language]).match(/https?:\/\/[^"'\s]+/g) || [];
    assert.ok(urls.length > 0);
    for (const url of urls) {
      assert.match(url, /\.example(\/|$)/, `${language}: ${url}`);
    }
  }
});

test('the InstaPay round uses an explicit local placeholder image', () => {
  for (const language of LANGUAGE_ORDER) {
    const round = content[language].quiz.rounds.find((item) => item.id === 'receipt');
    assert.equal(round.artifact.image, './assets/instapay-placeholder.svg');
    assert.ok(round.artifact.imageAlt);
    assert.match(round.artifact.caption, /placeholder|مؤقتة/i);
    assert.equal(round.artifact.image.startsWith('./'), true);
  }
});

test('the quiz has four complete rounds with a tell and valid answer', () => {
  for (const language of LANGUAGE_ORDER) {
    const quiz = content[language].quiz;
    assert.equal(quiz.rounds.length, 4);
    const ids = new Set();
    for (const round of quiz.rounds) {
      assert.ok(round.id);
      assert.equal(ids.has(round.id), false, `duplicate round ${round.id}`);
      ids.add(round.id);
      assert.ok(round.prompt);
      assert.ok(round.tell);
      assert.ok(round.artifact || round.options);
      if (round.type === 'binary') {
        assert.ok(['real', 'fake'].includes(round.answer));
      } else if (round.type === 'choose') {
        assert.ok(round.options.some((option) => option.id === round.answer));
      } else {
        assert.fail(`unknown quiz round type ${round.type}`);
      }
    }
  }
});

test('the minimum content blocks exist in both languages', () => {
  for (const language of LANGUAGE_ORDER) {
    const copy = content[language];
    assert.equal(copy.scanner.lines.length, 4);
    assert.equal(copy.goodNews.items.length, 5);
    assert.equal(copy.transparency.points.length, 5);
    assert.ok(copy.share.card.headline);
    assert.ok(copy.share.card.sub);
    assert.ok(copy.waqi.ctaUrl.startsWith('https://'));
    assert.ok(copy.waqi.features.length >= 3);
    assert.ok(copy.reveal.optIn.accuracy.includes('{meters}'));
  }
});

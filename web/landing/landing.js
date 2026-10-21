import { content } from './content.js';
import {
  REVEAL_ORDER,
  buildScams,
  createRevealState,
  formatRow,
  formatRows,
  resolveRevealRow,
} from './reveal.js';
import { initFunnel, track } from './funnel.js';
import { recordScan } from '../js/api.js';
import {
  downloadCard,
  drawShareCard,
  shareCard,
} from './share.js';

const $ = (selector, root = document) => root.querySelector(selector);
const params = new URLSearchParams(location.search);

const state = {
  lang: 'ar',
  copy: content.ar,
  slug: '',
  visitorId: '',
  revealState: null,
  scanToken: 0,
  scanStarted: false,
  scanFinished: false,
  revealStarted: false,
  postReveal: false,
  scamData: null,
  geo: null,
  quiz: null,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function readPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function initialLang() {
  const query = (params.get('lang') || '').toLowerCase();
  if (query === 'ar' || query === 'en') return query;
  try {
    const stored = localStorage.getItem('waqi_lang');
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    // Storage can be disabled; fall through to the browser language.
  }
  const browser = String(navigator.language || 'ar').toLowerCase();
  return browser.startsWith('ar') ? 'ar' : 'en';
}

function readSlug() {
  const value = (params.get('src') || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(value) ? value : '';
}

function getVisitorId() {
  const fallback = () => {
    const random = Math.random().toString(36).slice(2, 12);
    return `v-${Date.now().toString(36)}-${random}`;
  };
  try {
    const stored = localStorage.getItem('waqi_visitor_id');
    if (stored && /^[A-Za-z0-9_-]{8,128}$/.test(stored)) return stored;
    const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : fallback();
    localStorage.setItem('waqi_visitor_id', id);
    return id;
  } catch {
    return fallback();
  }
}

function setLanguage(next, { emit = true } = {}) {
  if (!content[next] || next === state.lang) return;
  state.lang = next;
  state.copy = content[next];
  try {
    localStorage.setItem('waqi_lang', next);
  } catch {
    // Fine; the toggle still works for this page.
  }

  applyStatic();

  if (!state.scanFinished) {
    if (state.scanStarted) startScanning();
  } else if (state.revealStarted) {
    renderRevealRows();
    if (state.postReveal) {
      state.scamData = buildScams(state.revealState, state.copy, state.lang);
      renderScams();
      renderGoodNews();
      renderWaqi();
      renderQuiz();
      void renderSharePreview();
    }
  }

  if (state.geo) renderGeo();
  if (emit) track('lang_toggled');
}

function applyStatic() {
  const copy = state.copy;
  document.documentElement.lang = copy.htmlLang;
  document.documentElement.dir = copy.dir;
  document.title = copy.meta.title;

  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', copy.meta.description);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', copy.meta.title);
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription) ogDescription.setAttribute('content', copy.meta.description);

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const value = readPath(copy, node.dataset.i18n);
    if (typeof value === 'string') node.textContent = value;
  });

  $('#brand-name').textContent = copy.brand.name;
  $('#brand-tagline').textContent = copy.brand.tagline;
  $('#lang-toggle').textContent = copy.switchLabel;
  $('#lang-toggle').setAttribute('aria-label', copy.switchLabel);
  $('#scanner-path').textContent = copy.ui.terminalPath;
  $('#scanner-tag').textContent = copy.ui.terminalLocal;
  $('#reveal-path').textContent = copy.ui.terminalProfile;
  $('#reveal-tag').textContent = copy.ui.terminalNoServer;
  $('#profile-stamp').textContent = copy.ui.terminalLocal;
  $('#qr-caption').textContent = copy.ui.qrCaption;
  document.querySelector('.header-nav')?.setAttribute('aria-label', copy.nav.menuLabel);
  document.querySelector('.privacy-tape')?.setAttribute('aria-label', copy.nav.privacy);
  $('#reveal-rows').setAttribute('aria-label', copy.reveal.rowsLabel);
  $('#share-canvas').setAttribute('aria-label', copy.share.title);
  $('#scammer-next').textContent = copy.scammer.next;
  $('#good-next').textContent = copy.goodNews.next;
  $('#share-button').textContent = copy.share.button;
  $('#share-download').textContent = copy.share.download;
  $('#waqi-cta').href = copy.waqi.ctaUrl || '#waqi';
  $('#transparency-live').textContent = copy.transparency.live;
  $('#geo-note').textContent = copy.reveal.optIn.note;
  $('#geo-map').title = copy.reveal.optIn.mapTitle;

  const list = $('#transparency-list');
  list.replaceChildren(...copy.transparency.points.map((point) => el('li', '', point)));
}

function armScanner() {
  if (state.scanStarted) return;
  if (!('IntersectionObserver' in window)) {
    state.scanStarted = true;
    startScanning();
    return;
  }
  state.scannerObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      state.scannerObserver?.disconnect();
      state.scanStarted = true;
      startScanning();
    }
  }, { threshold: 0.35 });
  state.scannerObserver.observe($('#scanner-section'));
}

function startScanning() {
  state.scanStarted = true;
  state.scannerObserver?.disconnect();
  state.scanToken += 1;
  const token = state.scanToken;
  state.scanFinished = false;
  state.revealStarted = false;

  const lines = $('#scanner-lines');
  const bar = $('#scanner-bar');
  const skip = $('#skip-animation');
  const scanner = $('#scanner-section');
  const reveal = $('#reveal-section');
  scanner.hidden = false;
  reveal.hidden = true;
  lines.replaceChildren();
  bar.style.width = '4%';
  skip.hidden = false;
  skip.disabled = false;

  const copy = state.copy;

  const addLine = (text, done = true) => {
    const line = el('div', `scan-line${done ? ' is-done' : ''}`, text);
    lines.append(line);
  };

  if (state.reducedMotion) {
    copy.scanner.lines.forEach((line) => addLine(line));
    bar.style.width = '100%';
    setTimeout(() => {
      if (token === state.scanToken) finishScanning();
    }, 220);
    return;
  }

  (async () => {
    for (let index = 0; index < copy.scanner.lines.length; index += 1) {
      if (token !== state.scanToken) return;
      addLine(copy.scanner.lines[index]);
      bar.style.width = `${Math.round(((index + 1) / copy.scanner.lines.length) * 82)}%`;
      await sleep(330);
    }
    if (token !== state.scanToken) return;
    bar.style.width = '100%';
    await sleep(420);
    if (token === state.scanToken) finishScanning();
  })();
}

function skipScanning() {
  if (state.scanFinished) return;
  state.scanToken += 1;
  track('skipped_animation');
  finishScanning();
}

function finishScanning() {
  if (state.scanFinished) return;
  state.scanFinished = true;
  state.scannerObserver?.disconnect();
  const skip = $('#skip-animation');
  skip.hidden = true;
  $('#scanner-section').hidden = true;
  $('#reveal-section').hidden = false;
  $('#reveal-loading').hidden = false;
  $('#reveal-foot').hidden = true;
  void startReveal();
}

async function startReveal() {
  if (state.revealStarted) return;
  state.revealStarted = true;
  track('reveal_started');

  const revealSection = $('#reveal-section');
  revealSection.hidden = false;
  revealSection.scrollIntoView({
    behavior: state.reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  });

  try {
    state.revealState = await createRevealState(state.lang);
  } catch {
    $('#reveal-loading').textContent = state.copy.common.unknown;
    return;
  }

  const rows = $('#reveal-rows');
  rows.replaceChildren();
  let index = 0;

  for (const key of REVEAL_ORDER) {
    let data = null;
    try {
      data = await resolveRevealRow(state.revealState, key);
    } catch {
      data = null;
    }
    const row = formatRow(key, data, state.copy, state.lang);
    if (row.hidden) continue;
    index += 1;
    await appendRow(row, index);
    await sleep(state.reducedMotion ? 0 : 360);
  }

  $('#reveal-loading').hidden = true;
  $('#reveal-foot').hidden = false;
  renderProfileSummary();
  showPostReveal();
  observeRevealEnd();
}

function createRowShell(row, index) {
  const article = el('article', `reveal-row${row.scary ? ' is-scary' : ''}`);
  article.setAttribute('role', 'listitem');
  const number = el('span', 'row-index', String(index).padStart(2, '0'));
  const body = el('div', 'row-body');
  const label = el('p', 'row-label', row.label);
  const value = el('p', 'row-value', row.summary);
  body.append(label, value);
  article.append(number, body);
  return { article, body, value };
}

function addRowDetails(body, row) {
  if (row.lines?.length) {
    const lines = el('div', 'row-lines');
    row.lines.forEach((line) => {
      const item = el('div', `row-line${line.label ? '' : ' is-note'}`);
      item.append(el('span', '', line.label || ''), el('span', '', line.value));
      lines.append(item);
    });
    body.append(lines);
  }
  if (row.why) {
    body.append(el('p', 'row-why', row.why));
  }
}

async function typeText(node, text) {
  const value = String(text || '');
  if (!value || state.reducedMotion) {
    node.textContent = value;
    return;
  }
  const typingLang = state.lang;
  const step = Math.max(5, Math.min(18, 850 / Math.max(value.length, 1)));
  for (let i = 1; i <= value.length; i += 1) {
    if (state.lang !== typingLang) break;
    node.textContent = value.slice(0, i);
    if (i % 2 === 0) await sleep(step);
  }
  node.textContent = value;
}

async function appendRow(row, index) {
  const { article, body, value } = createRowShell(row, index);
  value.textContent = '';
  $('#reveal-rows').append(article);
  await typeText(value, row.summary);
  addRowDetails(body, row);
  article.classList.add('is-settled');
}

function renderRevealRows() {
  if (!state.revealState) return;
  const container = $('#reveal-rows');
  container.replaceChildren();
  const rows = formatRows(state.revealState, state.copy, state.lang);
  rows.forEach((row, index) => {
    const { article, body, value } = createRowShell(row, index + 1);
    value.textContent = row.summary;
    addRowDetails(body, row);
    article.classList.add('is-settled');
    container.append(article);
  });
  renderProfileSummary();
}

function renderProfileSummary() {
  if (!state.revealState) return;
  const rows = formatRows(state.revealState, state.copy, state.lang);
  const count = rows.reduce((total, row) => total + Number(row.signalCount || 0), 0);
  const summary = $('#profile-summary');
  summary.hidden = count === 0;
  $('#profile-signal-count').textContent = String(count);

  const signals = state.revealState.signals;
  const chips = [];
  const addChip = (value) => {
    const text = String(value || '').trim();
    if (text && !chips.includes(text)) chips.push(text);
  };

  const brand = signals.brand?.brand;
  const model = signals.brand?.model;
  if (brand && brand !== 'Unknown' && brand !== 'Desktop') {
    addChip(model ? `${brand} ${model}` : brand);
  } else if (model) {
    addChip(model);
  }
  if (signals.network?.city) addChip(signals.network.city);
  if (signals.network?.carrier?.shortName) {
    addChip(state.lang === 'ar'
      ? (signals.network.carrier.shortNameAr || signals.network.carrier.shortName)
      : signals.network.carrier.shortName);
  } else if (signals.network?.isp) addChip(signals.network.isp);
  if (Number.isFinite(signals.hardware?.battery?.level)) {
    addChip(`${Math.round(signals.hardware.battery.level * 100)}% ${state.copy.reveal.battery}`);
  }
  const browser = signals.uaParser?.browserName || signals.parsed?.browserName;
  const browserVersion = signals.uaParser?.browserVersion || signals.parsed?.browserVersion;
  if (browser && browser !== 'Unknown browser') {
    addChip(`${browser}${browserVersion ? ` ${browserVersion}` : ''}`);
  }
  if (signals.fingerprint?.fonts) {
    addChip(`${signals.fingerprint.fonts} ${state.copy.reveal.fontsChip}`);
  }
  if (signals.fingerprint?.id) addChip(`#${signals.fingerprint.id.slice(0, 6)}`);

  const container = $('#profile-chips');
  container.replaceChildren(...chips.slice(0, 7).map((chip) => el('span', 'profile-chip', chip)));
}

function showPostReveal() {
  if (state.postReveal) return;
  state.postReveal = true;
  state.scamData = buildScams(state.revealState, state.copy, state.lang);

  renderScams();
  renderGoodNews();
  renderWaqi();
  renderQuiz();
  void renderSharePreview();

  $('#scammer-section').hidden = false;
  $('#quiz-section').hidden = false;
  $('#good-news').hidden = false;
  $('#waqi').hidden = false;
  $('#share').hidden = false;
  observeTips();
}

function renderScams() {
  if (!state.scamData) return;
  const copy = state.copy;
  const container = $('#scam-cards');
  container.replaceChildren();

  for (const card of state.scamData.cards) {
    const article = el('article', 'sim-card');
    article.append(el('span', 'sim-badge', copy.scammer.badge));
    const meta = el('div', 'sim-meta');
    meta.append(el('span', 'sim-from', card.from), el('span', '', copy.scammer.channelSms));
    article.append(meta, el('h3', 'sim-title', card.title), el('p', 'sim-body', card.body));
    const link = el('div', 'fake-link');
    link.append(el('strong', '', card.cta), el('span', '', card.url));
    article.append(link);
    container.append(article);
  }

  $('#scammer-knows').textContent = state.scamData.knows;
  $('#scammer-real').textContent = state.scamData.realScammer;
  $('#scammer-honesty').textContent = copy.scammer.honesty;
  $('#scammer-footer').textContent = copy.scammer.footer;
  $('#scammer-next').textContent = copy.scammer.next;
}

function renderGoodNews() {
  const copy = state.copy;
  const grid = $('#tips-grid');
  grid.replaceChildren();
  copy.goodNews.items.forEach((item, index) => {
    const article = el('article', 'tip');
    article.append(
      el('span', 'tip-number', String(index + 1).padStart(2, '0')),
      el('h3', '', item.title),
      el('p', '', item.body)
    );
    grid.append(article);
  });
  $('#good-closing').textContent = copy.goodNews.closing;
  $('#good-next').textContent = copy.goodNews.next;
}

function renderWaqi() {
  const copy = state.copy;
  const grid = $('#waqi-features');
  grid.replaceChildren();
  copy.waqi.features.forEach((feature) => {
    const item = el('div', 'waqi-feature');
    item.append(el('strong', '', feature.title), el('span', '', feature.body));
    grid.append(item);
  });
  $('#waqi-cta').href = copy.waqi.ctaUrl || '#waqi';
  $('#waqi-cta').textContent = copy.waqi.cta;
}

function ensureQuiz() {
  if (!state.quiz) {
    state.quiz = {
      index: 0,
      score: 0,
      answered: false,
      selected: null,
      finished: false,
    };
  }
}

function buildArtifact(artifact, copy) {
  const root = el('span', `artifact artifact-${artifact.kind}`);
  const head = el('span', 'artifact-head');
  head.append(el('span', 'artifact-title', artifact.title || ''));
  if (artifact.sample) head.append(el('span', 'sample-stamp', artifact.sample));
  root.append(head);

  if (artifact.image) {
    const frame = el('span', 'artifact-image-wrap');
    const image = document.createElement('img');
    image.className = 'artifact-image';
    image.src = artifact.image;
    image.alt = artifact.imageAlt || artifact.title || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    frame.append(image);
    if (artifact.caption) {
      frame.append(el('span', 'artifact-image-caption', artifact.caption));
    }
    root.append(frame);
  }

  if (artifact.kind === 'sms') {
    const bubble = el('span', 'sms-bubble');
    bubble.append(
      el('span', 'sms-sender', artifact.sender || ''),
      el('span', '', artifact.body || '')
    );
    if (artifact.link) bubble.append(el('span', 'sms-link', artifact.link));
    root.append(bubble);
  } else {
    for (const [label, value] of artifact.rows || []) {
      const row = el('span', 'artifact-row');
      row.append(el('span', '', label), el('strong', '', value));
      root.append(row);
    }
  }

  return root;
}

function renderQuiz() {
  ensureQuiz();
  const copy = state.copy;
  const container = $('#quiz-card');
  const quiz = state.quiz;
  const total = copy.quiz.rounds.length;
  container.replaceChildren();

  if (quiz.finished) {
    const score = el('div', 'quiz-score');
    score.append(
      el('p', 'eyebrow', copy.quiz.eyebrow),
      el('div', 'quiz-score-value', `${quiz.score} / ${total}`),
      el('p', 'section-intro', copy.quiz.score.replace('{score}', quiz.score).replace('{total}', total))
    );
    const ratio = total ? quiz.score / total : 0;
    const message = ratio >= 0.75 ? copy.quiz.high : ratio >= 0.5 ? copy.quiz.mid : copy.quiz.low;
    score.append(el('p', '', message));

    const cta = el('a', 'button button-orange', copy.quiz.cta);
    cta.href = copy.waqi.ctaUrl || '#waqi';
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    cta.addEventListener('click', () => track('waqi_cta_clicked'));
    const actions = el('div', 'quiz-actions');
    actions.append(cta);
    score.append(actions);
    container.append(score);
    return;
  }

  const round = copy.quiz.rounds[quiz.index];
  const head = el('div', 'quiz-head');
  head.append(
    el('span', '', copy.quiz.round.replace('{current}', quiz.index + 1).replace('{total}', total)),
    el('span', '', `${Math.round(((quiz.index + 1) / total) * 100)}%`)
  );
  container.append(head);

  const track = el('div', 'quiz-track');
  const fill = el('span');
  fill.style.width = `${((quiz.index + 1) / total) * 100}%`;
  track.append(fill);
  container.append(track, el('h3', 'quiz-prompt', round.prompt));

  if (round.artifact) container.append(buildArtifact(round.artifact, copy));

  const choices = el('div', 'choices');
  const options = round.type === 'binary'
    ? [
        { id: 'real', label: copy.quiz.real },
        { id: 'fake', label: copy.quiz.fake },
      ]
    : round.options.map((option) => ({
        id: option.id,
        label: option.text,
        artifact: option.artifact,
      }));

  options.forEach((option) => {
    const button = el('button', 'choice');
    button.type = 'button';
    button.disabled = quiz.answered;
    button.append(el('span', 'choice-label', option.label));
    if (option.artifact) button.append(buildArtifact(option.artifact, copy));

    if (quiz.answered) {
      if (option.id === round.answer) button.classList.add('is-correct');
      if (option.id === quiz.selected && option.id !== round.answer) button.classList.add('is-wrong');
    }

    button.addEventListener('click', () => answerQuiz(option.id));
    choices.append(button);
  });
  container.append(choices);

  if (quiz.answered) {
    const correct = quiz.selected === round.answer;
    const feedback = el('div', 'quiz-feedback');
    feedback.append(
      el('p', `quiz-verdict ${correct ? 'is-correct' : 'is-wrong'}`, correct ? copy.quiz.correct : copy.quiz.wrong),
      el('p', 'quiz-tell', `${copy.quiz.tell}: ${round.tell}`)
    );
    const actions = el('div', 'quiz-actions');
    const next = el('button', 'button', quiz.index === total - 1 ? copy.quiz.finish : copy.quiz.next);
    next.type = 'button';
    next.addEventListener('click', nextQuiz);
    actions.append(next);
    feedback.append(actions);
    container.append(feedback);
  }
}

function answerQuiz(id) {
  ensureQuiz();
  const quiz = state.quiz;
  if (quiz.answered || quiz.finished) return;
  const round = state.copy.quiz.rounds[quiz.index];
  quiz.answered = true;
  quiz.selected = id;
  if (id === round.answer) quiz.score += 1;
  renderQuiz();
}

function nextQuiz() {
  ensureQuiz();
  const quiz = state.quiz;
  const total = state.copy.quiz.rounds.length;
  if (quiz.index < total - 1) {
    quiz.index += 1;
    quiz.answered = false;
    quiz.selected = null;
    renderQuiz();
    $('#quiz-card').scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    return;
  }
  quiz.finished = true;
  track('quiz_completed');
  renderQuiz();
}

function shareOptions() {
  const checkbox = $('#share-data');
  const lines = [];
  if (checkbox?.checked && state.revealState) {
    const signals = state.revealState.signals;
    if (signals.brand?.brand && signals.brand.brand !== 'Unknown') {
      lines.push(`${signals.brand.brand} ${signals.brand.model || ''}`.trim());
    }
    if (signals.network?.city) {
      lines.push([signals.network.city, signals.network.country].filter(Boolean).join(', '));
    }
  }
  return {
    copy: state.copy.share,
    lang: state.lang,
    slug: state.slug,
    dataLines: lines,
  };
}

function renderSharePreview() {
  try {
    return drawShareCard($('#share-canvas'), shareOptions()).catch(() => {
      const status = $('#share-status');
      if (status) status.textContent = state.copy.share.error;
    });
  } catch {
    const status = $('#share-status');
    if (status) status.textContent = state.copy.share.error;
    return Promise.resolve();
  }
}

async function onShare() {
  const button = $('#share-button');
  const status = $('#share-status');
  track('share_clicked');
  button.disabled = true;
  status.textContent = state.copy.share.generating;
  try {
    const method = await shareCard($('#share-canvas'), shareOptions());
    status.textContent = method === 'downloaded' ? state.copy.share.unsupported : '';
  } catch {
    status.textContent = state.copy.share.error;
  } finally {
    button.disabled = false;
  }
}

async function onDownload() {
  const status = $('#share-status');
  track('share_clicked');
  try {
    await downloadCard($('#share-canvas'), shareOptions());
    status.textContent = '';
  } catch {
    status.textContent = state.copy.share.error;
  }
}

function mapUrl(lat, lon, accuracy) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  const radius = Math.max(0.003, (Number(accuracy) || 50) / 111000 * 3);
  const lonRadius = radius / Math.max(0.2, Math.cos(latitude * Math.PI / 180));
  const left = (longitude - lonRadius).toFixed(5);
  const right = (longitude + lonRadius).toFixed(5);
  const top = (latitude + radius).toFixed(5);
  const bottom = (latitude - radius).toFixed(5);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left},${bottom},${right},${top}&layer=mapnik&marker=${latitude},${longitude}`;
}

function renderGeo() {
  if (!state.geo) return;
  const result = $('#geo-result');
  result.hidden = false;
  $('#geo-coords').textContent = `${state.geo.lat.toFixed(5)}, ${state.geo.lon.toFixed(5)}`;
  $('#geo-accuracy').textContent = state.copy.reveal.optIn.accuracy.replace(
    '{meters}',
    Math.round(state.geo.accuracy || 0)
  );
  const mapWrap = $('#geo-map-wrap');
  const map = $('#geo-map');
  mapWrap.hidden = false;
  map.title = state.copy.reveal.optIn.mapTitle;
  map.src = mapUrl(state.geo.lat, state.geo.lon, state.geo.accuracy);
  $('#geo-status').textContent = '';
  $('#geo-button').disabled = false;
}

function requestLocation() {
  const status = $('#geo-status');
  const button = $('#geo-button');
  if (!navigator.geolocation) {
    status.textContent = state.copy.reveal.optIn.unavailable;
    return;
  }
  status.textContent = state.copy.reveal.optIn.locating;
  button.disabled = true;
  try {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.geo = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        renderGeo();
      },
      (error) => {
        button.disabled = false;
        status.textContent = error?.code === 1
          ? state.copy.reveal.optIn.denied
          : state.copy.reveal.optIn.unavailable;
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  } catch {
    button.disabled = false;
    status.textContent = state.copy.reveal.optIn.unavailable;
  }
}

function observeOnce(element, threshold, callback) {
  if (!element) return;
  if (!('IntersectionObserver' in window)) {
    callback();
    return;
  }
  let done = false;
  const observer = new IntersectionObserver((entries) => {
    if (done) return;
    if (entries.some((entry) => entry.isIntersecting)) {
      done = true;
      callback();
      observer.disconnect();
    }
  }, { threshold });
  observer.observe(element);
}

function observeRevealEnd() {
  observeOnce($('#reveal-sentinel'), 0.9, () => track('reveal_completed'));
}

function observeTips() {
  observeOnce($('#good-news'), 0.25, () => track('tips_viewed'));
}

function scrollToId(id) {
  const node = document.getElementById(id);
  if (!node) return;
  node.scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth', block: 'start' });
}

function setupHandlers() {
  $('#lang-toggle').addEventListener('click', () => {
    const next = state.lang === 'ar' ? 'en' : 'ar';
    setLanguage(next);
  });
  $('#skip-animation').addEventListener('click', skipScanning);
  $('#geo-button').addEventListener('click', requestLocation);
  $('#scammer-next').addEventListener('click', () => scrollToId('quiz-section'));
  $('#good-next').addEventListener('click', () => scrollToId('waqi'));
  $('#waqi-cta').addEventListener('click', () => track('waqi_cta_clicked'));
  $('#share-button').addEventListener('click', onShare);
  $('#share-download').addEventListener('click', onDownload);
  $('#share-data').addEventListener('change', renderSharePreview);
}

function init() {
  state.lang = initialLang();
  state.copy = content[state.lang];
  state.slug = readSlug();
  state.visitorId = getVisitorId();

  applyStatic();
  setupHandlers();

  if (state.slug) {
    initFunnel({ slug: state.slug, visitorId: state.visitorId });
    void recordScan({
      slug: state.slug,
      visitorId: state.visitorId,
      userAgent: navigator.userAgent,
      referrer: document.referrer || null,
    });
  }

  armScanner();
}

init();

// Canvas share card. Everything is drawn locally; the image is never uploaded.
// Visitor data is only drawn when the caller passes dataLines from the
// explicit opt-in checkbox.

import { LANDING_BASE_URL } from '../config.js';

const WIDTH = 1080;
const HEIGHT = 1350;

function configuredBase() {
  const value = String(LANDING_BASE_URL || '');
  if (/^https?:\/\//i.test(value) && !/YOUR_|REPLACE_/i.test(value)) return value;
  return `${location.origin}${location.pathname}`;
}

export function buildLandingUrl(slug) {
  try {
    const url = new URL(configuredBase(), location.href);
    if (slug) url.searchParams.set('src', slug);
    return url.href;
  } catch {
    return `${location.origin}${location.pathname}${slug ? `?src=${encodeURIComponent(slug)}` : ''}`;
  }
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

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawParagraph(ctx, text, x, y, maxWidth, lineHeight, family, weight, size, color) {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  const lines = wrapLines(ctx, text, maxWidth);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function drawQrFallback(ctx, x, y, size) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.fillStyle = '#05070a';
  ctx.font = `800 ${Math.round(size * 0.17)}px ui-monospace, Consolas, monospace`;
  ctx.fillText('WAQI', x + size / 2, y + size * 0.5);
  ctx.fillStyle = 'rgba(5,7,10,0.55)';
  ctx.font = `700 ${Math.round(size * 0.065)}px ui-monospace, Consolas, monospace`;
  ctx.fillText('SCAN THE LINK', x + size / 2, y + size * 0.64);
  ctx.restore();
}

async function drawQrCode(ctx, x, y, size, url) {
  ctx.fillStyle = '#f4f1e8';
  roundedRect(ctx, x - 10, y - 10, size + 20, size + 20, 16);
  ctx.fill();
  try {
    if (window.QRCode?.toCanvas) {
      const qr = document.createElement('canvas');
      await window.QRCode.toCanvas(qr, url, {
        errorCorrectionLevel: 'H',
        width: size,
        margin: 4,
        color: { dark: '#05070a', light: '#f4f1e8' },
      });
      ctx.drawImage(qr, x, y, size, size);
      return;
    }
  } catch {
    // Fall back to a clearly non-scannable brand tile if the CDN is blocked.
  }
  drawQrFallback(ctx, x, y, size);
}

export async function drawShareCard(canvas, {
  copy,
  lang = 'en',
  slug = '',
  dataLines = [],
}) {
  if (!canvas) return null;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const rtl = lang === 'ar';
  const family = rtl
    ? '"Segoe UI", Tahoma, "Noto Naskh Arabic", Arial, sans-serif'
    : '"Segoe UI", Helvetica, Arial, sans-serif';
  const mono = 'ui-monospace, "SFMono-Regular", Consolas, monospace';
  const ink = '#f4f1e8';
  const muted = 'rgba(244,241,232,0.62)';
  const orange = '#ff5a1f';
  const panel = '#0b1017';
  const edge = 'rgba(244,241,232,0.14)';

  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const gradient = ctx.createRadialGradient(WIDTH * 0.78, HEIGHT * 0.16, 20, WIDTH * 0.78, HEIGHT * 0.16, 620);
  gradient.addColorStop(0, 'rgba(255,90,31,0.2)');
  gradient.addColorStop(1, 'rgba(255,90,31,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  const x = rtl ? WIDTH - 86 : 86;
  const maxWidth = WIDTH - 172;

  ctx.fillStyle = orange;
  ctx.fillRect(rtl ? WIDTH - 86 : 86, 76, 88, 6);

  ctx.font = `800 54px ${mono}`;
  ctx.fillStyle = ink;
  ctx.fillText('WAQI', x, 170);

  ctx.font = `600 20px ${mono}`;
  ctx.fillStyle = orange;
  ctx.fillText(rtl ? 'توعية رموز QR' : 'QR AWARENESS', x, 208);

  let cursor = 320;
  ctx.font = `800 82px ${family}`;
  cursor = drawParagraph(ctx, copy.card.headline, x, cursor, maxWidth, 96, family, 800, 82, ink);

  cursor += 30;
  cursor = drawParagraph(ctx, copy.card.sub, x, cursor, maxWidth, 62, family, 500, 48, muted);

  cursor += 50;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rtl ? WIDTH - 86 : 86, cursor);
  ctx.lineTo(rtl ? 86 : WIDTH - 86, cursor);
  ctx.stroke();

  cursor += 58;

  const qrSize = dataLines.length ? 250 : 340;
  const qrX = Math.round((WIDTH - qrSize) / 2);
  const url = buildLandingUrl(slug);
  await drawQrCode(ctx, qrX, cursor, qrSize, url);

  cursor += qrSize + 46;

  if (dataLines.length) {
    const boxHeight = 48 + dataLines.length * 34;
    ctx.fillStyle = panel;
    roundedRect(ctx, 86, cursor, WIDTH - 172, boxHeight, 22);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.stroke();

    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.fillStyle = orange;
    ctx.font = `700 20px ${mono}`;
    ctx.fillText(copy.card.dataLabel, x, cursor + 32);
    ctx.fillStyle = ink;
    ctx.font = `500 24px ${family}`;
    dataLines.slice(0, 4).forEach((line, index) => {
      ctx.fillText(line, x, cursor + 68 + index * 34);
    });
    cursor += boxHeight + 28;
  }

  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillStyle = muted;
  ctx.font = `600 22px ${mono}`;
  ctx.fillText(copy.card.footer, x, HEIGHT - 72);

  ctx.textAlign = rtl ? 'left' : 'right';
  ctx.fillStyle = orange;
  ctx.font = `700 20px ${mono}`;
  ctx.fillText('0.8s', rtl ? 86 : WIDTH - 86, HEIGHT - 72);

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

function downloadBlob(blob, filename = 'waqi-share.png') {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareCard(canvas, options) {
  await drawShareCard(canvas, options);
  const blob = await canvasToBlob(canvas);
  if (!blob) throw new Error('Could not create image');

  try {
    const file = new File([blob], 'waqi-share.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        text: String(options.copy.shareText || '').replace('{url}', buildLandingUrl(options.slug)),
      });
      return 'shared';
    }
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
  }

  downloadBlob(blob);
  return 'downloaded';
}

export async function downloadCard(canvas, options) {
  await drawShareCard(canvas, options);
  const blob = await canvasToBlob(canvas);
  if (!blob) throw new Error('Could not create image');
  downloadBlob(blob);
  return 'downloaded';
}

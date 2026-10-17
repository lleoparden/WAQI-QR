// Anonymous funnel pings: fixed event names only, no payload, no retries.
// The backend independently validates the whitelist and de-duplicates.

import { recordEvent } from '../js/api.js';

export const FUNNEL_EVENTS = Object.freeze([
  'reveal_started',
  'reveal_completed',
  'tips_viewed',
  'waqi_cta_clicked',
  'share_clicked',
  'quiz_completed',
  'lang_toggled',
  'skipped_animation',
]);

const allowed = new Set(FUNNEL_EVENTS);
const sent = new Set();
let context = null;

export function initFunnel({ slug, visitorId }) {
  if (!slug || !visitorId) {
    context = null;
    return false;
  }
  context = { slug, visitorId };
  return true;
}

export function track(event) {
  try {
    if (!context || !allowed.has(event) || sent.has(event)) return false;
    sent.add(event);
    void recordEvent({
      slug: context.slug,
      visitorId: context.visitorId,
      event,
    });
    return true;
  } catch {
    return false;
  }
}

import { getSession, isConfigured, signIn } from '../js/api.js';
import { PALETTES, paletteCss } from './palettes.js';

const form = document.querySelector('#login-form');
const email = document.querySelector('#login-email');
const password = document.querySelector('#login-password');
const submit = document.querySelector('#login-submit');
const status = document.querySelector('#login-status');

try {
  const saved = localStorage.getItem('waqi_admin_palette');
  const palette = PALETTES[saved];
  if (palette) {
    for (const [name, value] of Object.entries(paletteCss(palette))) {
      document.documentElement.style.setProperty(name, value);
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = `#${palette.lt2}`;
  }
} catch {
  // A private window can block storage; the default palette still works.
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function redirectIfSignedIn() {
  if (!isConfigured()) {
    setStatus('Supabase is not configured. Edit web/config.js first.', true);
    return;
  }
  try {
    const session = await getSession();
    if (session) location.replace('./');
  } catch {
    // Stay on the login screen.
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isConfigured()) {
    setStatus('Supabase is not configured. Edit web/config.js first.', true);
    return;
  }
  submit.disabled = true;
  setStatus('Signing in…');
  try {
    await signIn(email.value.trim(), password.value);
    location.replace('./');
  } catch (error) {
    const message = error?.status === 400
      ? 'Wrong email or password.'
      : error?.message || 'Could not sign in.';
    setStatus(message, true);
    submit.disabled = false;
  }
});

redirectIfSignedIn();

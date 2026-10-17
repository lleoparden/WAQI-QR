import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relativePath) => readFile(join(root, relativePath), 'utf8');

test('deploy workflow publishes only the static web folder', async () => {
  const workflow = await read('.github/workflows/deploy.yml');
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /uses: actions\/configure-pages@v5/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /path: web/);
  assert.match(workflow, /uses: actions\/deploy-pages@v4/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
});

test('keepalive workflow pings the public RPC with repository secrets', async () => {
  const workflow = await read('.github/workflows/keepalive.yml');
  assert.match(workflow, /cron: '17 3 \*\/2 \* \*'/);
  assert.match(workflow, /secrets\.SUPABASE_URL/);
  assert.match(workflow, /secrets\.SUPABASE_ANON_KEY/);
  assert.match(workflow, /rest\/v1\/rpc\/ping/);
  assert.doesNotMatch(workflow, /SERVICE_ROLE/i);
});

test('the static site has no build step and includes a root redirect', async () => {
  const redirect = await read('web/index.html');
  assert.match(redirect, /\.\/landing\//);
  assert.match(redirect, /window\.location\.search/);
  const nojekyll = await read('web/.nojekyll');
  assert.equal(nojekyll, '');
});

test('the quiz placeholder asset exists and is local', async () => {
  const svg = await read('web/landing/assets/instapay-placeholder.svg');
  assert.ok(svg.length > 500);
  assert.match(svg, /^<svg/);
  assert.match(svg, /PLACEHOLDER/);
});

test('documentation deliverables exist', async () => {
  for (const file of ['README.md', 'API.md', 'TESTING.md']) {
    const text = await read(file);
    assert.ok(text.length > 200, `${file} should have real content`);
  }
});

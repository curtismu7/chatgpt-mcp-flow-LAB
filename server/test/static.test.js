import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, UI_CSP } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { freeBase, request } from './helpers.js';

// Uses the 'static' slice (6699 only): static serving needs no mock actors, so the runtime is a stub.
async function boot(t, webDist) {
  const port = await freeBase('static', 1);
  const rt = { mode: 'mock', listRuns: () => [], reset() {} };
  const health = createHealth();
  const server = createApp({ runtime: rt, health, webDist }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  return port;
}
const distWith = (t, files = {}) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpflow-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ui</title>');
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dist, f), c);
  return dist;
};

test('the built UI is served with a same-origin CSP; the Host guard still applies', async (t) => {
  const port = await boot(t, distWith(t, { '.secret': 'x' }));
  const root = await request(port, 'GET', '/');
  assert.equal(root.status, 200);
  assert.match(root.headers['content-type'], /text\/html/);
  const csp = root.headers['content-security-policy'];
  assert.equal(csp, UI_CSP);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline|https?:|\*/);
  const dir = (name) => csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `));
  assert.equal(dir('script-src'), "script-src 'self'");
  assert.equal(dir('connect-src'), "connect-src 'self'");
  assert.equal(dir('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(dir('object-src'), "object-src 'none'");
  assert.equal(dir('base-uri'), "base-uri 'none'");
  assert.equal(dir('form-action'), "form-action 'none'");
  assert.equal(root.headers['x-content-type-options'], 'nosniff');
  assert.equal(root.headers['cache-control'], 'no-store');
  assert.equal((await request(port, 'GET', '/.secret')).status, 404);
  assert.equal((await request(port, 'GET', '/', { host: 'evil.example.com' })).status, 421);
  assert.ok((await request(port, 'GET', '/%ZZ')).status < 500);
  assert.equal((await request(port, 'GET', '/api/health')).headers['content-security-policy'], "default-src 'none'");
});

test('static serving opens no write path and refuses credentials', async (t) => {
  const port = await boot(t, distWith(t));
  assert.equal((await request(port, 'POST', '/', { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await request(port, 'POST', '/api/reset', { headers: { origin: 'http://evil.example' } })).status, 403);
  for (const headers of [{ authorization: 'x' }, { 'x-api-key': 'k' }, { 'proxy-authorization': 'y' }]) {
    const res = await request(port, 'GET', '/', { headers });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'credentials_not_accepted');
  }
});

test('without a built UI, or with webDist null, GET / is a JSON 404', async (t) => {
  const p1 = await boot(t, path.join(os.tmpdir(), 'mcpflow-no-such-dist'));
  const res = await request(p1, 'GET', '/');
  assert.equal(res.status, 404);
  assert.equal(res.json.error, 'not_found');
});

test('webDist null disables static serving', async (t) => {
  const port = await boot(t, null);
  assert.equal((await request(port, 'GET', '/')).status, 404);
});

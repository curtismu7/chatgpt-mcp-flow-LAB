// Host guard, CSRF guard, credential guard. Each test names the attack it stops; the red checks are in docs/safety.md.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createApp } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createRuntime } from '../src/runtime.js';
import { hostGuard, makeHostGuard, makeOriginGuard, originGuard, parseAllowedHosts, parseHost } from '../src/safety.js';
import { GUARDS_CONTROL_PORT, freeBase, request } from './helpers.js';

let rt; let health; let server; let port;
before(async () => {
  const base = await freeBase('guards', 5);
  rt = await createRuntime({ stubBase: base });
  health = createHealth();
  port = GUARDS_CONTROL_PORT;
  server = createApp({ runtime: rt, health }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
});
after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); await rt.close(); });
const sameOrigin = () => ({ origin: `http://127.0.0.1:${port}` });

test('Host guard: a non-loopback, malformed or missing Host gets 421 on every route (DNS rebinding)', async () => {
  for (const host of ['evil.example', 'evil.example:6650', '127.0.0.1.evil.example', '127.999.999.999', '[::1]junk', 'localhost.evil.example', '10.0.0.5:6650', '0.0.0.0', 'evil127.0.0.1', 'xlocalhost:6650']) {
    for (const path of ['/api/health', '/api/flow', '/api/runs']) {
      const res = await request(port, 'GET', path, { host });
      assert.equal(res.status, 421, `${host} ${path}`);
      assert.equal(res.json.error, 'bad_host');
    }
    assert.equal((await request(port, 'POST', '/api/reset', { host })).status, 421, `${host} POST`);
  }
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, '127.0.0.1']) assert.equal((await request(port, 'GET', '/api/health', { host })).status, 200, host);
});

test('Host guard: HTTP/1.0 without a Host header is refused', async () => {
  const raw = await new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write('GET /api/health HTTP/1.0\r\n\r\n'));
    let buf = ''; s.on('data', (d) => { buf += d; }); s.on('close', () => resolve(buf));
  });
  assert.match(raw, /^HTTP\/1\.\d 421/);
});

test('CSRF: a cross-origin page cannot run the flow or reset', async () => {
  await request(port, 'POST', '/api/reset', { headers: sameOrigin() });
  const attacks = [
    { origin: 'https://evil.example' }, { origin: 'http://127.0.0.1:1' }, { origin: `http://localhost:${port}` }, { origin: 'null' },
    { origin: `http://127.0.0.1:${port}.evil.example` }, { origin: `http://user:pw@127.0.0.1:${port}` },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'cross-site', origin: `http://127.0.0.1:${port}` },
  ];
  for (const headers of attacks) {
    for (const [p, body] of [['/api/runs', { mistake: null }], ['/api/reset', undefined]]) {
      const res = await request(port, 'POST', p, { body, headers });
      assert.equal(res.status, 403, `${p} ${JSON.stringify(headers)}`);
    }
  }
  assert.deepEqual(rt.listRuns(), [], 'no run happened');
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
    const res = await request(port, 'POST', '/api/runs', { body: '{"mistake":null}', headers: { 'content-type': ct } });
    assert.equal(res.status, 415, ct);
  }
  assert.deepEqual(rt.listRuns(), []);
  assert.equal((await request(port, 'POST', '/api/runs', { body: {}, headers: sameOrigin() })).status, 200, 'same origin works');
  assert.equal((await request(port, 'POST', '/api/runs', { body: {} })).status, 200, 'no Origin at all is curl or the e2e script');
});

test('credentials are refused, not ignored, on every route (including health)', async () => {
  for (const h of [{ authorization: 'Bearer abc' }, { 'proxy-authorization': 'Basic abc' }, { 'x-api-key': 'k' }, { Authorization: 'x' }]) {
    for (const [m, p] of [['GET', '/api/health'], ['GET', '/api/flow'], ['GET', '/api/runs'], ['POST', '/api/reset'], ['POST', '/api/runs'], ['GET', '/nothing']]) {
      const res = await request(port, m, p, { headers: h });
      assert.equal(res.status, 400, `${m} ${p} ${Object.keys(h)}`);
      assert.equal(res.json.error, 'credentials_not_accepted');
    }
  }
});

const fakeRes = () => { const r = { code: null, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const guard = (headers, method = 'POST') => { const res = fakeRes(); let passed = false; originGuard({ method, headers }, res, () => { passed = true; }); return { passed, code: res.code }; };

test('Host parsing is anchored: a name that merely ends in a loopback address is refused', () => {
  for (const h of ['evil127.0.0.1', 'xlocalhost', 'a[::1]', '1127.0.0.1', 'evil127.0.0.1:6650']) assert.equal(parseHost(h), null, h);
  assert.equal(parseHost('127.0.0.1').hostname, '127.0.0.1');
});

test('JSON-only: a chunked body, or a content type that merely starts with application/json, is refused', () => {
  assert.equal(guard({ host: '127.0.0.1:6650', 'transfer-encoding': 'chunked', 'content-type': 'text/plain' }).code, 415);
  for (const ct of ['application/jsonx', 'application/json-seq', 'text/plain', '']) assert.equal(guard({ host: '127.0.0.1:6650', 'content-length': '2', 'content-type': ct }).code, 415, ct);
  for (const ct of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON']) assert.equal(guard({ host: '127.0.0.1:6650', 'content-length': '2', 'content-type': ct }).passed, true, ct);
});

test('Origin scheme and path: only an http loopback origin that equals the Host passes', () => {
  assert.equal(guard({ host: '127.0.0.1:6650', origin: 'http://127.0.0.1:6650' }).passed, true);
  for (const origin of ['https://127.0.0.1:6650', 'ftp://127.0.0.1:6650', 'http://127.0.0.1:6651', 'http://localhost:6650', 'null', 'http://127.0.0.1:6650/x', 'http://u:p@127.0.0.1:6650']) assert.equal(guard({ host: '127.0.0.1:6650', origin }).code, 403, origin);
});

// Behind the family lab-proxy (https://local.ping-devops.com:8443): Host is this lab's LAB_ALLOWED_HOSTS name with its port,
// the browser's Origin is the proxy's, and the proxy says so in X-Forwarded-Host/-Proto.
test('lab-proxy: LAB_ALLOWED_HOSTS parsing, launcher Host, proxied writes, and what stays refused', () => {
  assert.deepEqual([...parseAllowedHosts({})], []);
  assert.deepEqual([...parseAllowedHosts({ LAB_ALLOWED_HOSTS: ' ChatGPT-MCP-Flow.local.ping-devops.com , ' })], ['chatgpt-mcp-flow.local.ping-devops.com']);
  for (const bad of ['a.example:6650', 'https://a.example', 'a b']) assert.throws(() => parseAllowedHosts({ LAB_ALLOWED_HOSTS: bad }), /not a host name/);
  const name = 'chatgpt-mcp-flow.local.ping-devops.com';
  const opts = { allowed: parseAllowedHosts({ LAB_ALLOWED_HOSTS: name }), port: 6650 };
  const run = (mw, headers, method = 'POST') => { const res = fakeRes(); let passed = false; mw({ method, headers }, res, () => { passed = true; }); return { passed, code: res.code }; };
  const hg = makeHostGuard(opts);
  const og = makeOriginGuard(opts);
  // launcher Host accepted; loopback still accepted
  assert.equal(run(hg, { host: `${name}:6650` }, 'GET').passed, true);
  assert.equal(run(hg, { host: '127.0.0.1:6650' }, 'GET').passed, true);
  // a Host outside the set is refused: the bare proxy name, another name, the right name on another port, no port; unset = loopback only
  for (const host of ['local.ping-devops.com:6650', 'local.ping-devops.com:8443', 'evil.example:6650', `${name}:6651`, name]) assert.equal(run(hg, { host }, 'GET').code, 421, host);
  assert.equal(run(hostGuard, { host: `${name}:6650` }, 'GET').code, 421);
  // proxied same-origin write accepted
  const proxied = { host: `${name}:6650`, 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin', 'content-length': '2', 'content-type': 'application/json' };
  assert.equal(run(og, { ...proxied, origin: 'https://local.ping-devops.com:8443' }).passed, true);
  // foreign Origin refused, and an Origin that does not match the forwarded host or scheme
  for (const origin of ['https://evil.example', 'http://local.ping-devops.com:8443', 'https://local.ping-devops.com']) assert.equal(run(og, { ...proxied, origin }).code, 403, origin);
  assert.equal(run(og, { ...proxied, 'x-forwarded-proto': 'ftp', origin: 'ftp://local.ping-devops.com:8443' }).code, 403);
  assert.equal(run(og, { ...proxied, 'x-forwarded-host': '', origin: 'https://' }).code, 403);
  // forwarded headers on a loopback Host are ignored
  assert.equal(run(og, { ...proxied, host: '127.0.0.1:6650', origin: 'https://local.ping-devops.com:8443' }).code, 403);
  assert.equal(run(og, { ...proxied, host: 'localhost:6650', 'x-forwarded-host': 'evil.example', origin: 'https://evil.example' }).code, 403);
  // and without LAB_ALLOWED_HOSTS the proxy's origin is never believed
  assert.equal(guard({ ...proxied, origin: 'https://local.ping-devops.com:8443' }).code, 403);
});

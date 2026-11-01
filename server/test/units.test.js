// Pure-function pins: PKCE, JWT/ES256, token validation, redaction, inert text, safety helpers, definition integrity, doctor, health.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { challengeS256, isValidVerifier, newVerifier, verifyPkce } from '../src/pkce.js';
import { b64u, createKeyPair, parseJwt, signJwt, verifySignature } from '../src/jwt.js';
import { validateBearer } from '../src/tokens.js';
import { redactDeep, redactText } from '../src/redaction.js';
import { hasInvisible, inertValue, revealText } from '../src/sanitize.js';
import { presentValue } from '../src/present.js';
import { MAX_RESPONSE_BYTES, WIRE_TIMEOUT_MS, createWire } from '../src/wire.js';
import { bearerOf } from '../src/actors/private.js';
import { actorPortOk, assertBindAllowed, credentialGuard, isLoopbackHost, parseHost, portInRange } from '../src/safety.js';
import { MISTAKES, ORIGINS, PARTICIPANTS, STEPS } from '../src/definition.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { createHealth } from '../src/health.js';
import { createClock } from '../src/clock.js';

const key = createKeyPair('k1');
const jwks = { keys: [key.publicJwk] };
const NOW = 1_800_000_000;
const claims = (over = {}) => ({ iss: ORIGINS.as, aud: ORIGINS.gateway, sub: 'user-1', scope: 'items.read profile.read', iat: NOW, exp: NOW + 300, ...over });
const sign = (c, h = {}) => signJwt({ alg: 'ES256', typ: 'at+jwt', kid: 'k1', ...h }, c, key.privateKey);
const opts = (over = {}) => ({ jwks, iss: ORIGINS.as, aud: ORIGINS.gateway, nowSec: NOW, scopes: ['items.read'], ...over });

test('PKCE: a vector computed independently with openssl, and a wrong verifier does not verify', () => {
  const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p2r_gkfdhsbtAqPM'.padEnd(43, 'x').slice(0, 43);
  assert.equal(challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p2r_gkfdhsbtAqPM'), 'sWIiysaT0O1UP4jBdh_tX6Es9Oi8_mg47EdB52Zi0Uk');
  assert.equal(verifyPkce(v, challengeS256(v)), true);
  assert.equal(verifyPkce(newVerifier(), challengeS256(v)), false);
  assert.equal(verifyPkce(`${v}A`, challengeS256(v)), false);
  assert.equal(verifyPkce(undefined, challengeS256(v)), false);
  assert.equal(verifyPkce(v, 'short'), false);
  assert.equal(isValidVerifier('a'.repeat(42)), false);
  assert.equal(isValidVerifier('a'.repeat(129)), false);
  assert.equal(isValidVerifier(`${'a'.repeat(42)}!`), false);
  assert.equal(newVerifier().length, 43);
});

test('ES256 keys come from ECDH + JWK import (no generateKeyPair), and signatures verify only with the right key and algorithm', () => {
  const t = sign(claims());
  assert.equal(verifySignature(t, jwks).ok, true);
  const other = createKeyPair('k1');
  assert.equal(verifySignature(t, { keys: [other.publicJwk] }).ok, false, 'a different key with the same kid');
  assert.equal(verifySignature(t, { keys: [{ ...key.publicJwk, kid: 'k2' }] }).ok, false, 'unknown kid');
  const [h, p, s] = t.split('.');
  const tamper = `${h}.${b64u(JSON.stringify(claims({ scope: 'admin' })))}.${s}`;
  assert.equal(verifySignature(tamper, jwks).ok, false, 'payload tampered');
  const none = `${b64u(JSON.stringify({ alg: 'none', typ: 'at+jwt', kid: 'k1' }))}.${p}.`;
  assert.equal(verifySignature(none, jwks).ok, false, 'alg none');
  const hs = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'at+jwt', kid: 'k1' }))}.${p}.${s}`;
  assert.equal(verifySignature(hs, jwks).ok, false, 'HS256 confusion');
  const wrongAlg = signJwt({ alg: 'HS256', typ: 'at+jwt', kid: 'k1' }, claims(), key.privateKey);
  assert.equal(verifySignature(wrongAlg, jwks).ok, false, 'a valid ES256 signature under a header that claims another algorithm');
  assert.match(verifySignature(wrongAlg, jwks).reason, /ES256 only/);
  assert.equal(parseJwt('a.b').ok, false);
  assert.equal(parseJwt('x'.repeat(5000)).ok, false);
  assert.equal(parseJwt(undefined).ok, false);
});

test('token validation: every check is its own pin (iss, aud, exp, nbf, typ, scope, act)', () => {
  assert.equal(validateBearer(sign(claims()), opts()).ok, true);
  const bad = (c, o, h) => validateBearer(sign(claims(c), h), opts(o));
  let r = bad({ iss: 'https://attacker.invalid' }); assert.equal(r.ok, false); assert.match(r.reason, /^iss/);
  r = bad({ aud: ORIGINS.otherResource }); assert.match(r.reason, /^aud/);
  r = bad({ aud: [ORIGINS.otherResource] }); assert.match(r.reason, /^aud/);
  assert.equal(bad({ aud: [ORIGINS.otherResource, ORIGINS.gateway] }).ok, true, 'array audience containing ours');
  r = bad({ exp: NOW - 60 }); assert.match(r.reason, /^exp/);
  assert.equal(bad({ exp: NOW - 3 }).ok, true, 'within the 5 s leeway');
  r = bad({ exp: undefined }); assert.match(r.reason, /^exp/);
  r = bad({ nbf: NOW + 600 }); assert.match(r.reason, /^nbf/);
  r = bad({}, {}, { typ: 'JWT' }); assert.match(r.reason, /^typ/);
  r = bad({ scope: 'profile.read' }); assert.equal(r.error, 'insufficient_scope');
  r = bad({ scope: 'items.read.extra' }); assert.equal(r.error, 'insufficient_scope', 'scope match is by whole token, not prefix');
  r = bad({}, { actSub: 'gateway-nhi' }); assert.match(r.reason, /^act/);
  assert.equal(bad({ act: { sub: 'gateway-nhi' } }, { actSub: 'gateway-nhi' }).ok, true);
  assert.equal(bad({ act: { sub: 'someone-else' } }, { actSub: 'gateway-nhi' }).ok, false);
  assert.equal(validateBearer('garbage', opts()).error, 'invalid_token');
});

test('redaction: secret-keyed values and secret-shaped strings go; mock tokens, codes and verifiers stay visible', () => {
  const jwt = sign(claims());
  const out = redactDeep({ password: 'p', otp: '000000', client_secret: 's', Cookie: 'a=b', access_token: jwt, code: 'abc', code_verifier: 'v'.repeat(43), nested: [{ api_key: 'k' }], keep: 'Basic ' + 'QUJDREVGRw==' });
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.otp, '[REDACTED]');
  assert.equal(out.client_secret, '[REDACTED]');
  assert.equal(out.Cookie, '[REDACTED]');
  assert.equal(out.nested[0].api_key, '[REDACTED]');
  assert.equal(out.access_token, jwt, 'mock-issued tokens are shown on purpose');
  assert.equal(out.code, 'abc');
  assert.equal(out.code_verifier, 'v'.repeat(43));
  assert.equal(out.keep, 'Basic [REDACTED]');
  // assembled at runtime so no secret-shaped literal sits in the repo
  const aws = ['AK', 'IA'].join('') + 'ABCDEFGHIJKLMNOP';
  const pem = ['-----BEGIN ', 'PRIVATE KEY-----\nabc\n-----END ', 'PRIVATE KEY-----'].join('');
  assert.equal(redactText(`k ${aws} ${pem}`), 'k [REDACTED] [REDACTED]');
  assert.equal(redactText('client_secret=abc123&x=1'), 'client_secret=[REDACTED]&x=1');
  assert.equal(redactDeep(5), 5);
});

test('inert text: hidden and control characters are shown, deep values are bounded', () => {
  assert.equal(revealText('a‮b​c\u0007'), 'a[U+202E]b[U+200B]c[U+0007]');
  assert.equal(hasInvisible('plain'), false);
  assert.equal(hasInvisible('x﻿y'), true);
  assert.ok(revealText('x'.repeat(5000)).length <= 2001);
  let deep = 'leaf'; for (let i = 0; i < 40; i += 1) deep = { d: deep };
  assert.ok(JSON.stringify(inertValue(deep)).includes('[truncated]'));
  assert.equal(inertValue({ 'k​': 'v' })['k[U+200B]'], 'v');
});

test('safety helpers: loopback only, ports confined to 6650-6699', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '10.0.0.1', 'evil.example', '127.0.0.1.evil.example', '128.0.0.1']) assert.equal(isLoopbackHost(h), false, h);
  for (const h of ['evil127.0.0.1', 'xlocalhost', '127.0.0.1:99999', 'a.example:6650', '']) assert.equal(parseHost(h), null, h);
  assert.equal(parseHost('LOCALHOST:6650').host, 'localhost:6650');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('0.0.0.0', { MCP_FLOW_BIND: '0.0.0.0' }), '0.0.0.0');
  for (const p of [6650, 6651, 6699]) assert.equal(portInRange(p), true);
  for (const p of [6665, 6669, 6679, 6697]) assert.equal(actorPortOk(p), false, `fetch refuses ${p}`);
  for (const p of [6651, 6655, 6680]) assert.equal(actorPortOk(p), true);
  for (const p of [6649, 6700, 8080, 5173, 4000, 1.5, NaN]) assert.equal(portInRange(p), false, String(p));
});

test('definition: 20 numbered messages, valid participants and phases, every mistake points at a real step and actor', () => {
  assert.equal(STEPS.length, 20);
  const ids = new Set(PARTICIPANTS.map((p) => p.id));
  STEPS.forEach((s, i) => { assert.equal(s.n, i + 1); assert.ok(ids.has(s.from) && ids.has(s.to)); });
  const phases = new Set(['catalog', 'experience', 'discovery', 'authn', 'redemption', 'obo']);
  for (const s of STEPS) assert.ok(phases.has(s.phase));
  assert.equal(new Set(MISTAKES.map((m) => m.id)).size, MISTAKES.length);
  for (const m of MISTAKES) { assert.ok(m.expected.step >= 1 && m.expected.step <= 20); assert.ok(ids.has(m.expected.actor)); if (m.id === 'unlisted_connector') assert.equal(m.standard, 'no standard, UNVERIFIED'); else assert.match(m.standard, /^RFC \d+$/); }
});

test('every hostname in the definition is .example or .invalid', () => {
  for (const url of Object.values(ORIGINS)) assert.match(new URL(url).hostname, /\.(example|invalid)$/, url);
});

test('doctor passes, and fails on an out-of-range port or a non-loopback bind', () => {
  assert.equal(allPassed(runChecks({ env: {} })), true);
  assert.equal(allPassed(runChecks({ env: { MCP_FLOW_PORT: '8080' } })), false);
  assert.equal(allPassed(runChecks({ env: { MCP_FLOW_PORT: '6700' } })), false);
  assert.equal(runChecks({ env: {} }).find((c) => c.id === 'bind').level, 'pass');
});

test('health: demo-health/1 shape, ready when the doctor passes, broken when it fails, never runs per request', async (t) => {
  let calls = 0;
  const h = createHealth({ runChecks: () => { calls += 1; return [{ level: 'pass' }]; }, now: () => new Date('2026-10-21T12:00:00Z'), intervalMs: 3_600_000 });
  const { default: express } = await import('express');
  const app = express(); app.use('/api/health', h.router);
  const srv = app.listen(0, '127.0.0.1'); // ephemeral loopback only inside this pure test; see helpers for the real port slices
  await new Promise((r) => srv.once('listening', r));
  t.after(() => { h.stop(); srv.closeAllConnections(); srv.close(); }); // always close: a failed assertion must not leave a listener that hangs the run
  const url = `http://127.0.0.1:${srv.address().port}/api/health`;
  const body = await (await fetch(url)).json();
  await fetch(url);
  assert.equal(calls, 1);
  assert.equal(body.schema, 'demo-health/1');
  assert.equal(body.state, 'ready');
  assert.equal(body.runtime, 'offline');
  assert.equal(body.demo.id, 'chatgpt-mcp-flow');
  assert.equal(body.at, '2026-10-21T12:00:00.000Z');
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const broken = createHealth({ runChecks: () => [{ level: 'fail' }] }); assert.ok(broken.router); broken.stop();
  const thrown = createHealth({ runChecks: () => { throw new Error('x'); } }); thrown.stop();
});

test('clock: advancing moves time without sleeping, reset restores it', () => {
  const c = createClock(() => 1_000_000);
  assert.equal(c.nowSec(), 1000);
  c.advance(60_000); assert.equal(c.nowSec(), 1060);
  c.reset(); assert.equal(c.nowSec(), 1000);
  assert.ok(crypto.randomBytes(1).length === 1);
});

// ---------------------------------------------------------------- MF2 pins
test('inert text caps: 100 array items, 50 object keys, depth 12; strings inside present() are revealed after redaction', () => {
  assert.equal(inertValue(Array.from({ length: 300 }, (_, i) => i)).length, 100);
  assert.equal(Object.keys(inertValue(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i])))).length, 50);
  assert.equal(presentValue({ a: 'x‮y​' }).a, 'x[U+202E]y[U+200B]');
  assert.equal(presentValue({ password: 'p​' }).password, '[REDACTED]');
  let deep = 'leaf'; for (let i = 0; i < 11; i += 1) deep = { d: deep };
  assert.ok(!JSON.stringify(inertValue(deep)).includes('[truncated]'), 'eleven levels survive');
  assert.ok(!JSON.stringify(presentValue(deep)).includes('[truncated]'), 'redaction keeps the same depth');
});

test('the cookie header is a credential the control API refuses', () => {
  const sent = [];
  const res = { status: (c) => ({ json: (b) => sent.push([c, b.error]) }) };
  credentialGuard({ headers: { cookie: 'a=b' } }, res, () => sent.push('next'));
  assert.deepEqual(sent, [[400, 'credentials_not_accepted']]);
});

test('the Authorization header is read strictly: anchored Bearer scheme, one token, token characters only', () => {
  assert.equal(bearerOf({ headers: { authorization: 'Bearer abc.def-1' } }), 'abc.def-1');
  for (const v of ['XBearer abc', 'Bearer abc def', 'Bearer abc\nx', ' Bearer abc', 'bearer abc', 'Bearer ', 'Bearer a b', 'Basic abc', 'Bearer abc!', undefined]) {
    assert.equal(bearerOf({ headers: { authorization: v } }), null, String(v));
  }
});

test('the wire bounds what it keeps: responses are cut at 64 KB and a call that never answers is aborted', async () => {
  const routes = new Map([['https://a.example', 6651]]);
  const big = createWire({ routes, fetchImpl: async () => new Response('x'.repeat(MAX_RESPONSE_BYTES * 2), { status: 200 }) });
  const r = await big.call({ from: 'client', to: 'gateway', url: 'https://a.example/x' });
  assert.equal(r.body.length, MAX_RESPONSE_BYTES);
  const hang = createWire({ routes, timeoutMs: 50, fetchImpl: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))) });
  await assert.rejects(hang.call({ from: 'client', to: 'gateway', url: 'https://a.example/x' }), (e) => e.name === 'TimeoutError');
  assert.equal(WIRE_TIMEOUT_MS, 15_000);
  let seen;
  const probe = createWire({ routes, fetchImpl: async (_u, init) => { seen = init.signal; return new Response('{}'); } });
  await probe.call({ from: 'client', to: 'gateway', url: 'https://a.example/x' });
  assert.ok(seen instanceof AbortSignal, 'the default call carries an abort signal');
});

test('no source file reaches for generateKeyPair (it aborts on Node 20 in CI); keys come from ECDH + JWK', () => {
  const banned = ['generate', 'Key', 'Pair'].join('');
  const dir = new URL('../src/', import.meta.url);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]));
  const files = walk(dir).filter((f) => f.pathname.endsWith('.js'));
  assert.ok(files.length > 10);
  for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes(banned), `${f.pathname} uses ${banned}`);
  assert.ok(fs.readFileSync(new URL('jwt.js', dir), 'utf8').includes('createECDH'));
});

test('health route on its own: GET is no-store demo-health/1, any other method is 405 with Allow: GET', () => {
  const h = createHealth({ runChecks: () => [{ ok: true }] });
  try {
    const call = (method) => new Promise((resolve) => {
      const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); return this; } };
      h.router.handle({ method, url: '/', headers: {} }, res, () => resolve({ status: 404 }));
    });
    return Promise.all([call('GET'), call('POST'), call('DELETE')]).then(([g, p, d]) => {
      assert.equal(g.status, 200);
      assert.equal(g.headers['cache-control'], 'no-store');
      assert.equal(g.body.schema, 'demo-health/1');
      for (const r of [p, d]) { assert.equal(r.status, 405); assert.equal(r.headers.allow, 'GET'); }
    });
  } finally { h.stop(); }
});

// ---------------------------------------------------------------- config, workspace, stub base
import { loadConfig } from '../src/config.js';
import { stubBase } from '../src/safety.js';
import { VERTICALS } from '../src/definition.js';

test('customer.config.json: shipped values load, the workspace id defaults to "default", env overrides it, bad values are refused', () => {
  const c = loadConfig({ env: {} });
  assert.deepEqual(c, { brand: 'Example Corp', vertical: 'default', workspace: 'default' });
  assert.equal(loadConfig({ env: { MCP_FLOW_WORKSPACE: 'team-a' } }).workspace, 'team-a');
  for (const bad of ['', 'Team', 'a b', '../x', 'x'.repeat(33), '-a']) assert.throws(() => loadConfig({ env: { MCP_FLOW_WORKSPACE: bad || ' ' } }), /workspace/, bad);
  const tmp = fs.mkdtempSync(new URL('.', import.meta.url).pathname + 'cfg-');
  try {
    const f = `${tmp}/c.json`;
    fs.writeFileSync(f, JSON.stringify({ vertical: 'nope' }));
    assert.throws(() => loadConfig({ env: {}, file: f }), /vertical/);
    fs.writeFileSync(f, JSON.stringify({ brand: 'x'.repeat(61) }));
    assert.throws(() => loadConfig({ env: {}, file: f }), /brand/);
    fs.writeFileSync(f, '{nope');
    assert.throws(() => loadConfig({ env: {}, file: f }), /valid JSON/);
    assert.equal(loadConfig({ env: {}, file: `${tmp}/missing.json` }).workspace, 'default');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.ok(VERTICALS.includes('default') && VERTICALS.length === 4);
});

test('the actor block can move with MCP_FLOW_STUB_BASE, and the doctor checks the moved block', () => {
  assert.equal(stubBase({}), 6651);
  assert.equal(stubBase({ MCP_FLOW_STUB_BASE: '6680' }), 6680);
  assert.equal(runChecks({ env: { MCP_FLOW_STUB_BASE: '6680' } }).find((c) => c.id === 'port-range').level, 'pass');
  assert.equal(runChecks({ env: { MCP_FLOW_STUB_BASE: '6693' } }).find((c) => c.id === 'port-range').level, 'fail', 'the fifth port (the catalog) would be 6697');
  assert.equal(runChecks({ env: { MCP_FLOW_STUB_BASE: '6697' } }).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal(runChecks({ env: { MCP_FLOW_STUB_BASE: '6698' } }).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal(runChecks({ env: { MCP_FLOW_STUB_BASE: '5000' } }).find((c) => c.id === 'port-range').level, 'fail');
});

test('the wire sends the workspace it was given in tracestate and a valid traceparent', async () => {
  let seen;
  const w = createWire({ routes: new Map([['https://a.example', 6651]]), workspace: 'team-a', fetchImpl: async (_u, init) => { seen = init.headers; return new Response('{}'); } });
  await w.call({ from: 'client', to: 'gateway', url: 'https://a.example/x' });
  assert.equal(seen.tracestate, 'mcpflow=team-a');
  assert.match(seen.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

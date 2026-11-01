// The control API: health, flow metadata, runs, reset, bounded input, 500s that never leak.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, outerErrorHandler } from '../src/app.js';
import { MISTAKES, PROVENANCE } from '../src/definition.js';
import { createHealth } from '../src/health.js';
import { createRuntime } from '../src/runtime.js';
import { freeBase, request } from './helpers.js';

let rt; let health; let server; let port;
const close = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); });
before(async () => {
  const base = await freeBase('api', 6);
  rt = await createRuntime({ stubBase: base });
  health = createHealth();
  port = base + 5;
  server = createApp({ runtime: rt, health }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
});
after(async () => { health.stop(); await close(server); await rt.close(); });

test('GET /api/health is demo-health/1, public, no-store, and carries no counts or detail', async () => {
  const r = await request(port, 'GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-type'], /application\/json/);
  assert.equal(r.json.schema, 'demo-health/1');
  assert.equal(r.json.state, 'ready');
  assert.equal(r.json.runtime, 'offline');
  assert.deepEqual(Object.keys(r.json.demo).sort(), ['id', 'name', 'version']);
  assert.ok(r.raw.length < 4096);
  assert.ok(Number.isFinite(Date.parse(r.json.at)));
  assert.equal((await request(port, 'POST', '/api/health')).status, 405);
});

test('GET /api/flow describes participants, phases, 20 steps, mistakes and honest provenance', async () => {
  const r = await request(port, 'GET', '/api/flow');
  assert.equal(r.status, 200);
  assert.equal(r.json.mode, 'mock');
  assert.equal(r.json.steps.length, 20);
  assert.equal(r.json.participants.length, 8);
  assert.deepEqual(r.json.phases.map((p) => p.id), ['catalog', 'experience', 'discovery', 'authn', 'redemption', 'obo']);
  assert.ok(r.json.participants.every((p) => p.details.length > 20));
  assert.deepEqual(r.json.mistakes.map((m) => m.id), MISTAKES.map((m) => m.id));
  assert.ok(r.json.mistakes.every((m) => m.expected.error && m.standard && m.why));
  assert.match(r.json.provenance.unverifiedLabel, /UNVERIFIED against product documentation/);
  assert.ok(r.json.provenance.unverified.length >= 3);
  assert.equal(r.json.provenance.standIn, PROVENANCE.standIn);
  assert.ok(r.json.standards.every((s) => /^RFC \d+$/.test(s.rfc)));
  assert.equal((await request(port, 'POST', '/api/flow', { body: {} })).status, 405);
});

test('POST /api/runs runs the happy path; GET /api/runs/:id and GET /api/runs return it', async () => {
  await request(port, 'POST', '/api/reset');
  const r = await request(port, 'POST', '/api/runs', { body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'completed');
  assert.equal(r.json.steps.length, 20);
  assert.equal(r.json.id, 'run-0001');
  const g = await request(port, 'GET', '/api/runs/run-0001');
  assert.equal(g.status, 200);
  assert.deepEqual(g.json, r.json);
  const list = await request(port, 'GET', '/api/runs');
  assert.deepEqual(list.json.runs, [{ id: 'run-0001', mistake: null, status: 'completed', refusal: null }]);
  assert.equal((await request(port, 'POST', '/api/runs')).json.id, 'run-0002', 'a bodyless POST is a happy-path run');
  assert.equal((await request(port, 'POST', '/api/runs', { body: { mistake: null } })).status, 200);
});

test('POST /api/runs with a mistake returns the refusal', async () => {
  const r = await request(port, 'POST', '/api/runs', { body: { mistake: 'wrong_verifier' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'refused');
  assert.deepEqual({ step: r.json.refusal.step, actor: r.json.refusal.actor, error: r.json.refusal.error }, { step: 14, actor: 'pf', error: 'invalid_grant' });
  assert.equal(r.json.interlockHeld, true);
  const list = await request(port, 'GET', '/api/runs');
  assert.equal(list.json.runs.at(-1).mistake, 'wrong_verifier');
});

test('the run endpoint takes only { mistake }: no token, URL, host or credential field is accepted', async () => {
  for (const body of [{ token: 'x' }, { url: 'http://evil.example' }, { upstream: `http://${['169', '254', '169', '254'].join('.')}` }, { authorization: 'Bearer x' }, { mistake: 'wrong_verifier', verifier: 'x' }, { client_id: 'x' }]) {
    assert.equal((await request(port, 'POST', '/api/runs', { body })).status, 400, JSON.stringify(body));
  }
  for (const mistake of ['nope', 5, [], {}, true, '__proto__', 'wrong_verifier ', '']) {
    assert.equal((await request(port, 'POST', '/api/runs', { body: { mistake } })).status, 400, JSON.stringify(mistake));
  }
  assert.equal((await request(port, 'POST', '/api/runs', { body: '[]' })).status, 400);
  assert.equal((await request(port, 'POST', '/api/runs', { body: '{bad' })).status, 400);
  assert.equal((await request(port, 'POST', '/api/runs', { body: { mistake: 'x'.repeat(5000) } })).status, 413);
  for (const p of ['/api/runs/nope', '/api/runs/run-1', '/api/runs/../health', '/api/runs/run-0001%2f..']) assert.ok([400, 404].includes((await request(port, 'GET', p)).status), p);
  assert.equal((await request(port, 'GET', '/api/runs/run-9999')).status, 404);
});

test('POST /api/reset clears runs and keeps the ids counting; it takes no parameters', async () => {
  const before = (await request(port, 'POST', '/api/runs', { body: {} })).json.id;
  assert.equal((await request(port, 'POST', '/api/reset', { body: { x: 1 } })).status, 400);
  const r = await request(port, 'POST', '/api/reset');
  assert.deepEqual(r.json, { ok: true, mode: 'mock' });
  assert.deepEqual((await request(port, 'GET', '/api/runs')).json.runs, []);
  assert.equal(Number((await request(port, 'POST', '/api/runs', { body: {} })).json.id.slice(4)), Number(before.slice(4)) + 1);
  assert.equal((await request(port, 'GET', '/api/reset')).status, 405);
  assert.equal((await request(port, 'DELETE', '/api/runs')).status, 405);
});

test('responses are JSON with a locked-down header set, unknown routes are JSON 404, and a run never contains the gateway secret or user password', async () => {
  const r = await request(port, 'GET', '/api/flow');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-security-policy'], "default-src 'none'");
  assert.equal(r.headers['x-powered-by'], undefined);
  for (const p of ['/', '/index.html', '/api/nope', '/etc/passwd']) { const x = await request(port, 'GET', p); assert.equal(x.status, 404, p); assert.equal(x.json.error, 'not_found'); }
  const run = await request(port, 'POST', '/api/runs', { body: {} });
  assert.ok(!run.raw.includes('mock-not-a-secret'));
  assert.ok(!/Basic [A-Za-z0-9+/=]{6,}/.test(run.raw.replaceAll('Basic [REDACTED]', '')));
});

test('a 500 never leaks the error message or stack; a full queue is a 429 with Retry-After', async (t) => {
  const boom = { mode: 'mock', run: async () => { throw new Error('secret internals /Users/someone/path'); }, listRuns: () => [], getRun: () => null, reset() {} };
  const h = createHealth();
  const app = createApp({ runtime: boom, health: h });
  const srv = app.listen(0, '127.0.0.1'); // ephemeral loopback, fake runtime: no actors involved
  await new Promise((r) => srv.once('listening', r));
  t.after(async () => { h.stop(); await close(srv); });
  const r = await request(srv.address().port, 'POST', '/api/runs', { body: {} });
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'server_error' });
  assert.ok(!r.raw.includes('secret internals') && !r.raw.includes('/Users'));
  boom.run = async () => { throw Object.assign(new Error('full'), { code: 'run_queue_full' }); };
  const q = await request(srv.address().port, 'POST', '/api/runs', { body: {} });
  assert.equal(q.status, 429);
  assert.equal(q.headers['retry-after'], '2');
  assert.equal(q.json.error, 'run_queue_full');
});

test('run ids are validated before lookup: a malformed id is 400, a well-formed unknown id is 404', async () => {
  for (const id of ['abc', 'run-1', 'run-12', 'run-0001x', 'xrun-0001', 'run-0001%0A', '..%2f']) assert.equal((await request(port, 'GET', `/api/runs/${id}`)).status, 400, id);
  assert.equal((await request(port, 'GET', '/api/runs/run-9999999')).status, 404);
  assert.equal((await request(port, 'GET', '/api/runs/run-0000')).status, 404);
});

test('the outer error handler never leaks a message or stack, and maps a malformed URL to 400', () => {
  const run = (err) => { const out = {}; outerErrorHandler(err, {}, { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }, () => {}); return out; };
  const boom = run(Object.assign(new Error('secret detail at /Users/x/file.js'), { stack: 'Error: secret detail\n    at /Users/x/file.js:1:1' }));
  assert.equal(boom.status, 500);
  assert.deepEqual(boom.body, { error: 'server_error' });
  assert.equal(run(new URIError('bad')).status, 400);
  assert.equal(run(Object.assign(new Error('x'), { status: 400 })).status, 400);
});

test('GET /api/flow carries the customer config (brand, vertical, workspace) and nothing else from it', async () => {
  const r = await request(port, 'GET', '/api/flow');
  assert.deepEqual(r.json.config, { brand: 'Example Corp', vertical: 'default', workspace: 'default' });
});

// ---------------------------------------------------------------- Mock | Live
test('GET /api/mode is mock, says Live is not supported and why', async () => {
  const r = await request(port, 'GET', '/api/mode');
  assert.equal(r.status, 200);
  assert.equal(r.json.mode, 'mock');
  assert.equal(r.json.live.supported, false);
  assert.match(r.json.live.message, /Live mode is not available/);
  assert.match(r.json.live.message, /no real provider/);
});

test('POST /api/mode: mock is accepted; live is refused with 409 and an honest message and the mode does not change', async () => {
  const mock = await request(port, 'POST', '/api/mode', { body: { mode: 'mock' } });
  assert.equal(mock.status, 200);
  assert.equal(mock.json.mode, 'mock');
  const live = await request(port, 'POST', '/api/mode', { body: { mode: 'live' } });
  assert.equal(live.status, 409);
  assert.equal(live.json.error, 'live_not_supported');
  assert.equal(live.json.mode, 'mock');
  assert.match(live.json.message, /stays in Mock mode/);
  assert.equal((await request(port, 'GET', '/api/mode')).json.mode, 'mock');
  assert.equal((await request(port, 'GET', '/api/flow')).json.mode, 'mock');
});

test('POST /api/mode refuses anything else: other values, extra fields, no body, wrong method', async () => {
  for (const body of [{ mode: 'demo' }, { mode: 1 }, { mode: null }, { mode: ['live'] }, {}, { mode: 'mock', extra: 1 }, { mode: 'live', token: 'x' }, []]) {
    const r = await request(port, 'POST', '/api/mode', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, 'bad_request');
  }
  assert.equal((await request(port, 'POST', '/api/mode')).status, 400);
  assert.equal((await request(port, 'PUT', '/api/mode', { body: { mode: 'mock' } })).status, 405);
  assert.equal((await request(port, 'POST', '/api/mode', { body: { mode: 'live' }, headers: { origin: 'https://evil.example' } })).status, 403);
});

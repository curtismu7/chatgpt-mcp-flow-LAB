// The real flow against the mock actors on loopback: the happy path, every mistake toggle, run store, queue, reset, netguard.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, MAX_PENDING, MAX_RUNS } from '../src/runtime.js';
import { createClock } from '../src/clock.js';
import { runFlow } from '../src/flow.js';
import { presentValue } from '../src/present.js';
import { CLIENT_ID, MISTAKES, ORIGINS, REDIRECT_URI, STEPS } from '../src/definition.js';
import { challengeS256 } from '../src/pkce.js';
import { verifySignature } from '../src/jwt.js';
import { installNetguard } from '../src/netguard.js';
import { freeBase } from './helpers.js';

let rt; let guard;
before(async () => {
  guard = installNetguard(); // the product's own guard, installed before the runtime so the wire's fetch is the guarded one
  rt = await createRuntime({ stubBase: await freeBase('flow', 5) });
});
after(async () => { guard.restore(); await rt.close(); });

const step = (run, n) => run.steps.find((s) => s.n === n);
const body = (run, n, i = 0) => step(run, n).exchanges[i];

test('happy path: all 20 messages complete in order with the phases of the definition', async () => {
  await rt.reset();
  const run = await rt.run();
  assert.equal(run.status, 'completed');
  assert.equal(run.refusal, null);
  assert.equal(run.mode, 'mock');
  assert.equal(run.steps.length, 20);
  run.steps.forEach((s, i) => { assert.equal(s.n, i + 1); assert.equal(s.status, 'ok'); assert.equal(s.phase, STEPS[i].phase); assert.equal(s.from, STEPS[i].from); assert.equal(s.to, STEPS[i].to); });
  assert.equal(step(run, 20).data.assistant_says, 'widget-100 costs 12.50 USD');
  assert.equal(run.id, 'run-0001');
});

test('discovery is real: 401 with resource_metadata, protected-resource metadata, authorization-server metadata', () => {
  const run = rt.getRun('run-0001');
  const r2 = body(run, 6).response;
  assert.equal(r2.status, 401);
  assert.equal(r2.headers['www-authenticate'], `Bearer scope="items.read", resource_metadata="${ORIGINS.gateway}/.well-known/oauth-protected-resource"`);
  assert.deepEqual(body(run, 7).response.body.authorization_servers, [ORIGINS.as]);
  const m = body(run, 8).response.body;
  assert.equal(m.issuer, ORIGINS.as);
  assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
  assert.equal(m.authorization_response_iss_parameter_supported, true);
});

test('PKCE interlock is real: the step 9 challenge is S256 of the verifier that step 14 sends in plaintext', () => {
  const run = rt.getRun('run-0001');
  const q = body(run, 9).request.url;
  const challenge = new URL(q).searchParams.get('code_challenge');
  const verifier = body(run, 14).request.body.code_verifier;
  assert.equal(new URL(q).searchParams.get('code_challenge_method'), 'S256');
  assert.equal(challengeS256(verifier), challenge);
  assert.notEqual(verifier, challenge);
  assert.equal(new URL(q).searchParams.get('resource'), ORIGINS.gateway);
  assert.ok(step(run, 14).checks.some((c) => /^PKCE/.test(c.name) && c.ok));
});

test('state and iss are real: the code response carries the client state and the issuer from the metadata (RFC 9207)', () => {
  const run = rt.getRun('run-0001');
  const state = new URL(body(run, 9).request.url).searchParams.get('state');
  const loc = new URL(body(run, 13).response.headers.location);
  assert.equal(loc.origin + loc.pathname, 'https://client.example/oauth/callback');
  assert.equal(loc.searchParams.get('state'), state);
  assert.equal(loc.searchParams.get('iss'), ORIGINS.as);
  assert.equal(step(run, 13).data.iss, ORIGINS.as);
});

test('the IdP step is authentication only and the user secrets never appear in the output', () => {
  const run = rt.getRun('run-0001');
  const req = body(run, 11).request;
  assert.equal(req.body.password, '[REDACTED]');
  assert.equal(req.body.otp, '[REDACTED]');
  const idToken = step(run, 12).tokens[0];
  assert.match(idToken.label, /MOCK-ISSUED/);
  assert.equal(idToken.claims.iss, ORIGINS.idp);
  assert.deepEqual(idToken.claims.amr, ['pwd', 'otp']);
  assert.equal(idToken.claims.scope, undefined, 'the ID token makes no authorization decision');
  assert.ok(step(run, 12).checks.some((c) => c.name === 'ID token nonce' && c.ok));
  const all = JSON.stringify(run);
  assert.ok(!all.includes('mock-not-a-secret'));
  assert.ok(!/Basic [A-Za-z0-9+/=]{6,}/.test(all.replace('Basic [REDACTED]', '')), 'the gateway client credentials are redacted');
  assert.ok(all.includes('Basic [REDACTED]'));
});

test('the access token is really signed and bound: aud = gateway, narrow scope, short TTL; the signature verifies with the AS key', () => {
  const run = rt.getRun('run-0001');
  const t = step(run, 15).tokens[0];
  assert.match(t.label, /MOCK-ISSUED/);
  assert.equal(verifySignature(t.jwt, rt.actors.pf.jwks).ok, true);
  assert.equal(verifySignature(t.jwt, { keys: [] }).ok, false);
  assert.equal(t.header.alg, 'ES256');
  assert.equal(t.header.typ, 'at+jwt');
  assert.equal(t.claims.iss, ORIGINS.as);
  assert.equal(t.claims.aud, ORIGINS.gateway);
  assert.deepEqual(t.scopes, ['items.read']);
  assert.equal(t.claims.exp - t.claims.iat, 300);
  assert.equal(t.claims.sub, 'user-1');
  const resp = body(run, 14).response.body;
  assert.equal(resp.token_type, 'Bearer');
  assert.equal(resp.access_token, t.jwt);
});

test('RFC 8693 exchange is real: act = the gateway identity, new audience, narrowed scope, shorter TTL, same subject', () => {
  const run = rt.getRun('run-0001');
  const access = step(run, 15).tokens[0];
  const ex = body(run, 17);
  assert.equal(ex.from, 'gateway');
  assert.equal(ex.to, 'pf');
  assert.equal(ex.request.body.grant_type, 'urn:ietf:params:oauth:grant-type:token-exchange');
  assert.equal(ex.request.body.subject_token, access.jwt);
  const obo = step(run, 17).tokens[0];
  assert.equal(verifySignature(obo.jwt, rt.actors.pf.jwks).ok, true);
  assert.equal(obo.claims.aud, ORIGINS.private);
  assert.deepEqual(obo.claims.act, { sub: 'gateway-nhi' });
  assert.equal(obo.claims.sub, access.claims.sub);
  assert.deepEqual(obo.scopes, ['items.read']);
  assert.equal(obo.claims.exp - obo.claims.iat, 60);
  assert.notEqual(obo.jwt, access.jwt);
  assert.ok(step(run, 17).checks.some((c) => /narrowed/.test(c.name) && c.ok));
});

test('the gateway and the private server both validate: the checks are reported per actor', () => {
  const run = rt.getRun('run-0001');
  const names = (n, actor) => step(run, n).checks.filter((c) => c.actor === actor).map((c) => c.name);
  for (const n of ['signature (ES256)', 'iss', 'aud', 'exp', 'scope']) assert.ok(names(16, 'gateway').includes(n), `gateway ${n}`);
  for (const n of ['signature (ES256)', 'iss', 'aud', 'exp', 'scope', 'act']) assert.ok(names(18, 'private').includes(n), `private ${n}`);
  assert.ok([...step(run, 16).checks, ...step(run, 18).checks].every((c) => c.ok));
});

test('every mistake toggle is refused by the right actor with the right error, and the run stops there', async () => {
  for (const m of MISTAKES) {
    await rt.reset();
    const run = await rt.run(m.id);
    const label = m.id;
    assert.equal(run.status, 'refused', label);
    assert.equal(run.interlockHeld, true, label);
    assert.equal(run.refusal.step, m.expected.step, label);
    assert.equal(run.refusal.actor, m.expected.actor, label);
    assert.equal(run.refusal.error, m.expected.error, label);
    assert.equal(run.mistake.id, m.id);
    assert.equal(run.steps.at(-1).n, m.expected.step, `${label}: nothing runs after the refusal`);
    assert.equal(run.steps.at(-1).status, 'refused', label);
    assert.ok(run.refusal.description.length > 0 || m.id === 'passthrough', label);
    assert.equal(run.stepsPlanned, 20);
  }
});

test('mistake details: the actual refusing check is visible', async () => {
  const check = async (id, step_, actor, name) => {
    await rt.reset();
    const run = await rt.run(id);
    const bad = step(run, step_).checks.find((c) => !c.ok);
    assert.ok(bad, `${id} has a failing check`);
    assert.equal(bad.actor, actor, id);
    assert.match(bad.name, name, id);
  };
  await check('wrong_verifier', 14, 'pf', /^PKCE/);
  await check('replayed_code', 14, 'pf', /single use/);
  await check('bad_redirect', 9, 'pf', /redirect_uri exact/);
  await check('missing_resource', 9, 'pf', /resource/);
  await check('wrong_audience', 16, 'gateway', /^aud/);
  await check('expired_token', 16, 'gateway', /^exp/);
  await check('wrong_scope', 16, 'gateway', /^scope/);
  await check('missing_iss', 13, 'client', /iss is present/);
  await check('forged_iss', 13, 'client', /iss equals/);
  await check('wrong_state', 13, 'client', /^state/);
  await check('passthrough', 18, 'private', /^aud/);
  await rt.reset();
  const replay = await rt.run('replayed_code');
  assert.equal(body(replay, 14, 0).response.status, 200, 'the first redemption succeeded');
  assert.equal(replay.steps.at(-1).exchanges.length, 2);
  const bad = await rt.run('bad_redirect');
  assert.equal(body(bad, 9).response.headers.location, undefined, 'an unregistered redirect URI is never redirected to');
  const skipped = await rt.run('passthrough');
  assert.equal(step(skipped, 17).status, 'skipped');
});

test('a mistake leaves nothing behind: the next honest run completes, and the clock is back to real time', async () => {
  const before_ = Math.abs(Date.now() / 1000 - (await rt.run()).steps[14].tokens[0].claims.iat);
  assert.ok(before_ < 120);
  await rt.run('expired_token');
  await rt.run('forged_iss');
  const run = await rt.run();
  assert.equal(run.status, 'completed');
  assert.ok(Math.abs(Date.now() / 1000 - run.steps[14].tokens[0].claims.iat) < 120, 'expired_token advanced a clock that was restored');
});

test('run store: ids, listing, cap, unknown mistake, reset', async () => {
  await rt.reset();
  assert.deepEqual(rt.listRuns(), []);
  await assert.rejects(rt.run('nope'), { code: 'unknown_mistake' });
  for (let i = 0; i < MAX_RUNS + 2; i += 1) await rt.run();
  const list = rt.listRuns();
  assert.equal(list.length, MAX_RUNS);
  const n = (r) => Number(r.id.slice(4));
  assert.equal(n(list.at(-1)) - n(list[0]), MAX_RUNS - 1, 'ids are consecutive');
  assert.equal(rt.getRun(`run-${String(n(list[0]) - 1).padStart(4, '0')}`), null, 'the oldest run was dropped');
  assert.ok(rt.getRun(list.at(-1).id));
  const lastId = list.at(-1).id;
  await rt.reset();
  assert.deepEqual(rt.listRuns(), []);
  const next = (await rt.run()).id;
  assert.equal(Number(next.slice(4)), Number(lastId.slice(4)) + 1, 'run ids keep counting: a stale id never resolves to another run');
  assert.equal(rt.getRun(lastId), null);
});

test('the run queue is capped: a third request while one runs and one waits is refused', async () => {
  await rt.reset();
  const a = rt.run(); const b = rt.run();
  await assert.rejects(rt.run(), { code: 'run_queue_full' });
  assert.equal((await a).status, 'completed');
  assert.equal((await b).status, 'completed');
  assert.equal((await rt.run()).status, 'completed', 'the queue drains');
});

test('actor ports must stay inside 6650-6699', async () => {
  await assert.rejects(createRuntime({ stubBase: 6700 }), /outside 6650-6699 or blocked/);
  await assert.rejects(createRuntime({ stubBase: 6697 }), /outside 6650-6699 or blocked/);
  await assert.rejects(createRuntime({ stubBase: 8080 }), /outside 6650-6699 or blocked/);
  await assert.rejects(createRuntime({ stubBase: 6640 }), /outside 6650-6699 or blocked/);
  await assert.rejects(createRuntime({ stubBase: 6694 }), /blocked/, '6697 is refused by fetch');
  await assert.rejects(createRuntime({ stubBase: 6662 }), /blocked/, '6665-6669 are refused by fetch');
});

test('netguard: the wire refuses an unknown origin and the whole suite made zero non-loopback attempts', async () => {
  await assert.rejects(rt.wire.call({ from: 'client', to: 'gateway', url: 'https://evil.example/x' }), { code: 'bad_target' });
  await assert.rejects(rt.wire.call({ from: 'client', to: 'gateway', url: `http://${['169', '254', '169', '254'].join('.')}/latest` }), { code: 'bad_target' });
  await assert.rejects(rt.wire.call({ from: 'client', to: 'gateway', url: 'https://client.example/oauth/callback' }), { code: 'bad_target' });
  assert.deepEqual(guard.attempts, []);
});

// ---------------------------------------------------------------- MF2 pins
test('the run store cap is 20 and the pending cap is 2', () => {
  assert.equal(MAX_RUNS, 20);
  assert.equal(MAX_PENDING, 2);
});

test('reset during a run waits for it: the run finishes untouched, and its own state survives the reset', async () => {
  await rt.reset();
  const running = rt.run(null);
  const resets = [rt.reset(), rt.reset(), rt.reset()];
  const run = await running;
  assert.equal(run.status, 'completed', 'a reset must never turn an honest run into a refusal');
  assert.equal(run.refusal, null);
  await Promise.all(resets);
  assert.deepEqual(rt.listRuns(), [], 'the reset ran after the run, so the store is empty');
  assert.equal((await rt.run()).status, 'completed');
});

test('a reset is queued behind the run, not run in the middle of it (the order is observable)', async () => {
  await rt.reset();
  const order = [];
  const a = rt.run(null).then(() => order.push('run'));
  const b = rt.reset().then(() => order.push('reset'));
  await Promise.all([a, b]);
  assert.deepEqual(order, ['run', 'reset']);
});

test('an unknown mistake is refused by the runtime itself (not only by the API enum)', async () => {
  await assert.rejects(rt.run('__nope'), { code: 'unknown_mistake' });
  await assert.rejects(rt.run(''), { code: 'unknown_mistake' });
});

test('every HTTP hop carries a W3C traceparent, one trace id per run, a new span id per hop', async () => {
  await rt.reset();
  const run = await rt.run();
  const tps = run.steps.flatMap((s) => s.exchanges.map((e) => e.request.headers.traceparent));
  assert.ok(tps.length >= 10);
  for (const tp of tps) assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.equal(new Set(tps.map((t) => t.split('-')[1])).size, 1, 'one trace per run');
  assert.equal(new Set(tps.map((t) => t.split('-')[2])).size, tps.length, 'a new span per hop');
  const second = await rt.run();
  assert.notEqual(second.steps[5].exchanges[0].request.headers.traceparent.split('-')[1], tps[0].split('-')[1], 'a new run is a new trace');
});

test('the wire form keeps the tool arguments (they are not cut off by the depth caps)', async () => {
  const run = await rt.run();
  assert.deepEqual(run.steps[5].exchanges[0].request.body.params.arguments, { item: 'widget-100' });
  assert.deepEqual(run.steps[15].exchanges[0].request.body.params.arguments, { item: 'widget-100' });
});

test('hidden characters in a run come out as [U+XXXX] (inert text is applied when the run is stored)', async () => {
  const run = await rt.run();
  const lying = { ...rt.wire, call: async (o) => { const r = await rt.wire.call(o); if (/oauth-protected-resource/.test(o.url)) r.body.scopes_supported = ['a‮b​']; return r; } };
  const out = await runFlow({ wire: lying, clock: createClock(), pf: rt.actors.pf, gateway: rt.actors.gateway, catalog: rt.actors.catalog });
  assert.ok(out.steps.length > 0 && run.status);
  const stored = presentValue(out);
  assert.match(JSON.stringify(stored), /a\[U\+202E\]b\[U\+200B\]/);
  assert.ok(!JSON.stringify(stored).includes('‮'));
});

// Fault injection on the client side: a wire that lies about one answer, to prove the client's own checks refuse it.
async function liar(match, mutate, mistake = null) {
  const lying = { ...rt.wire, call: async (o) => { const r = await rt.wire.call(o); if (match(o)) mutate(r, o); return r; } };
  await rt.reset();
  return runFlow({ wire: lying, clock: createClock(), pf: rt.actors.pf, gateway: rt.actors.gateway, catalog: rt.actors.catalog, mistake });
}

test('client check: protected-resource metadata whose resource is not the server that was called is refused (RFC 9728)', async () => {
  const run = await liar((o) => /oauth-protected-resource/.test(o.url), (r) => { r.body.resource = 'https://other-resource.example'; });
  assert.equal(run.status, 'refused');
  assert.deepEqual([run.refusal.step, run.refusal.actor, run.refusal.error], [7, 'client', 'resource_mismatch']);
});

test('client check: authorization-server metadata whose issuer is not the server that was asked is refused (RFC 8414)', async () => {
  const run = await liar((o) => /oauth-authorization-server/.test(o.url), (r) => { r.body.issuer = 'https://other-as.example'; });
  assert.deepEqual([run.refusal.step, run.refusal.actor, run.refusal.error], [8, 'client', 'issuer_mismatch']);
});

test('client check: authorization-server metadata that does not offer S256 is refused (RFC 7636)', async () => {
  const run = await liar((o) => /oauth-authorization-server/.test(o.url), (r) => { r.body.code_challenge_methods_supported = ['plain']; });
  assert.deepEqual([run.refusal.step, run.refusal.actor, run.refusal.error], [8, 'client', 'pkce_unsupported']);
  const none = await liar((o) => /oauth-authorization-server/.test(o.url), (r) => { delete r.body.code_challenge_methods_supported; });
  assert.equal(none.refusal.error, 'pkce_unsupported');
});

test('client check: an authorization response sent to a different redirect target is not followed (RFC 9207 / 6749)', async () => {
  const run = await liar((o) => /\/as\/consent$/.test(o.url), (r) => {
    const u = new URL(r.headers.location); r.headers.location = `https://attacker.invalid/cb${u.search}`;
  });
  assert.deepEqual([run.refusal.step, run.refusal.actor, run.refusal.error], [13, 'client', 'redirect_mismatch']);
  assert.ok(run.steps.find((s) => s.n === 13).checks.some((c) => c.name.startsWith('redirect target') && !c.ok));
});

test('interlockHeld is true only when the refusal is at the expected step, actor and error', async () => {
  await rt.reset();
  const held = await rt.run('wrong_verifier');
  assert.equal(held.interlockHeld, true);
  assert.equal((await rt.run()).interlockHeld, null, 'no mistake chosen: nothing to hold');

  // The mistake is chosen, but the run is refused somewhere else: the verdict must say it did not hold.
  const elsewhere = await liar((o) => /oauth-protected-resource/.test(o.url), (r) => { r.body.resource = 'https://other-resource.example'; }, 'wrong_verifier');
  assert.equal(elsewhere.status, 'refused');
  assert.equal(elsewhere.interlockHeld, false, 'refused at step 7, the mistake expected step 14');

  // Each of the three parts of the expectation is checked on its own.
  const m = MISTAKES.find((x) => x.id === 'wrong_verifier');
  const saved = { ...m.expected };
  try {
    for (const [field, other] of [['step', 15], ['actor', 'gateway'], ['error', 'something_else']]) {
      m.expected[field] = other;
      assert.equal((await rt.run('wrong_verifier')).interlockHeld, false, `expected ${field} differs`);
      Object.assign(m.expected, saved);
    }
  } finally { Object.assign(m.expected, saved); }
  assert.equal((await rt.run('wrong_verifier')).interlockHeld, true);
});

test('reset also resets every actor: leftover transactions and fault switches are gone', async () => {
  rt.actors.pf.faults.iss = 'omit';
  rt.actors.gateway.faults.passthrough = true;
  const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'items.read', state: 's', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256', resource: ORIGINS.gateway });
  await rt.wire.call({ from: 'client', to: 'pf', url: `${ORIGINS.as}/as/authorization.oauth2?${q}` });
  assert.equal(rt.actors.pf.sizes().txns, 1, 'a transaction is left behind');
  await rt.reset();
  assert.deepEqual(rt.actors.pf.faults, {});
  assert.deepEqual(rt.actors.gateway.faults, {});
  assert.deepEqual(rt.actors.pf.sizes(), { txns: 0, consents: 0, codes: 0 });
  assert.equal((await rt.run()).status, 'completed');
});

test('two runs started together are serialised: neither sees the other (the wire and actor state are shared)', async () => {
  await rt.reset();
  const solo = await rt.run('wrong_verifier');
  const soloShape = solo.steps.map((s) => [s.n, s.status, s.exchanges.length]);
  const [a, b, c] = await Promise.all([rt.run('wrong_verifier'), rt.run(null), rt.run('wrong_verifier').catch((e) => e)]);
  assert.equal(c.code, 'run_queue_full', 'the third is refused while two are accepted');
  assert.deepEqual(a.steps.map((s) => [s.n, s.status, s.exchanges.length]), soloShape);
  assert.equal(a.interlockHeld, true);
  assert.equal(b.status, 'completed');
  assert.deepEqual(b.steps.map((s) => s.exchanges.length), (await rt.run()).steps.map((s) => s.exchanges.length));
});

test('every hop carries the workspace in tracestate (default workspace here)', async () => {
  await rt.reset();
  const run = await rt.run();
  assert.equal(rt.workspace, 'default');
  for (const e of run.steps.flatMap((s) => s.exchanges)) assert.equal(e.request.headers.tracestate, 'mcpflow=default');
});

// ---------------------------------------------------------------- catalog phase
test('the catalog phase is real mock HTTP: publish, review (organisational), add for free, appear not signed in', async () => {
  await rt.reset();
  const run = await rt.run();
  assert.deepEqual(run.steps.slice(0, 4).map((s) => s.phase), ['catalog', 'catalog', 'catalog', 'catalog']);
  const pub = body(run, 1);
  assert.deepEqual([pub.from, pub.to, pub.request.method, pub.response.status], ['publisher', 'catalog', 'POST', 202]);
  assert.equal(pub.request.body.mcp_server_url, `${ORIGINS.gateway}/mcp`);
  assert.equal(pub.response.body.state, 'in review');
  assert.equal(step(run, 2).organisational, true);
  assert.match(step(run, 2).note, /Organisational step/);
  assert.equal(step(run, 2).data.state, 'listed');
  assert.match(step(run, 2).data.review, /UNVERIFIED/);
  const add = body(run, 3);
  assert.equal(add.response.status, 201);
  assert.equal(add.response.body.cost_to_member, 'none');
  assert.match(add.response.body.install, /nothing/);
  const seen = step(run, 4).data;
  assert.equal(seen.state, 'added, not signed in');
  assert.equal(body(run, 4).from, 'client');
});

test('the first 401 comes from the address in the catalog record, and the record moves to sign-in required, then connected', async () => {
  await rt.reset();
  const run = await rt.run();
  assert.equal(body(run, 6).request.url, step(run, 4).data.mcp_server_url);
  assert.equal(body(run, 6).response.status, 401);
  assert.equal(step(run, 6).data.connector_state, 'sign-in required (first use)');
  assert.equal(step(run, 15).data.connector_state, 'connected');
  assert.equal(step(run, 4).exchanges.length, 1);
  assert.ok(!step(run, 4).data.state.includes('connected'), 'not signed in at the moment it appears');
});

test('unlisted_connector: the member cannot add a connector that was never listed; no 401 or sign-in follows', async () => {
  await rt.reset();
  const run = await rt.run('unlisted_connector');
  assert.deepEqual([run.refusal.step, run.refusal.actor, run.refusal.error], [3, 'catalog', 'connector_not_listed']);
  assert.equal(run.interlockHeld, true);
  assert.equal(step(run, 2).data.state, 'in review');
  assert.equal(body(run, 3).response.status, 409);
  assert.ok(step(run, 3).checks.some((c) => c.name === 'connector is listed' && !c.ok));
  assert.equal(run.steps.length, 3);
  const after_ = await rt.run();
  assert.equal(after_.status, 'completed', 'the hold does not leak into the next run');
});

test('catalog endpoints reject hostile input and keep per-member state apart', async () => {
  await rt.reset();
  const post = (url, json) => rt.wire.call({ from: 'publisher', to: 'catalog', method: 'POST', url: `${ORIGINS.catalog}${url}`, json });
  assert.equal((await post('/connectors', { name: 'x' })).status, 400);
  assert.equal((await post('/connectors', { name: 'x', publisher: 'p', mcp_server_url: 'http://plain.example/mcp', tools: ['t'] })).status, 400, 'https only');
  assert.equal((await post('/members/Bad%20Id/connectors', { connector_id: 'conn-0001' })).status, 400);
  assert.equal((await post('/members/member-1/connectors', { connector_id: '../x' })).status, 404);
  assert.equal((await rt.wire.call({ from: 'client', to: 'catalog', url: `${ORIGINS.catalog}/connectors/nope` })).status, 404);
  const ok = await post('/connectors', { name: 'x', publisher: 'p', mcp_server_url: `${ORIGINS.gateway}/mcp`, tools: ['t'] });
  assert.equal(ok.status, 202);
  rt.actors.catalog.review(ok.body.id);
  assert.equal((await post('/members/member-1/connectors', { connector_id: ok.body.id })).status, 201);
  const other = await rt.wire.call({ from: 'client', to: 'catalog', url: `${ORIGINS.catalog}/members/member-2/connectors` });
  assert.deepEqual(other.body.connectors, [], 'another member sees nothing');
});

test('reset also resets the catalog: connectors, additions and the hold switch are gone', async () => {
  rt.actors.catalog.faults.hold = true;
  await rt.run('unlisted_connector');
  await rt.reset();
  assert.deepEqual(rt.actors.catalog.faults, {});
  assert.equal(rt.actors.catalog.stateOf('member-1', 'conn-0001'), null);
});

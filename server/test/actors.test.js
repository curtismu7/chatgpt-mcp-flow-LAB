// Each mock actor, driven directly over HTTP with keys and secrets the test owns. Every refusal here is a pin:
// remove the check in the actor and the matching test fails.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/clock.js';
import { CLIENT_ID, ORIGINS, PF_RP_CLIENT_ID, REDIRECT_URI } from '../src/definition.js';
import { b64u, createKeyPair, signJwt, parseJwt } from '../src/jwt.js';
import { challengeS256, newVerifier } from '../src/pkce.js';
import { createWire } from '../src/wire.js';
import { createAuthServer } from '../src/actors/authserver.js';
import { listenActor } from '../src/actors/base.js';
import { createGateway } from '../src/actors/gateway.js';
import { createIdp, IDP_CALLBACK, MOCK_USER } from '../src/actors/idp.js';
import { createPrivateServer } from '../src/actors/private.js';
import { freeBase, request } from './helpers.js';

const SECRET = ['test', 'only', 'secret', 'value'].join('-');
let env; let ports;
const clock = createClock();

before(async () => {
  const base = await freeBase('actors', 5);
  ports = { idp: base, pf: base + 1, gateway: base + 2, private: base + 3 };
  const routes = new Map([[ORIGINS.idp, ports.idp], [ORIGINS.as, ports.pf], [ORIGINS.gateway, ports.gateway], [ORIGINS.private, ports.private]]);
  const wire = createWire({ routes });
  const asKey = createKeyPair('as-key-1'); const idpKey = createKeyPair('idp-key-1');
  const asJwks = { keys: [asKey.publicJwk] }; const idpJwks = { keys: [idpKey.publicJwk] };
  const idp = createIdp({ keyPair: idpKey, clock, wire });
  const pf = createAuthServer({ keyPair: asKey, idpJwks, clock, wire, gatewaySecret: SECRET });
  const gateway = createGateway({ asJwks, clock, wire, gatewaySecret: SECRET });
  const priv = createPrivateServer({ asJwks, clock, wire });
  const listeners = [await listenActor(idp.app, ports.idp), await listenActor(pf.app, ports.pf), await listenActor(gateway.app, ports.gateway), await listenActor(priv.app, ports.private)];
  env = { wire, asKey, idpKey, idp, pf, gateway, priv, listeners };
});
after(async () => { await Promise.all(env.listeners.map((l) => l.close())); });

const now = () => clock.nowSec();
const mint = (over = {}, { key = env.asKey, header = {} } = {}) => signJwt({ alg: 'ES256', typ: 'at+jwt', kid: key.kid, ...header }, { iss: ORIGINS.as, sub: 'user-1', aud: ORIGINS.gateway, scope: 'items.read', client_id: CLIENT_ID, iat: now(), exp: now() + 300, jti: 'j', ...over }, key.privateKey);
const form = (o) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const basic = (id = 'gateway-nhi', secret = SECRET) => ({ authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` });
const rpcBody = (item = 'widget-100', name = 'price-lookup') => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { item } } });
const bearer = (t) => ({ authorization: `Bearer ${t}` });

// ---------------------------------------------------------------- authorization endpoint
const authQuery = (over = {}) => ({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'items.read', state: 'st-1', code_challenge: challengeS256(newVerifier()), code_challenge_method: 'S256', resource: ORIGINS.gateway, ...over });
const authorize = (over, drop = []) => { const q = authQuery(over); for (const k of drop) delete q[k]; return request(ports.pf, 'GET', `/as/authorization.oauth2?${form(q)}`); };

test('redirect URI allow-list is an exact match: prefixes, suffixes, case, queries, other schemes and userinfo are never redirected to', async () => {
  for (const uri of [`${REDIRECT_URI}/`, `${REDIRECT_URI}/extra`, `${REDIRECT_URI}?x=1`, `${REDIRECT_URI}#f`, REDIRECT_URI.toUpperCase(), REDIRECT_URI.replace('https', 'http'), REDIRECT_URI.replace('//', '//user@'), 'https://attacker.invalid/oauth/callback', `https://client.example.attacker.invalid/oauth/callback`, '', 'https://client.example/oauth/callbac']) {
    const r = await authorize({ redirect_uri: uri });
    assert.equal(r.status, 400, uri);
    assert.equal(r.json.error, 'invalid_request', uri);
    assert.equal(r.headers.location, undefined, `${uri} must not be redirected to`);
  }
  assert.equal((await authorize({ redirect_uri: undefined }, ['redirect_uri'])).status, 400);
  assert.equal((await authorize({ client_id: 'https://other.example/c.json' })).status, 400);
  const ok = await authorize({});
  assert.equal(ok.status, 302);
  assert.equal(new URL(ok.headers.location).origin, ORIGINS.idp, 'the front channel goes to the IdP');
});

test('authorization request refusals redirect back with error, state and iss (RFC 9207), each for its own reason', async () => {
  const expect = async (over, drop, error) => {
    const r = await authorize(over, drop);
    assert.equal(r.status, 302, JSON.stringify([over, drop]));
    const u = new URL(r.headers.location);
    assert.equal(u.origin + u.pathname, REDIRECT_URI);
    assert.equal(u.searchParams.get('error'), error, JSON.stringify([over, drop]));
    assert.equal(u.searchParams.get('iss'), ORIGINS.as);
    if (!drop.includes('state')) assert.equal(u.searchParams.get('state'), 'st-1');
  };
  await expect({}, ['resource'], 'invalid_target');
  await expect({ resource: 'https://unregistered.example' }, [], 'invalid_target');
  await expect({}, ['code_challenge'], 'invalid_request');
  await expect({ code_challenge_method: 'plain' }, [], 'invalid_request');
  await expect({}, ['code_challenge_method'], 'invalid_request');
  await expect({ code_challenge: 'short' }, [], 'invalid_request');
  await expect({}, ['state'], 'invalid_request');
  await expect({ scope: 'items.write' }, [], 'invalid_scope');
  await expect({ scope: 'items.read admin' }, [], 'invalid_scope');
  await expect({}, ['scope'], 'invalid_scope');
  await expect({ response_type: 'token' }, [], 'unsupported_response_type');
});

test('repeated parameters are not accepted as a value', async () => {
  const q = `${form(authQuery({ state: undefined }))}&state=a&state=b`;
  const r = await request(ports.pf, 'GET', `/as/authorization.oauth2?${q}`);
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.location).searchParams.get('error'), 'invalid_request');
});

// ---------------------------------------------------------------- the full front channel, driven by hand
async function frontChannel({ verifier = newVerifier(), over = {}, mutateIdToken } = {}) {
  const a = await authorize({ code_challenge: challengeS256(verifier), ...over });
  assert.equal(a.status, 302, a.raw);
  const idpUrl = new URL(a.headers.location);
  const page = await request(ports.idp, 'GET', `${idpUrl.pathname}${idpUrl.search}`);
  assert.equal(page.status, 200, page.raw);
  const login = await request(ports.idp, 'POST', '/authenticate', { body: { txn: page.json.txn, username: MOCK_USER.username, password: MOCK_USER.password, otp: MOCK_USER.otp } });
  assert.equal(login.status, 302, login.raw);
  let cb = new URL(login.headers.location);
  if (mutateIdToken) { cb.searchParams.set('id_token', mutateIdToken({ txnId: idpUrl.searchParams.get('state'), nonce: idpUrl.searchParams.get('nonce') })); }
  const consent = await request(ports.pf, 'GET', `${cb.pathname}${cb.search}`);
  return { verifier, consent, idpUrl, a };
}
async function getCode(opts) {
  const f = await frontChannel(opts);
  assert.equal(f.consent.status, 200, f.consent.raw);
  const c = await request(ports.pf, 'POST', '/as/consent', { body: { consent_id: f.consent.json.consent_id, decision: 'approve' } });
  assert.equal(c.status, 302);
  const u = new URL(c.headers.location);
  return { ...f, code: u.searchParams.get('code'), redirect: u };
}
const redeem = (o) => request(ports.pf, 'POST', '/as/token.oauth2', { headers: FORM, body: form({ grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, resource: ORIGINS.gateway, ...o }) });

test('PKCE: a wrong or malformed verifier is refused and does not burn the code; the right one then works; a replay is refused', async () => {
  const { code, verifier } = await getCode();
  for (const bad of [newVerifier(), `${verifier}A`, verifier.slice(1), 'short', '', verifier.toUpperCase()]) {
    const r = await redeem({ code, code_verifier: bad });
    assert.equal(r.status, 400, bad);
    assert.equal(r.json.error, 'invalid_grant', bad);
  }
  assert.equal((await redeem({ code })).json.error, 'invalid_grant', 'no verifier at all');
  const good = await redeem({ code, code_verifier: verifier });
  assert.equal(good.status, 200);
  assert.equal(good.headers['cache-control'], 'no-store');
  const replay = await redeem({ code, code_verifier: verifier });
  assert.equal(replay.status, 400);
  assert.equal(replay.json.error, 'invalid_grant');
  assert.match(replay.json.error_description, /already used/);
});

test('redemption is bound to the authorization request: client, redirect URI, resource, lifetime, unknown codes', async () => {
  const a = await getCode();
  assert.equal((await redeem({ code: a.code, code_verifier: a.verifier, redirect_uri: `${REDIRECT_URI}/x` })).json.error, 'invalid_grant');
  assert.equal((await redeem({ code: a.code, code_verifier: a.verifier, client_id: 'https://other.example/c.json' })).json.error, 'invalid_grant');
  assert.equal((await redeem({ code: a.code, code_verifier: a.verifier, resource: ORIGINS.otherResource })).json.error, 'invalid_grant');
  const ok = await redeem({ code: a.code, code_verifier: a.verifier });
  assert.equal(ok.status, 200, 'the failed attempts did not consume the code');
  assert.equal(parseJwt(ok.json.access_token).payload.aud, ORIGINS.gateway);
  const b = await getCode();
  clock.advance(61_000);
  assert.equal((await redeem({ code: b.code, code_verifier: b.verifier })).json.error, 'invalid_grant', 'codes live 60 s');
  clock.reset();
  assert.equal((await redeem({ code: 'nope', code_verifier: b.verifier })).json.error, 'invalid_grant');
});

test('the code response carries state and iss; denying consent redirects with access_denied, state and iss', async () => {
  const ok = await getCode({ over: { state: 'abc' } });
  assert.equal(ok.redirect.searchParams.get('state'), 'abc');
  assert.equal(ok.redirect.searchParams.get('iss'), ORIGINS.as);
  const f = await frontChannel();
  const d = await request(ports.pf, 'POST', '/as/consent', { body: { consent_id: f.consent.json.consent_id, decision: 'deny' } });
  const u = new URL(d.headers.location);
  assert.equal(u.searchParams.get('error'), 'access_denied');
  assert.equal(u.searchParams.get('iss'), ORIGINS.as);
  assert.equal(u.searchParams.get('code'), null);
  assert.equal((await request(ports.pf, 'POST', '/as/consent', { body: { consent_id: f.consent.json.consent_id, decision: 'approve' } })).status, 400, 'a consent id is single use');
});

test('the authorization server validates the ID token: signature, issuer, audience, nonce, expiry', async () => {
  const rogue = createKeyPair('idp-key-1');
  const sign = (key, over = {}) => ({ nonce }) => signJwt({ alg: 'ES256', typ: 'JWT', kid: key.kid }, { iss: ORIGINS.idp, aud: PF_RP_CLIENT_ID, sub: 'user-1', nonce, acr: 'mfa', iat: now(), exp: now() + 300, ...over }, key.privateKey);
  const bad = async (name, mutate) => { const f = await frontChannel({ mutateIdToken: (c) => mutate(c) }); assert.equal(f.consent.status, 400, name); assert.equal(f.consent.json.error, 'invalid_id_token', name); };
  await bad('signed by another key', sign(rogue));
  await bad('wrong issuer', sign(env.idpKey, { iss: 'https://attacker.invalid' }));
  await bad('wrong audience', sign(env.idpKey, { aud: 'someone-else' }));
  await bad('wrong nonce', (c) => sign(env.idpKey)({ nonce: `${c.nonce}x` }));
  await bad('expired', sign(env.idpKey, { exp: now() - 600 }));
  await bad('alg none', ({ nonce }) => `${b64u(JSON.stringify({ alg: 'none', kid: 'idp-key-1' }))}.${b64u(JSON.stringify({ iss: ORIGINS.idp, aud: PF_RP_CLIENT_ID, nonce, sub: 'x', exp: now() + 300 }))}.`);
  assert.equal((await request(ports.pf, 'GET', `${new URL(IDP_CALLBACK).pathname}?state=txn-unknown&id_token=x`)).status, 400);
});

test('the IdP is authentication only: wrong credentials, a replayed login transaction and an unregistered relying party are refused', async () => {
  const a = await authorize({});
  const idpUrl = new URL(a.headers.location);
  const page = await request(ports.idp, 'GET', `${idpUrl.pathname}${idpUrl.search}`);
  const body = (o) => ({ txn: page.json.txn, username: MOCK_USER.username, password: MOCK_USER.password, otp: MOCK_USER.otp, ...o });
  // a wrong attempt burns the transaction
  assert.equal((await request(ports.idp, 'POST', '/authenticate', { body: body({ otp: '111111' }) })).status, 401);
  assert.equal((await request(ports.idp, 'POST', '/authenticate', { body: body({}) })).status, 400, 'the transaction is gone');
  const bad = new URL(idpUrl); bad.searchParams.set('redirect_uri', 'https://attacker.invalid/cb');
  assert.equal((await request(ports.idp, 'GET', `${bad.pathname}${bad.search}`)).status, 400);
  const bad2 = new URL(idpUrl); bad2.searchParams.set('client_id', 'other');
  assert.equal((await request(ports.idp, 'GET', `${bad2.pathname}${bad2.search}`)).status, 400);
  const page2 = await request(ports.idp, 'GET', `${idpUrl.pathname}${idpUrl.search}`);
  const ok = await request(ports.idp, 'POST', '/authenticate', { body: { txn: page2.json.txn, ...MOCK_USER } });
  assert.equal(ok.status, 302);
  assert.equal((await request(ports.idp, 'POST', '/authenticate', { body: { txn: page2.json.txn, ...MOCK_USER } })).status, 400, 'a login transaction is single use');
});

// ---------------------------------------------------------------- RFC 8693 exchange
const exch = (over = {}, headers = basic()) => request(ports.pf, 'POST', '/as/token.oauth2', {
  headers: { ...FORM, ...headers },
  body: form({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: mint({ scope: 'items.read profile.read' }), subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', audience: ORIGINS.private, ...over }),
});

test('token exchange: the caller must authenticate as the gateway identity', async () => {
  assert.equal((await exch({}, {})).status, 401);
  assert.equal((await exch({}, basic('gateway-nhi', 'wrong'))).status, 401);
  assert.equal((await exch({}, basic('other-nhi'))).status, 401);
  assert.equal((await exch({}, { authorization: 'Bearer abc' })).status, 401);
  assert.equal((await exch({}, basic())).status, 200);
});

test('token exchange: output is narrowed (never wider than the subject token), re-audienced, delegated and short lived', async () => {
  const r = await exch({});
  assert.equal(r.status, 200);
  assert.equal(r.json.issued_token_type, 'urn:ietf:params:oauth:token-type:access_token');
  const t = parseJwt(r.json.access_token).payload;
  assert.equal(t.aud, ORIGINS.private);
  assert.deepEqual(t.act, { sub: 'gateway-nhi' });
  assert.equal(t.scope, 'items.read', 'profile.read was dropped: narrowed to subject AND policy');
  assert.equal(t.sub, 'user-1');
  assert.equal(t.exp - t.iat, 60);
  assert.equal(r.json.scope, 'items.read');
  // asking for more than the subject holds, or than the policy allows, is refused
  assert.equal((await exch({ scope: 'items.read profile.read' })).json.error, 'invalid_scope', 'policy allows items.read only');
  assert.equal((await exch({ subject_token: mint({ scope: 'profile.read' }) })).json.error, 'invalid_scope', 'subject has nothing the policy allows');
  assert.equal((await exch({ subject_token: mint({ scope: 'items.read' }), scope: 'items.read items.write' })).json.error, 'invalid_scope');
});

test('token exchange: the subject token is validated like any bearer token, and the target must be allow-listed', async () => {
  assert.equal((await exch({ subject_token: mint({ aud: ORIGINS.otherResource }) })).json.error, 'invalid_grant', 'subject not addressed to the gateway');
  assert.equal((await exch({ subject_token: mint({ exp: now() - 600 }) })).json.error, 'invalid_grant', 'expired subject');
  assert.equal((await exch({ subject_token: mint({ iss: 'https://attacker.invalid' }) })).json.error, 'invalid_grant');
  assert.equal((await exch({ subject_token: mint({}, { key: createKeyPair('as-key-1') }) })).json.error, 'invalid_grant', 'signed by another key');
  assert.equal((await exch({ subject_token: 'garbage' })).json.error, 'invalid_grant');
  assert.equal((await exch({ audience: ORIGINS.otherResource })).json.error, 'invalid_target');
  assert.equal((await exch({ audience: ORIGINS.gateway })).json.error, 'invalid_target', 'no exchange back to the same audience');
  assert.equal((await exch({ audience: undefined })).json.error, 'invalid_target');
  assert.equal((await exch({ subject_token_type: 'urn:ietf:params:oauth:token-type:id_token' })).json.error, 'invalid_request');
  assert.equal((await request(ports.pf, 'POST', '/as/token.oauth2', { headers: FORM, body: form({ grant_type: 'password' }) })).json.error, 'unsupported_grant_type');
});

// ---------------------------------------------------------------- the gateway (protected resource)
const callGw = (token, body = rpcBody()) => request(ports.gateway, 'POST', '/mcp', { headers: token ? bearer(token) : {}, body });

test('gateway: no token gets 401 with resource_metadata; the protected-resource document names the authorization server', async () => {
  const r = await callGw(null);
  assert.equal(r.status, 401);
  assert.match(r.headers['www-authenticate'], /^Bearer .*resource_metadata="https:\/\/mcp\.example\/\.well-known\/oauth-protected-resource"/);
  assert.doesNotMatch(r.headers['www-authenticate'], /error="/);
  const prm = await request(ports.gateway, 'GET', '/.well-known/oauth-protected-resource');
  assert.equal(prm.json.resource, ORIGINS.gateway);
  assert.deepEqual(prm.json.authorization_servers, [ORIGINS.as]);
});

test('gateway: each validation failure is refused before any downstream call (iss, aud, exp, alg, key, signature, scope)', async () => {
  const m0 = env.wire.mark();
  const bad = async (name, token, status, error) => {
    const r = await callGw(token);
    assert.equal(r.status, status, name);
    assert.equal(r.json.error, error, name);
    assert.match(r.headers['www-authenticate'], new RegExp(`error="${error}"`), name);
  };
  await bad('wrong issuer', mint({ iss: 'https://attacker.invalid' }), 401, 'invalid_token');
  await bad('wrong audience', mint({ aud: ORIGINS.private }), 401, 'invalid_token');
  await bad('audience list without us', mint({ aud: [ORIGINS.otherResource] }), 401, 'invalid_token');
  await bad('expired', mint({ exp: now() - 600 }), 401, 'invalid_token');
  await bad('not yet valid', mint({ nbf: now() + 600 }), 401, 'invalid_token');
  await bad('no exp', mint({ exp: undefined }), 401, 'invalid_token');
  await bad('wrong key', mint({}, { key: createKeyPair('as-key-1') }), 401, 'invalid_token');
  await bad('unknown kid', mint({}, { header: { kid: 'nope' } }), 401, 'invalid_token');
  await bad('id token typ', mint({}, { header: { typ: 'JWT' } }), 401, 'invalid_token');
  await bad('alg none', `${b64u(JSON.stringify({ alg: 'none', typ: 'at+jwt', kid: 'as-key-1' }))}.${mint().split('.')[1]}.`, 401, 'invalid_token');
  await bad('HS256 with the public key as secret', `${b64u(JSON.stringify({ alg: 'HS256', typ: 'at+jwt', kid: 'as-key-1' }))}.${mint().split('.')[1]}.${b64u('x')}`, 401, 'invalid_token');
  await bad('tampered scope', `${mint().split('.')[0]}.${b64u(JSON.stringify({ iss: ORIGINS.as, aud: ORIGINS.gateway, scope: 'items.read admin', exp: now() + 300 }))}.${mint().split('.')[2]}`, 401, 'invalid_token');
  await bad('garbage', 'garbage', 401, 'invalid_token');
  await bad('scope too narrow', mint({ scope: 'profile.read' }), 403, 'insufficient_scope');
  await bad('scope is not a prefix match', mint({ scope: 'items.readonly' }), 403, 'insufficient_scope');
  assert.equal(env.wire.since(m0).length, 0, 'nothing was exchanged or routed for a refused token');
  assert.equal((await request(ports.gateway, 'POST', '/mcp', { headers: { authorization: 'Basic abc' }, body: rpcBody() })).status, 401);
});

test('gateway: an accepted token is exchanged (RFC 8693) and routed; the user token is never forwarded', async () => {
  const m0 = env.wire.mark();
  const user = mint();
  const r = await callGw(user);
  assert.equal(r.status, 200);
  assert.equal(r.json.result.structuredContent.price, 12.5);
  const hops = env.wire.since(m0);
  assert.deepEqual(hops.map((h) => `${h.from}>${h.to}`), ['gateway>pf', 'gateway>private']);
  const fwd = hops[1].request.headers.authorization.replace('Bearer ', '');
  assert.notEqual(fwd, user);
  assert.equal(parseJwt(fwd).payload.aud, ORIGINS.private);
  assert.deepEqual(parseJwt(fwd).payload.act, { sub: 'gateway-nhi' });
});

test('gateway: unknown tools and malformed calls are refused after validation, without an exchange', async () => {
  const m0 = env.wire.mark();
  assert.equal((await callGw(mint(), rpcBody('widget-100', 'delete-everything'))).json.error.code, -32601);
  assert.equal((await callGw(mint(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'price-lookup', arguments: { item: { $ne: 1 } } } })).json.error.code, -32601);
  assert.equal(env.wire.since(m0).length, 0);
});

test('gateway passthrough mistake: the private server refuses the unexchanged user token and the gateway reports it', async () => {
  env.gateway.faults.passthrough = true;
  try {
    const r = await callGw(mint());
    assert.equal(r.status, 502);
    assert.equal(r.json.error, 'downstream_refused');
    assert.equal(r.json.downstream_status, 401);
  } finally { env.gateway.reset(); }
  assert.equal((await callGw(mint())).status, 200, 'the fault was cleared');
});

// ---------------------------------------------------------------- the private server
const callPriv = (token, body = rpcBody()) => request(ports.private, 'POST', '/mcp', { headers: token ? bearer(token) : {}, body });
const obo = (over = {}, o) => mint({ aud: ORIGINS.private, act: { sub: 'gateway-nhi' }, scope: 'items.read', ...over }, o);

test('private server: re-validates everything itself, including the delegation (act) and the per-API scope', async () => {
  assert.equal((await callPriv(obo())).json.result.structuredContent.currency, 'USD');
  const bad = async (name, token, status, error) => { const r = await callPriv(token); assert.equal(r.status, status, name); assert.equal(r.json.error, error, name); };
  await bad('no token', null, 401, 'invalid_token');
  await bad('the user token (aud = gateway)', mint(), 401, 'invalid_token');
  await bad('no act claim', mint({ aud: ORIGINS.private }), 401, 'invalid_token');
  await bad('act is someone else', obo({ act: { sub: 'other-nhi' } }), 401, 'invalid_token');
  await bad('expired', obo({ exp: now() - 600 }), 401, 'invalid_token');
  await bad('wrong issuer', obo({ iss: 'https://attacker.invalid' }), 401, 'invalid_token');
  await bad('wrong key', obo({}, { key: createKeyPair('as-key-1') }), 401, 'invalid_token');
  await bad('per-API scope missing', obo({ scope: 'profile.read' }), 403, 'insufficient_scope');
});

test('private server: tool input is bounded and data lookups cannot reach prototype properties', async () => {
  for (const item of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nope']) {
    const r = await callPriv(obo(), rpcBody(item));
    assert.equal(r.json.result.isError, true, item);
    assert.equal(r.json.result.content[0].text, 'unknown item');
  }
  assert.equal((await callPriv(obo(), rpcBody('x'.repeat(100)))).json.result.isError, true);
  assert.equal((await callPriv(obo(), rpcBody('widget-100', 'other-tool'))).json.error.code, -32601);
});

test('actors answer loopback Host headers only (DNS rebinding) and bound request bodies', async () => {
  for (const port of Object.values(ports)) {
    assert.equal((await request(port, 'GET', '/jwks', { host: 'evil.example' })).status, 421);
  }
  const big = await request(ports.gateway, 'POST', '/mcp', { headers: bearer(mint()), body: JSON.stringify({ pad: 'x'.repeat(20_000) }) });
  assert.equal(big.status, 413);
  assert.equal((await request(ports.gateway, 'POST', '/mcp', { headers: bearer(mint()), body: '{bad' })).status, 400);
  assert.equal((await request(ports.gateway, 'GET', '/nope')).status, 404);
});

// ---------------------------------------------------------------- MF2 pins
test('every actor listener binds 127.0.0.1 only', () => {
  for (const l of env.listeners) assert.equal(l.address, '127.0.0.1');
});

test('actors refuse browser-originated cross-site requests and cookie, API-key and proxy credentials; Authorization still works', async () => {
  for (const port of Object.values(ports)) {
    const cross = await request(port, 'POST', '/as/token.oauth2', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', ...FORM }, body: form({ grant_type: 'x' }) });
    assert.equal(cross.status, 403, 'cross-site');
    assert.equal((await request(port, 'GET', '/jwks', { headers: { origin: 'http://127.0.0.1' } })).status, 403, 'any Origin header: these actors take no browser calls');
    for (const h of ['cookie', 'x-api-key', 'proxy-authorization']) {
      assert.equal((await request(port, 'GET', '/jwks', { headers: { [h]: 'a=b' } })).status, 400, h);
    }
  }
  assert.equal((await callGw(mint())).status, 200, 'the bearer token header is the one credential the actors do take');
});

test('actor state is bounded: the transaction, consent and code maps never grow past 200 entries', async () => {
  await env.pf.reset(); env.idp.reset();
  for (let i = 0; i < 230; i += 1) await authorize({ state: `s${i}` });
  assert.equal(env.pf.sizes().txns, 200);
  const idpUrl = new URL((await authorize({})).headers.location);
  for (let i = 0; i < 230; i += 1) await request(ports.idp, 'GET', `${idpUrl.pathname}${idpUrl.search}`);
  assert.equal(env.idp.size(), 200);
  env.pf.reset(); env.idp.reset();
  assert.deepEqual(env.pf.sizes(), { txns: 0, consents: 0, codes: 0 });
});

test('a consent that arrives after the transaction expired (5 minutes) is refused and yields no code', async () => {
  const f = await frontChannel();
  assert.equal(f.consent.status, 200);
  clock.advance(301_000);
  try {
    const c = await request(ports.pf, 'POST', '/as/consent', { body: { consent_id: f.consent.json.consent_id, decision: 'approve' } });
    assert.equal(c.status, 400);
    assert.equal(c.headers.location, undefined, 'no redirect with a code');
  } finally { clock.reset(); }
});

test('an ID token with the right signature but the wrong nonce does not reach consent (replay defence for the IdP leg)', async () => {
  const f = await frontChannel({ mutateIdToken: ({ nonce }) => signJwt({ alg: 'ES256', typ: 'JWT', kid: env.idpKey.kid }, { iss: ORIGINS.idp, aud: PF_RP_CLIENT_ID, sub: 'user-1', nonce: `${nonce}-other`, iat: now(), exp: now() + 300 }, env.idpKey.privateKey) });
  assert.equal(f.consent.status, 400);
  assert.equal(f.consent.json.error_description, 'ID token nonce');
});

test('gateway fails closed: when the RFC 8693 exchange is refused it answers 502 and never contacts the private server', async () => {
  const wrong = createGateway({ asJwks: { keys: [env.asKey.publicJwk] }, clock, wire: env.wire, gatewaySecret: `${SECRET}-wrong` });
  const original = env.listeners[2];
  await original.close();
  const swapped = await listenActor(wrong.app, ports.gateway);
  try {
    const m0 = env.wire.mark();
    const user = mint(); // a perfectly valid user token: only the exchange can fail
    const r = await callGw(user);
    assert.equal(r.status, 502);
    assert.equal(r.json.error, 'downstream_authorization_failed');
    assert.equal(r.json.pf_error, 'invalid_client');
    const hops = env.wire.since(m0);
    assert.ok(hops.some((h) => h.to === 'pf' && h.response.status === 401), 'the exchange was attempted and refused');
    assert.ok(!hops.some((h) => h.to === 'private'), 'the private server was never contacted');
    assert.ok(!JSON.stringify(r.json).includes(user), 'the user token is not echoed');
  } finally {
    await swapped.close();
    env.listeners[2] = await listenActor(env.gateway.app, ports.gateway);
  }
  assert.equal((await callGw(mint())).status, 200, 'the real gateway is back');
});

// MOCK PingFederate-like authorization server + RFC 8693 security token service. It owns no users: authentication
// is delegated to the enterprise IdP stub. Endpoint names are the stub's own (UNVERIFIED against the product).
import crypto from 'node:crypto';
import { signJwt, verifySignature } from '../jwt.js';
import { isValidChallenge, verifyPkce } from '../pkce.js';
import { recordChecks, createActorApp, finishActorApp, one, setBounded } from './base.js';
import { validateBearer, scopesOf } from '../tokens.js';
import {
  CLIENT_ID, CODE_TTL_SEC, GATEWAY_NHI, OBO_TTL_SEC, ORIGINS, PF_RP_CLIENT_ID, REDIRECT_URI, SCOPE_OTHER, SCOPE_TOOL, TOKEN_TTL_SEC,
} from '../definition.js';
import { IDP_CALLBACK } from './idp.js';

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const rid = (n = 18) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function createAuthServer({ keyPair, idpJwks, clock, wire, gatewaySecret }) {
  const app = createActorApp();
  const faults = {}; // { iss: 'omit' | <forged issuer>, state: 'tamper' } set in-process by the orchestrator only
  const txns = new Map();
  const consents = new Map();
  const codes = new Map();
  const jwks = { keys: [keyPair.publicJwk] };
  const issuer = ORIGINS.as;

  const resources = new Set([ORIGINS.gateway, ORIGINS.otherResource]);
  const clients = {
    [CLIENT_ID]: { name: 'Example AI Assistant', redirectUris: [REDIRECT_URI], scopes: [SCOPE_TOOL, SCOPE_OTHER] },
  };
  const nhi = { id: GATEWAY_NHI, secretHash: sha(gatewaySecret), exchange: { subjectAudience: ORIGINS.gateway, audiences: [ORIGINS.private], scopes: [SCOPE_TOOL] } };

  const mint = (claims, ttl) => {
    const iat = clock.nowSec();
    return signJwt({ alg: 'ES256', typ: 'at+jwt', kid: keyPair.kid }, { iss: issuer, ...claims, iat, exp: iat + ttl, jti: rid(12) }, keyPair.privateKey);
  };

  // RFC 9207: iss on every authorization response, success or error. Faults let the orchestrator play a mix-up attacker.
  function redirectBack(res, base, params, state) {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const st = faults.state === 'tamper' && state !== undefined ? `${state}x` : state;
    if (st !== undefined) u.searchParams.set('state', st);
    if (faults.iss === 'omit') { /* no iss */ } else u.searchParams.set('iss', faults.iss || issuer);
    return res.redirect(302, u.toString());
  }

  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer,
    authorization_endpoint: `${issuer}/as/authorization.oauth2`,
    token_endpoint: `${issuer}/as/token.oauth2`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', TOKEN_EXCHANGE],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    scopes_supported: [SCOPE_TOOL, SCOPE_OTHER],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  }));
  app.get('/jwks', (_req, res) => res.json(jwks));

  // --- authorization endpoint -------------------------------------------------------------------------------------
  app.get('/as/authorization.oauth2', (req, res) => {
    const q = req.query;
    const client = clients[one(q.client_id)];
    const redirectUri = one(q.redirect_uri);
    wire.check('pf', 'client is registered', Boolean(client), client ? 'client identity recognised' : 'unknown client');
    if (!client) return res.status(400).json({ error: 'invalid_client', error_description: 'unknown client_id' });
    const exact = client.redirectUris.includes(redirectUri);
    wire.check('pf', 'redirect_uri exact match', exact, exact ? 'matches a registered URI exactly' : 'not an exact match of any registered URI');
    // An unregistered redirect URI is never redirected to: the error stays on this page.
    if (!exact) return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client (exact match required)' });
    const state = one(q.state);
    const fail = (error, description) => redirectBack(res, redirectUri, { error, error_description: description }, state);
    const check = (name, ok, detail) => { wire.check('pf', name, ok, detail); return ok; };
    if (!check('response_type=code', one(q.response_type) === 'code', 'only the authorization code flow is offered')) return fail('unsupported_response_type', 'response_type must be code');
    if (!check('state present', Boolean(state), state ? 'state supplied' : 'no state')) return fail('invalid_request', 'state is required');
    const challenge = one(q.code_challenge);
    if (!check('PKCE challenge, method S256', isValidChallenge(challenge) && one(q.code_challenge_method) === 'S256', 'code_challenge with method S256 is required (plain is refused)')) return fail('invalid_request', 'code_challenge with code_challenge_method=S256 is required');
    const resource = one(q.resource);
    if (!check('resource indicator', Boolean(resource) && resources.has(resource), resource ? (resources.has(resource) ? `resource ${resource} is registered` : 'resource is not registered') : 'no resource parameter')) return fail('invalid_target', 'a registered resource indicator is required (RFC 8707)');
    const scopes = (one(q.scope) || '').split(' ').filter(Boolean);
    if (!check('scopes allowed for client', scopes.length > 0 && scopes.every((s) => client.scopes.includes(s)), `requested ${scopes.join(' ') || 'none'}`)) return fail('invalid_scope', 'scope is empty or not allowed for this client');

    const id = `txn-${rid()}`;
    const nonce = rid(12);
    setBounded(txns, id, { clientId: one(q.client_id), redirectUri, state, challenge, resource, scopes, nonce, exp: clock.now() + 300_000 });
    const idp = new URL(`${ORIGINS.idp}/authorize`);
    idp.search = new URLSearchParams({ response_type: 'id_token', client_id: PF_RP_CLIENT_ID, redirect_uri: IDP_CALLBACK, scope: 'openid', state: id, nonce }).toString();
    return res.redirect(302, idp.toString());
  });

  // --- return from the IdP: validate the ID token, then show consent -------------------------------------------------
  app.get(new URL(IDP_CALLBACK).pathname, (req, res) => {
    const t = txns.get(one(req.query.state));
    wire.check('pf', 'authorization transaction known', Boolean(t) && t.exp > clock.now(), t ? 'transaction found' : 'unknown or expired state');
    if (!t || t.exp <= clock.now()) return res.status(400).json({ error: 'invalid_request' });
    const v = validateIdToken(one(req.query.id_token), t.nonce);
    recordChecks(wire, 'pf', v.checks);
    if (!v.ok) return res.status(400).json({ error: 'invalid_id_token', error_description: v.reason });
    const consentId = `cons-${rid()}`;
    setBounded(consents, consentId, { txn: one(req.query.state), sub: v.payload.sub, acr: v.payload.acr, amr: v.payload.amr });
    return res.json({
      page: 'consent', consent_id: consentId, client_name: clients[t.clientId].name, client_id: t.clientId, scopes_requested: t.scopes,
      resource: t.resource, user: { sub: v.payload.sub, acr: v.payload.acr, amr: v.payload.amr }, actions: ['approve', 'deny'],
    });
  });

  function validateIdToken(token, nonce) {
    const checks = [];
    const sig = verifySignature(token, idpJwks);
    checks.push({ name: 'ID token signature (ES256)', ok: sig.ok, detail: sig.ok ? 'verifies against the IdP key' : sig.reason });
    if (!sig.ok) return { ok: false, reason: sig.reason, checks };
    const p = sig.payload;
    const add = (name, ok, detail) => checks.push({ name, ok, detail });
    add('ID token iss', p.iss === ORIGINS.idp, 'issuer is the trusted enterprise IdP');
    add('ID token aud', p.aud === PF_RP_CLIENT_ID, 'audience is this relying party');
    add('ID token nonce', p.nonce === nonce, 'nonce matches the one sent');
    add('ID token exp', Number.isFinite(p.exp) && p.exp + 5 > clock.nowSec(), 'not expired');
    const bad = checks.find((c) => !c.ok);
    return bad ? { ok: false, reason: bad.name, checks } : { ok: true, payload: p, checks };
  }

  // --- consent, then the authorization code ------------------------------------------------------------------------
  app.post('/as/consent', (req, res) => {
    const c = consents.get(req.body?.consent_id);
    if (!c) return res.status(400).json({ error: 'invalid_request' });
    consents.delete(req.body.consent_id); // single use
    const t = txns.get(c.txn);
    txns.delete(c.txn);
    if (!t || t.exp <= clock.now()) return res.status(400).json({ error: 'invalid_request' });
    if (req.body.decision !== 'approve') return redirectBack(res, t.redirectUri, { error: 'access_denied' }, t.state);
    const code = rid(24);
    setBounded(codes, code, { ...t, sub: c.sub, used: false, exp: clock.now() + CODE_TTL_SEC * 1000 });
    wire.check('pf', 'user consented', true, `scopes ${t.scopes.join(' ')} approved`);
    return redirectBack(res, t.redirectUri, { code }, t.state);
  });

  // --- token endpoint ---------------------------------------------------------------------------------------------
  const tokenError = (res, status, error, description) => res.status(status).set('Cache-Control', 'no-store').json({ error, error_description: description });

  app.post('/as/token.oauth2', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    if (b.grant_type === 'authorization_code') return authorizationCode(b, res);
    if (b.grant_type === TOKEN_EXCHANGE) return exchange(req, b, res);
    wire.check('pf', 'grant_type supported', false, 'only authorization_code and token exchange');
    return tokenError(res, 400, 'unsupported_grant_type', 'grant_type is not supported');
  });

  function authorizationCode(b, res) {
    const rec = codes.get(one(b.code));
    const fail = (name, detail, description) => { wire.check('pf', name, false, detail); return tokenError(res, 400, 'invalid_grant', description); };
    if (!rec) return fail('authorization code', 'unknown code', 'the authorization code is unknown');
    if (rec.used) return fail('authorization code single use', 'this code was already redeemed', 'the authorization code was already used');
    if (rec.exp <= clock.now()) return fail('authorization code lifetime', 'expired', 'the authorization code has expired');
    if (one(b.client_id) !== rec.clientId) return fail('code bound to client', 'client_id differs', 'the code was issued to a different client');
    if (one(b.redirect_uri) !== rec.redirectUri) return fail('redirect_uri equals the authorization request', 'differs', 'redirect_uri does not match the authorization request');
    const pkce = verifyPkce(one(b.code_verifier), rec.challenge);
    wire.check('pf', 'PKCE: S256(code_verifier) == code_challenge', pkce, pkce ? 'the verifier hashes to the challenge from step 9' : 'the verifier does not hash to the stored challenge');
    if (!pkce) return tokenError(res, 400, 'invalid_grant', 'PKCE verification failed');
    const resource = one(b.resource) ?? rec.resource;
    if (resource !== rec.resource) return fail('resource matches the authorization request', 'differs', 'resource does not match the authorization request');
    rec.used = true; // after every check has passed
    wire.check('pf', 'authorization code single use', true, 'code marked as used');
    const token = mint({ sub: rec.sub, aud: rec.resource, scope: rec.scopes.join(' '), client_id: rec.clientId }, TOKEN_TTL_SEC);
    return res.json({ access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SEC, scope: rec.scopes.join(' ') });
  }

  // RFC 8693 token exchange for the gateway's non-human identity.
  function exchange(req, b, res) {
    const auth = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization || '');
    const [id, ...rest] = auth ? Buffer.from(auth[1], 'base64').toString('utf8').split(':') : [];
    const authed = id === nhi.id && crypto.timingSafeEqual(sha(rest.join(':')), nhi.secretHash);
    wire.check('pf', 'caller authenticates (client_secret_basic)', authed, authed ? `caller is ${nhi.id}` : 'unknown caller or wrong secret');
    if (!authed) return res.status(401).set('WWW-Authenticate', 'Basic realm="token"').json({ error: 'invalid_client' });
    const fail = (name, detail, error, description) => { wire.check('pf', name, false, detail); return tokenError(res, 400, error, description); };
    if (one(b.subject_token_type) !== ACCESS_TOKEN_TYPE) return fail('subject_token_type', 'must be an access token', 'invalid_request', 'subject_token_type must be an access token');
    const sub = validateBearer(one(b.subject_token), { jwks, iss: issuer, aud: nhi.exchange.subjectAudience, nowSec: clock.nowSec() });
    recordChecks(wire, 'pf', sub.checks.map((c) => ({ ...c, name: `subject_token ${c.name}` })));
    if (!sub.ok) return tokenError(res, 400, 'invalid_grant', `subject_token refused: ${sub.reason}`);
    const audience = one(b.audience) ?? one(b.resource);
    if (!audience || !nhi.exchange.audiences.includes(audience)) return fail('target audience allowed', `${audience || 'none'} is not an allowed target`, 'invalid_target', 'audience is not an allowed exchange target');
    const allowed = scopesOf(sub.payload).filter((s) => nhi.exchange.scopes.includes(s)); // narrowing: subject scopes AND policy
    const asked = one(b.scope) ? one(b.scope).split(' ').filter(Boolean) : allowed;
    const narrow = asked.length > 0 && asked.every((s) => allowed.includes(s));
    wire.check('pf', 'scopes are narrowed, never widened', narrow, `granted ${asked.join(' ') || 'none'} of subject ${scopesOf(sub.payload).join(' ')}`);
    if (!narrow) return tokenError(res, 400, 'invalid_scope', 'requested scope is not a subset of the subject token scope and the exchange policy');
    const token = mint({ sub: sub.payload.sub, aud: audience, scope: asked.join(' '), client_id: nhi.id, act: { sub: nhi.id } }, OBO_TTL_SEC);
    return res.json({ access_token: token, issued_token_type: ACCESS_TOKEN_TYPE, token_type: 'Bearer', expires_in: OBO_TTL_SEC, scope: asked.join(' ') });
  }

  finishActorApp(app);
  return {
    app, faults, jwks, issuer,
    sizes: () => ({ txns: txns.size, consents: consents.size, codes: codes.size }),
    reset() { txns.clear(); consents.clear(); codes.clear(); for (const k of Object.keys(faults)) delete faults[k]; },
  };
}

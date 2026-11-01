// MOCK enterprise OIDC identity provider: authentication only. It signs an ID token for one fictional user.
// Simplification (labelled in the docs): the ID token is returned on the front channel to the registered callback
// instead of through a code exchange, which keeps the stand-in to one hop.
import crypto from 'node:crypto';
import { signJwt } from '../jwt.js';
import { ORIGINS, PF_RP_CLIENT_ID } from '../definition.js';
import { createActorApp, finishActorApp, one, setBounded } from './base.js';

export const IDP_CALLBACK = `${ORIGINS.as}/idp/callback`;
export const MOCK_USER = { sub: 'user-1', username: 'user-1', password: 'mock-not-a-secret', otp: '000000' };

export function createIdp({ keyPair, clock, wire }) {
  const app = createActorApp();
  const txns = new Map();
  const state = { jwks: { keys: [keyPair.publicJwk] } };

  app.get('/jwks', (_req, res) => res.json(state.jwks));

  app.get('/authorize', (req, res) => {
    const q = req.query;
    const ok = one(q.client_id) === PF_RP_CLIENT_ID && one(q.redirect_uri) === IDP_CALLBACK && one(q.response_type) === 'id_token'
      && one(q.state) && one(q.nonce) && /\bopenid\b/.test(one(q.scope) || '');
    wire.check('idp', 'client and redirect URI registered', Boolean(ok), ok ? 'the relying party and its callback match' : 'unknown client or callback');
    if (!ok) return res.status(400).json({ error: 'invalid_request' });
    const txn = `txn-${crypto.randomBytes(9).toString('base64url')}`;
    setBounded(txns, txn, { state: one(q.state), nonce: one(q.nonce), exp: clock.now() + 300_000 });
    return res.json({ page: 'login', txn, fields: ['username', 'password', 'otp'], note: 'MOCK login page: authentication only, no authorization decision' });
  });

  app.post('/authenticate', (req, res) => {
    const b = req.body || {};
    const t = txns.get(b.txn);
    if (!t || t.exp < clock.now()) { wire.check('idp', 'login transaction', false, 'unknown or expired'); return res.status(400).json({ error: 'invalid_request' }); }
    txns.delete(b.txn); // single use
    const eq = (a, c) => { const x = crypto.createHash('sha256').update(String(a)).digest(); const y = crypto.createHash('sha256').update(String(c)).digest(); return crypto.timingSafeEqual(x, y); };
    const good = eq(b.username, MOCK_USER.username) && eq(b.password, MOCK_USER.password) && eq(b.otp, MOCK_USER.otp);
    wire.check('idp', 'credentials and second factor', good, good ? 'password and one-time code accepted' : 'rejected');
    if (!good) return res.status(401).json({ error: 'access_denied' });
    const iat = clock.nowSec();
    const idToken = signJwt({ alg: 'ES256', typ: 'JWT', kid: keyPair.kid }, {
      iss: ORIGINS.idp, aud: PF_RP_CLIENT_ID, sub: MOCK_USER.sub, nonce: t.nonce, acr: 'mfa', amr: ['pwd', 'otp'], auth_time: iat, iat, exp: iat + 300,
    }, keyPair.privateKey);
    const loc = new URL(IDP_CALLBACK);
    loc.searchParams.set('id_token', idToken);
    loc.searchParams.set('state', t.state);
    return res.redirect(302, loc.toString());
  });

  finishActorApp(app);
  return { app, size: () => txns.size, reset: () => txns.clear(), jwksUrl: `${ORIGINS.idp}/jwks` };
}

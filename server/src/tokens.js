// Access-token validation as a protected resource does it: signature (ES256 only), iss, aud, exp/nbf, scope, and
// optionally an `act` claim. Every check is evaluated and reported; the first failure decides the error code
// (RFC 6750: invalid_token, or insufficient_scope when the token is fine but too narrow).
import { verifySignature } from './jwt.js';

const asList = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
export const scopesOf = (payload) => (typeof payload?.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : []);

export function validateBearer(token, { jwks, iss, aud, nowSec, scopes = [], actSub, leewaySec = 5 }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const sig = verifySignature(token, jwks);
  add('signature (ES256)', sig.ok, sig.ok ? 'verifies against the issuer key' : sig.reason);
  if (!sig.ok) return { ok: false, error: 'invalid_token', reason: sig.reason, checks };
  const { header, payload } = sig;
  add('typ', header.typ === 'at+jwt', header.typ === 'at+jwt' ? 'at+jwt' : 'typ must be at+jwt (RFC 9068)');
  add('iss', payload.iss === iss, payload.iss === iss ? 'issuer matches' : 'issuer is not the trusted authorization server');
  const audOk = asList(payload.aud).includes(aud);
  add('aud', audOk, audOk ? `audience is ${aud}` : 'token was issued for a different audience');
  const exp = Number.isFinite(payload.exp) ? payload.exp : null;
  const expOk = exp !== null && exp + leewaySec > nowSec;
  add('exp', expOk, exp === null ? 'no exp claim' : expOk ? 'not expired' : 'token has expired');
  const nbfOk = payload.nbf === undefined || payload.nbf - leewaySec <= nowSec;
  add('nbf', nbfOk, nbfOk ? 'valid now' : 'token is not valid yet');
  if (actSub !== undefined) {
    const ok = payload.act?.sub === actSub;
    add('act', ok, ok ? `acting party is ${actSub}` : 'token carries no delegation (act) for the expected acting party');
  }
  const bad = checks.find((c) => !c.ok);
  if (bad) return { ok: false, error: 'invalid_token', reason: `${bad.name}: ${bad.detail}`, checks };
  const have = new Set(scopesOf(payload));
  const missing = scopes.filter((s) => !have.has(s));
  add('scope', missing.length === 0, missing.length ? `missing ${missing.join(' ')}` : scopes.length ? `has ${scopes.join(' ')}` : 'no scope required');
  if (missing.length) return { ok: false, error: 'insufficient_scope', reason: `missing scope ${missing.join(' ')}`, checks, missing };
  return { ok: true, header, payload, checks };
}

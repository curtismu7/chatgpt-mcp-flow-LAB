// Minimal ES256 JWT handling for the MOCK authority. Keys are created in memory with ECDH + JWK import:
// the crypto module key-pair generators abort on Node 20 in CI, so they are never used here.
import crypto from 'node:crypto';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

export function createKeyPair(kid) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey();
  const d = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(d, 32 - raw.length);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  return {
    kid,
    privateKey: crypto.createPrivateKey({ key: { ...jwk, d: b64u(d) }, format: 'jwk' }),
    publicJwk: { ...jwk, kid, alg: 'ES256', use: 'sig' },
  };
}

export function signJwt(header, payload, privateKey) {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64u(sig)}`;
}

export const MAX_TOKEN_CHARS = 4096;
const SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

// Structure only; never throws.
export function parseJwt(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS || !SHAPE.test(token)) return { ok: false, reason: 'not a compact JWS' };
  const [h, p, s] = token.split('.');
  try {
    const header = JSON.parse(fromB64u(h).toString('utf8'));
    const payload = JSON.parse(fromB64u(p).toString('utf8'));
    if (!isObj(header) || !isObj(payload)) return { ok: false, reason: 'header and payload must be JSON objects' };
    return { ok: true, header, payload, signingInput: `${h}.${p}`, signature: s };
  } catch { return { ok: false, reason: 'header or payload is not base64url JSON' }; }
}

// Signature check against a JWKS ({ keys: [...] }). The algorithm is pinned to ES256: "none" and HS* are refused.
export function verifySignature(token, jwks) {
  const t = parseJwt(token);
  if (!t.ok) return { ok: false, reason: t.reason };
  if (t.header.alg !== 'ES256') return { ok: false, reason: `alg ${JSON.stringify(String(t.header.alg)).slice(0, 20)} is not accepted (ES256 only)` };
  const jwk = (jwks?.keys || []).find((k) => k.kid === t.header.kid);
  if (!jwk) return { ok: false, reason: 'no key with that kid in the issuer JWKS' };
  try {
    const key = crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
    const good = crypto.verify('sha256', Buffer.from(t.signingInput), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(t.signature));
    return good ? { ok: true, header: t.header, payload: t.payload } : { ok: false, reason: 'signature does not verify' };
  } catch { return { ok: false, reason: 'signature does not verify' }; }
}
